import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { createPushizoMcpServer, type PushizoApi } from '../index.js';

/**
 * Sözleşme eşitliği (public API ↔ MCP): her araç `api/openapi.yaml`'da tanımlı bir public işleme gider ve her public
 * okuma (GET) işlemi ya bir araçla karşılanır ya da gerekçesiyle `EXCLUDED_READS` listesindedir. Yeni bir public okuma
 * ucu eklendiğinde bu test, araç eklenene ya da bilinçli dışlama yazılana kadar düşer.
 */
const SPEC_PATH = fileURLToPath(new URL('../../../../api/openapi.yaml', import.meta.url));

/** Araç olarak sunulmayan public okuma uçları ve gerekçeleri. */
const EXCLUDED_READS: Record<string, string> = {
  'GET /v1/apps/{}/api-keys': 'kimlik bilgisi yönetimi; MCP anahtar yüzeyi değildir',
  'GET /v1/apps/{}/identity-keys': 'kimlik bilgisi yönetimi; MCP anahtar yüzeyi değildir',
  'GET /v1/apps/{}/users/{}/companies': 'aynı veri get_user_companies ile (kimlik etiketiyle) alınır',
  'GET /v1/apps/{}/users/by/{}/{}/export': 'toplu kişisel veri dışa aktarımı (KVKK taşınabilirlik); asistan yüzeyine açılmaz',
  'GET /v1/apps/{}/exports': 'yanıt indirme bağlantısı taşır',
  'GET /v1/apps/{}/exports/{}': 'yanıt indirme bağlantısı taşır',
  'GET /v1/notifications/{}/history': 'CSV dışa aktarma işi başlatır ve indirme bağlantısı taşır',
  'GET /v1/apps/{}/wallet/passes': 'kart indirme bağlantısı taşır (ADR-0076)',
  'GET /v1/apps/{}/wallet/passes/{}': 'kart indirme bağlantısı taşır (ADR-0076)',
  'GET /v1/apps/{}/integrations/zapier/me': 'Zapier bağlantı el sıkışması',
  'GET /v1/apps/{}/integrations/zapier/samples': 'Zapier tetikleyici örnekleri',
  'GET /v1/apps/{}/integrations/zapier/hooks': 'abonelik hedef adresleri (Zapier yakalama bağlantıları) taşır',
  'GET /v1/apps/{}/ads/creatives': 'imzalı görsel bağlantısı taşır',
};

/** Yazma araçlarının gidebileceği uçlar: yalnız MCP taslak/test uçları (`mcp:write`). */
const MCP_WRITE_PREFIX = /^POST \/v1\/apps\/\{\}\/mcp\//;

/** Salt okunur olduğu için okuma aracı olarak sunulan POST uçları (sorgu, önizleme, tahmin, denetim). */
const READ_ONLY_POSTS = new Set([
  'POST /v1/apps/{}/segments/preview',
  'POST /v1/apps/{}/segments/{}/estimate',
  'POST /v1/apps/{}/templates/{}/render',
  'POST /v1/apps/{}/users/search',
  'POST /v1/apps/{}/analytics/funnels',
  'POST /v1/apps/{}/analytics/paths',
  'POST /v1/apps/{}/analytics/reports/run',
  'POST /v1/apps/{}/sql/query',
  'POST /v1/apps/{}/data-pipelines/transforms/preview',
  'POST /v1/apps/{}/campaigns/{}/preflight',
]);

interface SpecOp {
  key: string;
  regex: RegExp;
}

function specOperations(): SpecOp[] {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const ops: SpecOp[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/v1/')) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (!item[method]) continue;
      const pattern = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+');
      ops.push({ key: `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`, regex: new RegExp(`^${pattern}$`) });
    }
  }
  return ops;
}

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
}

/** Araç şemasından geçerli asgari argüman üretir (yalnız zorunlu alanlar). */
function sample(schema: JsonSchema, name = ''): unknown {
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return sample(schema.anyOf[0]!, name);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of schema.required ?? []) out[key] = sample(schema.properties?.[key] ?? {}, key);
    return out;
  }
  if (type === 'array') return Array.from({ length: Math.max(schema.minItems ?? 0, 1) }, () => sample(schema.items ?? { type: 'string' }, name));
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (name === 'slug') return 'ornek-sayfa';
  return 'x1';
}

