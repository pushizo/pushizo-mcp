import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { PushizoApiError, createFetchApi, createPushizoMcpServer, parseApiResponse, type PushizoApi } from '../index.js';

function fakeApi(handler: (method: string, path: string, body?: unknown) => unknown) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api: PushizoApi = {
    async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      calls.push({ method, path, body });
      return handler(method, path, body) as T;
    },
  };
  return { api, calls };
}

async function connect(api: PushizoApi, defaultAppId?: string) {
  const server = createPushizoMcpServer({ api, defaultAppId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const text = (r: unknown) => ((r as { content: { type: string; text: string }[] }).content[0]!.text);

describe('Pushizo MCP sunucusu', () => {
  it('araç listesi: okuma araçları readOnlyHint, yazma araçları onaylı mod açıklaması ve destructiveHint=false', async () => {
    const client = await connect(fakeApi(() => ({})).api, 'app_1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // ADR-0043: 11 → 54 araç (eski sağlayıcı MCP'sinin 43 aracından geniş; gerçek kitleye gönderim/silme yok).
    expect(names).toHaveLength(54);
    expect(new Set(names).size).toBe(54);
    expect(names).toEqual(
      expect.arrayContaining([
        'create_campaign_draft',
        'create_segment_draft',
        'create_template_draft',
        'create_journey_draft',
        'create_in_app_draft',
        'send_test_notification',
        'list_journeys',
        'get_journey_stats',
        'search_users',
        'get_user',
        'run_funnel',
        'get_message_report',
        'render_template',
        'get_organization_usage',
      ]),
    );
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
      if (t.name.startsWith('create_')) {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
        expect(t.description).toContain('Onaylı mod');
        expect(t.description).toContain('mcp:write');
      } else if (t.name === 'send_test_notification') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
        expect(t.description).toContain('TEST CİHAZLARINA');
        expect(t.description).toContain('mcp:write');
      } else {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
        expect(t.description).toMatch(/Gerekli kapsam: [a-z:]+/);
      }
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

  it('genişletilmiş okuma araçları doğru public uçları ve sorgu parametrelerini kullanır', async () => {
    const { api, calls } = fakeApi(() => ({ ok: true }));
    const client = await connect(api, 'app_1');
    const callAll: [string, Record<string, unknown>][] = [
      ['get_app', {}],
      ['get_organization_usage', { days: 14 }],
      ['preview_segment', { definition: { all: [{ field: 'tags.vip', op: 'exists' }] }, limit: 5 }],
      ['estimate_segment', { segment_id: 'seg_1' }],
      ['list_segment_campaigns', { segment_id: 'seg_1' }],
      ['get_campaign_stats', { campaign_id: 'cmp_1' }],
      ['get_campaign_variant_stats', { campaign_id: 'cmp_1' }],
      ['get_template', { template_id: 'tpl_1' }],
      ['get_template_stats', { template_id: 'tpl_1' }],
      ['list_template_versions', { template_id: 'tpl_1' }],
      ['render_template', { template_id: 'tpl_1', channel: 'email', user: { tags: { plan: 'pro' } } }],
      ['list_journeys', { status: 'active', q: 'sepet' }],
      ['get_journey', { journey_id: 'jrn_1' }],
      ['get_journey_stats', { journey_id: 'jrn_1', all_versions: true }],
      ['list_journey_runs', { journey_id: 'jrn_1', status: 'waiting', limit: 10 }],
      ['get_journey_run', { journey_id: 'jrn_1', run_id: 'jrr_1' }],
      ['search_users', { definition: { all: [] }, limit: 10 }],
      ['get_user', { label: 'external_id', value: 'u 1/2' }],
      ['get_user_journeys', { label: 'external_id', value: 'u1' }],
      ['get_user_preferences', { label: 'external_id', value: 'u1' }],
      ['list_categories', {}],
      ['list_event_definitions', { limit: 50 }],
      ['get_event_definition', { name: 'purchase' }],
      ['get_message_report', { group_by: 'channel', from: '2026-10-01T00:00:00Z', compare: true }],
      ['get_subscription_report', {}],
      ['get_event_report', { name: 'purchase', group_by: 'day' }],
      ['get_conversion_report', { campaign_id: 'cmp_1' }],
      ['run_funnel', { steps: [{ name: 'view' }, { name: 'purchase', where: { key: 'plan', value: 'pro' } }], window_hours: 24 }],
      ['get_retention_report', { weeks: 4 }],
      ['get_engagement_heatmap', {}],
      ['get_provider_report', {}],
      ['list_in_app_messages', { status: 'active' }],
      ['get_in_app_message', { message_id: 'iam_1' }],
      ['list_web_campaigns', {}],
      ['get_web_campaign_report', { campaign_id: 'wcp_1', days: 7 }],
      ['list_forms', {}],
      ['list_surveys', { status: 'active' }],
      ['get_survey_report', { survey_id: 'srv_1' }],
      ['get_inbox_metrics', { channel: 'chat' }],
    ];
    for (const [name, args] of callAll) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
    }
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/apps/app_1',
      'GET /v1/organization/usage?days=14',
      'POST /v1/apps/app_1/segments/preview',
      'POST /v1/apps/app_1/segments/seg_1/estimate',
      'GET /v1/apps/app_1/segments/seg_1/campaigns',
      'GET /v1/apps/app_1/campaigns/cmp_1/stats',
      'GET /v1/apps/app_1/campaigns/cmp_1/variants/stats',
      'GET /v1/apps/app_1/templates/tpl_1',
      'GET /v1/apps/app_1/templates/tpl_1/stats',
      'GET /v1/apps/app_1/templates/tpl_1/versions',
      'POST /v1/apps/app_1/templates/tpl_1/render',
      'GET /v1/apps/app_1/journeys?status=active&q=sepet',
      'GET /v1/apps/app_1/journeys/jrn_1',
      'GET /v1/apps/app_1/journeys/jrn_1/stats?all_versions=true',
      'GET /v1/apps/app_1/journeys/jrn_1/runs?status=waiting&limit=10',
      'GET /v1/apps/app_1/journeys/jrn_1/runs/jrr_1',
      'POST /v1/apps/app_1/users/search',
      'GET /v1/apps/app_1/users/by/external_id/u%201%2F2',
      'GET /v1/apps/app_1/users/by/external_id/u1/journeys',
      'GET /v1/apps/app_1/users/by/external_id/u1/preferences',
      'GET /v1/apps/app_1/categories',
      'GET /v1/apps/app_1/events/definitions?limit=50',
      'GET /v1/apps/app_1/events/definitions/purchase',
      'GET /v1/apps/app_1/analytics/messages?from=2026-10-01T00%3A00%3A00Z&group_by=channel&compare=true',
      'GET /v1/apps/app_1/analytics/subscriptions',
      'GET /v1/apps/app_1/analytics/events?name=purchase&group_by=day',
      'GET /v1/apps/app_1/analytics/conversions?campaign_id=cmp_1',
      'POST /v1/apps/app_1/analytics/funnels',
      'GET /v1/apps/app_1/analytics/retention?weeks=4',
      'GET /v1/apps/app_1/analytics/engagement',
      'GET /v1/apps/app_1/analytics/providers',
      'GET /v1/apps/app_1/in-app-messages?status=active',
      'GET /v1/apps/app_1/in-app-messages/iam_1',
      'GET /v1/apps/app_1/web-campaigns',
      'GET /v1/apps/app_1/web-campaigns/wcp_1/report?days=7',
      'GET /v1/apps/app_1/forms',
      'GET /v1/apps/app_1/surveys?status=active',
      'GET /v1/apps/app_1/surveys/srv_1/report',
      'GET /v1/apps/app_1/inbox/metrics?channel=chat',
    ]);
    expect(calls[2]!.body).toEqual({ definition: { all: [{ field: 'tags.vip', op: 'exists' }] }, limit: 5 });
    expect(calls[10]!.body).toEqual({ channel: 'email', user: { tags: { plan: 'pro' } } });
    expect(calls[27]!.body).toEqual({ steps: [{ name: 'view' }, { name: 'purchase', where: { key: 'plan', value: 'pro' } }], window_hours: 24 });
  });

  it('şablon/journey/in-app taslakları ve test gönderimi yalnızca MCP uçlarına gider', async () => {
    const { api, calls } = fakeApi(() => ({ id: 'x', status: 'draft' }));
    const client = await connect(api, 'app_1');
    await client.callTool({ name: 'create_template_draft', arguments: { name: 'Sepet', channel: 'ios_push', content: { headings: { tr: 'Sepet' }, contents: { tr: 'Ürünler' } } } });
    await client.callTool({ name: 'create_journey_draft', arguments: { name: 'Hoş geldin', description: 'Yeni kullanıcılar' } });
    await client.callTool({
      name: 'create_in_app_draft',
      arguments: { name: 'Duyuru', triggers: [{ kind: 'session_start' }], display: { layout: 'modal', blocks: [{ type: 'title', text: { tr: 'Yeni' } }] } },
    });
    await client.callTool({ name: 'send_test_notification', arguments: { contents: { tr: 'Test' }, headings: { tr: 'Başlık' } } });
    expect(calls).toEqual([
      { method: 'POST', path: '/v1/apps/app_1/mcp/template-drafts', body: { name: 'Sepet', channel: 'ios_push', content: { headings: { tr: 'Sepet' }, contents: { tr: 'Ürünler' } } } },
      { method: 'POST', path: '/v1/apps/app_1/mcp/journey-drafts', body: { name: 'Hoş geldin', description: 'Yeni kullanıcılar' } },
      {
        method: 'POST',
        path: '/v1/apps/app_1/mcp/in-app-drafts',
        body: { name: 'Duyuru', triggers: [{ kind: 'session_start' }], display: { layout: 'modal', blocks: [{ type: 'title', text: { tr: 'Yeni' } }] } },
      },
      { method: 'POST', path: '/v1/apps/app_1/mcp/test-sends', body: { contents: { tr: 'Test' }, headings: { tr: 'Başlık' } } },
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
      throw new PushizoApiError(403, 'HS_FORBIDDEN', "Bu işlem için 'mcp:write' kapsamı gerekli.");
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
      baseUrl: 'https://api.pushizo.com/',
      apiKey: 'hs_live_x',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ error: { code: 'HS_NOT_FOUND', message: 'Yok' } }), { status: 404 });
      }) as unknown as typeof fetch,
    });
    await expect(api.request('GET', '/v1/apps/a/segments')).rejects.toMatchObject({ status: 404, code: 'HS_NOT_FOUND' });
    expect(seen[0]!.url).toBe('https://api.pushizo.com/v1/apps/a/segments');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer hs_live_x');
    expect(parseApiResponse(200, '{"ok":true}')).toEqual({ ok: true });
  });
});
