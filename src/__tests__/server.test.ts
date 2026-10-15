import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { HeroSignalApiError, createFetchApi, createHeroSignalMcpServer, parseApiResponse, type HeroSignalApi } from '../index.js';

function fakeApi(handler: (method: string, path: string, body?: unknown) => unknown) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api: HeroSignalApi = {
    async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      calls.push({ method, path, body });
      return handler(method, path, body) as T;
    },
  };
  return { api, calls };
}

async function connect(api: HeroSignalApi, defaultAppId?: string) {
  const server = createHeroSignalMcpServer({ api, defaultAppId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const text = (r: unknown) => ((r as { content: { type: string; text: string }[] }).content[0]!.text);

describe('HeroSignal MCP sunucusu', () => {
  it('araç listesi: okuma araçları readOnlyHint, yazma araçları onaylı mod açıklaması ve destructiveHint=false', async () => {
    const client = await connect(fakeApi(() => ({})).api, 'app_1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_campaign_draft',
      'create_segment_draft',
      'get_analytics_summary',
      'get_campaign',
      'get_message',
      'get_segment',
      'list_campaign_messages',
      'list_campaigns',
      'list_messages',
      'list_segments',
      'list_templates',
    ]);
    for (const t of tools) {
      if (t.name.startsWith('create_')) {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
        expect(t.description).toContain('Onaylı mod');
        expect(t.description).toContain('mcp:write');
      } else expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('okuma araçları public API yollarını varsayılan veya verilen app ile çağırır', async () => {
    const { api, calls } = fakeApi((_m, path) => ({ data: [{ path }], next_cursor: null }));
    const client = await connect(api, 'app_default');
    const r = await client.callTool({ name: 'list_segments', arguments: { q: 'vip', limit: 5 } });
    expect(JSON.parse(text(r))).toEqual({ data: [{ path: '/v1/apps/app_default/segments?q=vip&limit=5' }], next_cursor: null });
    await client.callTool({ name: 'get_campaign', arguments: { app_id: 'app_other', campaign_id: 'cmp_1' } });
    await client.callTool({ name: 'get_analytics_summary', arguments: { range: '30d' } });
    await client.callTool({ name: 'list_messages', arguments: { limit: 3 } });
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/apps/app_default/segments?q=vip&limit=5',
      '/v1/apps/app_other/campaigns/cmp_1',
      '/v1/apps/app_default/analytics/overview?range=30d',
      '/v1/notifications?app_id=app_default&limit=3',
    ]);
  });

  it('taslak araçları yalnızca MCP taslak uçlarına POST eder', async () => {
    const { api, calls } = fakeApi(() => ({ id: 'cmp_9', status: 'draft' }));
    const client = await connect(api, 'app_1');
    const r = await client.callTool({
      name: 'create_campaign_draft',
      arguments: { name: 'Kış kampanyası', included_segments: ['seg_1'], channels: ['web_push'], content: { headings: { tr: 'Merhaba' }, contents: { tr: 'Metin' } } },
    });
    expect(r.isError).toBeFalsy();
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/v1/apps/app_1/mcp/campaign-drafts',
      body: { name: 'Kış kampanyası', audience: { segments: ['seg_1'], channels: ['web_push'] }, content: { headings: { tr: 'Merhaba' }, contents: { tr: 'Metin' } } },
    });
    await client.callTool({ name: 'create_segment_draft', arguments: { name: 'VIP', definition: { all: [{ field: 'tags.vip', op: 'exists' }] } } });
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/v1/apps/app_1/mcp/segment-drafts' });
  });

  it('API hatası araç hatası olarak döner (yetki ipucu), app_id yoksa açıklayıcı hata', async () => {
    const client = await connect(fakeApi(() => {
      throw new HeroSignalApiError(403, 'HS_FORBIDDEN', "Bu işlem için 'mcp:write' kapsamı gerekli.");
    }).api);
    const denied = await client.callTool({ name: 'create_segment_draft', arguments: { app_id: 'app_1', name: 'X', definition: {} } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain('HS_FORBIDDEN (HTTP 403)');
    const noApp = await client.callTool({ name: 'list_segments', arguments: {} });
    expect(noApp.isError).toBe(true);
    expect(text(noApp)).toContain('app_id gerekli');
  });

  it('fetch istemcisi Bearer anahtarı gönderir ve hata gövdesini çözer', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const api = createFetchApi({
      baseUrl: 'https://api.example.com/',
      apiKey: 'hs_live_x',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ error: { code: 'HS_NOT_FOUND', message: 'Yok' } }), { status: 404 });
      }) as unknown as typeof fetch,
    });
    await expect(api.request('GET', '/v1/apps/a/segments')).rejects.toMatchObject({ status: 404, code: 'HS_NOT_FOUND' });
    expect(seen[0]!.url).toBe('https://api.example.com/v1/apps/a/segments');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer hs_live_x');
    expect(parseApiResponse(200, '{"ok":true}')).toEqual({ ok: true });
  });
});