/** Şemadan üretilemeyen (iç içe zorunlu alanlı) argümanlar. */
const ARGS: Record<string, Record<string, unknown>> = {
  run_funnel: { steps: [{ name: 'view' }, { name: 'purchase' }] },
  get_recommendations: { catalog_id: 'cat_1', strategy: 'popular' },
  run_report: { source: 'deliveries', metrics: ['sent'] },
  get_ad_spend_report: { from: '2026-10-01', to: '2026-10-31' },
  get_ad_attribution_report: { from: '2026-10-01', to: '2026-10-31' },
  trace_message: { q: 'msg_1' },
  get_integration: { type: 'slack' },
  list_integration_runs: { type: 'slack' },
};

async function connectWithCalls() {
  const calls: { tool: string; method: string; path: string }[] = [];
  let current = '';
  const api: PushizoApi = {
    async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string): Promise<T> {
      calls.push({ tool: current, method, path: path.split('?')[0]! });
      return { ok: true } as T;
    },
  };
  const server = createPushizoMcpServer({ api, defaultAppId: 'app_1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'parity', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  for (const tool of tools) {
    current = tool.name;
    const args = ARGS[tool.name] ?? (sample(tool.inputSchema) as Record<string, unknown>);
    const result = await client.callTool({ name: tool.name, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(result.isError, `${tool.name}: ${text}`).toBeFalsy();
  }
  return { tools, calls };
}

describe('MCP ↔ public API eşitliği', () => {
  it('her araç tam olarak bir public API işlemine gider; yazma araçları yalnız MCP taslak uçlarına', async () => {
    const ops = specOperations();
    const { tools, calls } = await connectWithCalls();
    expect(calls.map((c) => c.tool)).toEqual(tools.map((t) => t.name));
    const readOnlyByName = new Map(tools.map((t) => [t.name, t.annotations?.readOnlyHint === true]));
    for (const call of calls) {
      const op = ops.find((o) => o.key.startsWith(`${call.method} `) && o.regex.test(call.path));
      expect(op, `${call.tool}: ${call.method} ${call.path} public API'de yok`).toBeDefined();
      if (readOnlyByName.get(call.tool)) {
        expect(call.method === 'GET' || READ_ONLY_POSTS.has(op!.key), `${call.tool}: okuma aracı ${op!.key} çağırıyor`).toBe(true);
      } else {
        expect(op!.key, `${call.tool}: yazma aracı MCP taslak ucu dışına gidiyor`).toMatch(MCP_WRITE_PREFIX);
      }
    }
  });

  it('her public okuma (GET) işlemi bir araçla karşılanır ya da gerekçeli dışlanmıştır', async () => {
    const ops = specOperations();
    const { calls } = await connectWithCalls();
    const covered = new Set(calls.map((c) => ops.find((o) => o.key.startsWith(`${c.method} `) && o.regex.test(c.path))?.key));
    const reads = ops.filter((o) => o.key.startsWith('GET ')).map((o) => o.key);
    const missing = reads.filter((key) => !covered.has(key) && !(key in EXCLUDED_READS));
    expect(missing, `MCP aracı olmayan public okuma uçları:\n${missing.join('\n')}`).toEqual([]);
    // Dışlama listesi güncel kalmalı: listede olup spec'te olmayan ya da artık araçla karşılanan uç kalmamalı.
    const stale = Object.keys(EXCLUDED_READS).filter((key) => !reads.includes(key) || covered.has(key));
    expect(stale).toEqual([]);
  });

  it('MCP taslak uçlarının her biri için bir yazma aracı vardır', async () => {
    const ops = specOperations();
    const { calls } = await connectWithCalls();
    const covered = new Set(calls.map((c) => ops.find((o) => o.key.startsWith(`${c.method} `) && o.regex.test(c.path))?.key));
    const drafts = ops.filter((o) => MCP_WRITE_PREFIX.test(o.key)).map((o) => o.key);
    expect(drafts.length).toBeGreaterThanOrEqual(10);
    expect(drafts.filter((key) => !covered.has(key))).toEqual([]);
  });
});
