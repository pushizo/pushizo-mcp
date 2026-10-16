import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HeroSignalApiError, type HeroSignalApi } from './api.js';

export const MCP_SERVER_NAME = 'herosignal';
export const MCP_SERVER_VERSION = '1.0.0';

export interface HeroSignalMcpOptions {
  api: HeroSignalApi;
  /** Araçta `app_id` verilmezse kullanılan app (app'e bağlı anahtarda anahtarın app'i). */
  defaultAppId?: string;
}

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Yazma araçları: yalnızca taslak oluşturur (gönderim/silme yok), sunucuda `mcp:write` kapsamı zorunlu. */
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const WRITE_NOTE =
  '[Onaylı mod — yazma] Bu araç Pushizo’da kayıt oluşturur. Yalnızca TASLAK oluşturur, hiçbir mesaj göndermez veya zamanlamaz; ' +
  'API anahtarında `mcp:write` kapsamı olmalıdır. Çağırmadan önce kullanıcıdan açık onay alın.';

const appIdArg = z.string().min(1).max(64).optional().describe('App kimliği (app_…). App’e bağlı anahtarda veya varsayılan app tanımlıysa gerekmez.');
const limitArg = z.number().int().min(1).max(100).optional().describe('Sayfa boyutu (varsayılan 20).');
const cursorArg = z.string().max(500).optional().describe('Önceki yanıttaki `next_cursor` değeri.');

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const text =
    err instanceof HeroSignalApiError
      ? `${err.code} (HTTP ${err.status}): ${err.message}${err.status === 403 ? ' — API anahtarının kapsamlarını kontrol edin.' : ''}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * Pushizo MCP sunucusu (ADR-0031 §6): segment/kampanya/mesaj/şablon/analitik okuma ve kampanya/segment taslağı
 * oluşturma araçları. Taşıma bağımsızdır (stdio, Streamable HTTP, testte in-memory).
 */
export function createHeroSignalMcpServer(options: HeroSignalMcpOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Pushizo' },
    {
      instructions:
        'Pushizo bildirim platformu araçları. Okuma araçları serbesttir; create_* araçları yalnızca taslak oluşturur ve kullanıcının açık onayıyla çağrılmalıdır. ' +
        'Gönderim, zamanlama ve silme bu sunucuda yoktur; taslaklar Pushizo dashboard’undan gözden geçirilip gönderilir.',
    },
  );
  const api = options.api;
  const app = (appId?: string): string => {
    const id = appId ?? options.defaultAppId;
    if (!id) throw new Error('app_id gerekli (anahtar organizasyon geneliyse araçta app_id verin).');
    return encodeURIComponent(id);
  };
  const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      return ok(await fn());
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool(
    'list_segments',
    { title: 'Segmentleri listele', description: 'App’in segmentlerini listeler (ad araması ve sayfalama). Gerekli kapsam: segments:read.', inputSchema: { app_id: appIdArg, q: z.string().max(100).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/segments${query({ q: a.q, limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'get_segment',
    { title: 'Segment oku', description: 'Segment tanımı ve tahmini kitle boyutu. Gerekli kapsam: segments:read.', inputSchema: { app_id: appIdArg, segment_id: z.string().min(1).max(64) }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/segments/${encodeURIComponent(a.segment_id)}`)),
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'Kampanyaları listele',
      description: 'Kampanyaları listeler (durum/tür/ad filtresi). Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        q: z.string().max(100).optional(),
        status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed']).optional(),
        limit: limitArg,
        cursor: cursorArg,
      },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/campaigns${query({ q: a.q, status: a.status, limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'get_campaign',
    { title: 'Kampanya oku', description: 'Kampanya ayrıntısı (kitle, içerik, onay durumu, istatistik). Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: z.string().min(1).max(64) }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/campaigns/${encodeURIComponent(a.campaign_id)}`)),
  );

  server.registerTool(
    'list_campaign_messages',
    { title: 'Kampanya çalıştırmaları', description: 'Kampanyanın mesajları (her çalıştırma bir mesaj) ve sayaçları. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: z.string().min(1).max(64) }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/campaigns/${encodeURIComponent(a.campaign_id)}/messages`)),
  );

  server.registerTool(
    'list_messages',
    {
      title: 'Mesajları listele',
      description: 'Gönderilen mesajlar (API, kampanya, journey) ve teslim sayaçları. Gerekli kapsam: analytics:read veya notifications:write.',
      inputSchema: { app_id: appIdArg, limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/notifications${query({ app_id: decodeURIComponent(app(a.app_id)), limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'get_message',
    { title: 'Mesaj oku', description: 'Mesaj durumu ve sayaçları. Gerekli kapsam: analytics:read veya notifications:write.', inputSchema: { app_id: appIdArg, message_id: z.string().min(1).max(64) }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/notifications/${encodeURIComponent(a.message_id)}${query({ app_id: decodeURIComponent(app(a.app_id)) })}`)),
  );

  server.registerTool(
    'get_analytics_summary',
    {
      title: 'Analitik özet',
      description: 'Genel bakış KPI’ları: gönderim, teslim, açılma/tıklama oranları, abonelik büyümesi (son 7/30 gün veya özel aralık). Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        range: z.enum(['7d', '30d']).optional(),
        from: z.string().max(40).optional().describe('ISO-8601 başlangıç (to ile birlikte)'),
        to: z.string().max(40).optional().describe('ISO-8601 bitiş'),
      },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/analytics/overview${query({ range: a.range, from: a.from, to: a.to })}`)),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'Şablonları listele',
      description: 'Mesaj şablonları (kanal/ad filtresi). Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, q: z.string().max(100).optional(), channel: z.string().max(32).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/templates${query({ q: a.q, channel: a.channel, limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'create_campaign_draft',
    {
      title: 'Kampanya taslağı oluştur',
      description:
        `${WRITE_NOTE} Kampanyayı \`draft\` durumunda oluşturur. Kitle segment kimlikleriyle verilir; içerik doğrudan veya template_id ile. ` +
        'Örnek içerik: {"headings":{"tr":"Başlık"},"contents":{"tr":"Metin"}}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(120),
        included_segments: z.array(z.string().min(1).max(64)).max(20).optional().describe('Dahil segmentler; boşsa tüm aboneler.'),
        excluded_segments: z.array(z.string().min(1).max(64)).max(20).optional(),
        channels: z.array(z.string().max(32)).max(10).optional().describe('ör. ["web_push","android_push","ios_push","email","sms"]'),
        content: z.record(z.string(), z.unknown()).optional().describe('Mesaj içeriği (headings/contents/email_subject…).'),
        template_id: z.string().max(64).optional(),
        labels: z.array(z.string().min(1).max(40)).max(9).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      run(() =>
        api.request('POST', `/v1/apps/${app(a.app_id)}/mcp/campaign-drafts`, {
          name: a.name,
          audience: {
            ...(a.included_segments?.length ? { segments: a.included_segments } : { all: true }),
            ...(a.excluded_segments?.length ? { exclude_segments: a.excluded_segments } : {}),
            ...(a.channels?.length ? { channels: a.channels } : {}),
          },
          ...(a.content ? { content: a.content } : {}),
          ...(a.template_id ? { template_id: a.template_id } : {}),
          ...(a.labels ? { labels: a.labels } : {}),
        }),
      ),
  );

  server.registerTool(
    'create_segment_draft',
    {
      title: 'Segment taslağı oluştur',
      description:
        `${WRITE_NOTE} Dinamik segment oluşturur (kampanyada kullanılana kadar etkisi yoktur). Tanım biçimi: ` +
        '{"all":[{"field":"tags.plan","op":"eq","value":"pro"},{"field":"last_active_at","op":"within_days","value":30}]}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        definition: z.record(z.string(), z.unknown()).describe('Segment tanımı (all/any/none koşul grupları).'),
      },
      annotations: WRITE,
    },
    async (a) => run(() => api.request('POST', `/v1/apps/${app(a.app_id)}/mcp/segment-drafts`, { name: a.name, ...(a.description ? { description: a.description } : {}), definition: a.definition })),
  );

  return server;
}
