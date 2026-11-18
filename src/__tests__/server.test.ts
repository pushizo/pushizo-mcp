import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_SERVER_VERSION, PushizoApiError, createFetchApi, createPushizoMcpServer, parseApiResponse, type PushizoApi } from '../index.js';

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

async function connect(api: PushizoApi, defaultAppId?: string, scopes?: readonly string[]) {
  const server = createPushizoMcpServer({ api, defaultAppId, scopes });
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
    // ADR-0043: 11 → 54 araç; plan 15 Faz 51: +19 içgörü okuma aracı = 73; public API eşitliği: +126 okuma, +4 taslak = 203;
    // kapsam tamamlama 2. tur (ADR-0095): +25 okuma = 228; kurulum (ADR-0097): +2 okuma, +1 app oluşturma = 231
    // (gerçek kitleye gönderim/silme yok). Yerel stdio sunucusunda ayrıca `upload_channel_credentials` (232).
    expect(names).toHaveLength(231);
    expect(new Set(names).size).toBe(231);
    expect(names).toEqual(
      expect.arrayContaining([
        'create_campaign_draft',
        'create_segment_draft',
        'create_template_draft',
        'create_journey_draft',
        'create_in_app_draft',
        'create_web_campaign_draft',
        'create_web_personalization_draft',
        'create_survey_draft',
        'create_landing_page_draft',
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
        expect(t.description).toContain('Approved mode');
        expect(t.description).toContain('mcp:write');
      } else if (t.name === 'send_test_notification') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
        expect(t.description).toContain('TEST DEVICES');
        expect(t.description).toContain('mcp:write');
      } else {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
        expect(t.description).toMatch(/Required scope: [a-z:]+/);
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
    expect(text(noApp)).toContain('app_id is required');
  });

  it('kimlik ve yol parçalarında `.`/`..` reddedilir; istek API ucuna hiç gitmez (ADR-0076 §5)', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const client = await connect(api, 'app_1');
    const attempts: [string, Record<string, unknown>][] = [
      ['get_segment', { segment_id: '..' }],
      ['get_campaign', { campaign_id: '.' }],
      ['list_segments', { app_id: '..' }],
      ['get_message', { message_id: 'a/b' }],
      ['get_template', { template_id: '..' }],
      ['get_user', { label: '..', value: '..' }],
      ['get_user', { label: 'external_id', value: '..' }],
    ];
    for (const [name, args] of attempts) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(calls).toHaveLength(0);
    // Nokta içeren sıradan değerler geçerlidir (ör. e-posta biçimli external_id).
    const ok = await client.callTool({ name: 'get_user', arguments: { label: 'external_id', value: 'a.b@example.com' } });
    expect(ok.isError).toBeFalsy();
    expect(calls[0]!.path).toBe('/v1/apps/app_1/users/by/external_id/a.b%40example.com');
  });

  it('serverInfo sürümü paket sürümüyle aynıdır', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(MCP_SERVER_VERSION).toBe(pkg.version);
    const client = await connect(fakeApi(() => ({})).api, 'app_1');
    expect(client.getServerVersion()?.version).toBe(pkg.version);
  });

  it('ilk okuma araçları doğru yolları kullanır', async () => {
    const { api, calls } = fakeApi(() => ({ ok: true }));
    const client = await connect(api, 'app_1');
    const callAll: [string, Record<string, unknown>][] = [
      ['get_segment', { segment_id: 'seg_1' }],
      ['list_campaigns', { limit: 2 }],
      ['list_campaign_messages', { campaign_id: 'cmp_1' }],
      ['get_message', { message_id: 'msg_1' }],
      ['list_templates', { q: 'hoş', channel: 'email' }],
    ];
    for (const [name, args] of callAll) expect((await client.callTool({ name, arguments: args })).isError, name).toBeFalsy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/apps/app_1/segments/seg_1',
      'GET /v1/apps/app_1/campaigns?limit=2',
      'GET /v1/apps/app_1/campaigns/cmp_1/messages',
      'GET /v1/notifications/msg_1?app_id=app_1',
      'GET /v1/apps/app_1/templates?q=ho%C5%9F&channel=email',
    ]);
  });

  it('içgörü araçları (Faz 51) doğru public uçları, sorgu ve gövdeyi kullanır', async () => {
    const { api, calls } = fakeApi(() => ({ ok: true }));
    const client = await connect(api, 'app_1');
    const callAll: [string, Record<string, unknown>][] = [
      ['get_rfm_overview', {}],
      ['get_rfm_transitions', { from: '2026-10-01', to: '2026-10-31' }],
      ['list_rfm_users', { segment: 'at_risk', limit: 10, cursor: 'c1' }],
      ['list_predictions', {}],
      ['get_prediction', { prediction_id: 'prd_1' }],
      ['list_prediction_users', { prediction_id: 'prd_1', bucket: 'high' }],
      ['list_feature_flags', {}],
      ['get_feature_flag', { flag_id: 'flg_1' }],
      ['run_path_analysis', { event: 'add_to_cart', direction: 'before', depth: 2 }],
      ['run_report', { source: 'deliveries', metrics: ['sent', 'open_rate'], dimensions: ['channel'], days: 7 }],
      ['list_saved_reports', {}],
      ['get_saved_report', { report_id: 'rep_1' }],
      ['list_decision_agents', {}],
      ['get_decision_agent_report', { agent_id: 'dag_1' }],
      ['list_catalogs', {}],
      ['get_recommendations', { catalog_id: 'cat_1', strategy: 'similar', item_id: 'sku-1', limit: 5 }],
      ['get_channel_score_overview', {}],
      ['list_geofences', {}],
      ['list_wallet_templates', {}],
    ];
    for (const [name, args] of callAll) expect((await client.callTool({ name, arguments: args })).isError, name).toBeFalsy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/apps/app_1/rfm/overview',
      'GET /v1/apps/app_1/rfm/transitions?from=2026-10-01&to=2026-10-31',
      'GET /v1/apps/app_1/rfm/users?segment=at_risk&limit=10&cursor=c1',
      'GET /v1/apps/app_1/predictions',
      'GET /v1/apps/app_1/predictions/prd_1',
      'GET /v1/apps/app_1/predictions/prd_1/users?bucket=high',
      'GET /v1/apps/app_1/feature-flags',
      'GET /v1/apps/app_1/feature-flags/flg_1',
      'POST /v1/apps/app_1/analytics/paths',
      'POST /v1/apps/app_1/analytics/reports/run',
      'GET /v1/apps/app_1/analytics/reports',
      'GET /v1/apps/app_1/analytics/reports/rep_1',
      'GET /v1/apps/app_1/decision-agents',
      'GET /v1/apps/app_1/decision-agents/dag_1/report',
      'GET /v1/apps/app_1/catalogs',
      'GET /v1/apps/app_1/catalogs/cat_1/recommendations?strategy=similar&limit=5&item_id=sku-1',
      'GET /v1/apps/app_1/channel-scores/overview',
      'GET /v1/apps/app_1/geofences',
      'GET /v1/apps/app_1/wallet/templates',
    ]);
    expect(calls[8]!.body).toEqual({ event: 'add_to_cart', direction: 'before', depth: 2 });
    expect(calls[9]!.body).toEqual({ source: 'deliveries', metrics: ['sent', 'open_rate'], dimensions: ['channel'], days: 7, format: 'json' });
  });

  it('eşitlik araçları (Faz 55–67 yetenekleri) doğru public uçları, sorgu ve gövdeyi kullanır', async () => {
    const { api, calls } = fakeApi(() => ({ ok: true }));
    const client = await connect(api, 'app_1');
    const callAll: [string, Record<string, unknown>][] = [
      ['list_companies', { q: 'acme', domain: 'acme.com', limit: 5 }],
      ['list_company_members', { company_id: 'cmp_1', role: 'admin' }],
      ['get_user_companies', { label: 'external_id', value: 'u 1' }],
      ['get_affinity_overview', {}],
      ['get_user_affinity', { user_id: 'usr_1' }],
      ['get_sql_schema', {}],
      ['run_sql_query', { query: 'select 1', row_limit: 10 }],
      ['list_sql_runs', { status: 'ok' }],
      ['list_data_transforms', { target: 'event' }],
      ['preview_data_transform', { target: 'event', records: [{ name: 'purchase' }], transform_id: 'dtf_1' }],
      ['list_quarantined_records', { status: 'pending', limit: 20 }],
      ['list_warehouse_segment_runs', { segment_id: 'seg_1' }],
      ['list_ai_agent_runs', { agent_id: 'aia_1', status: 'handed_off' }],
      ['get_ai_agent_metrics', { agent_id: 'aia_1' }],
      ['list_custom_agent_drafts', { status: 'pending' }],
      ['get_uninstall_report', { from: '2026-11-01T00:00:00Z', compare: true }],
      ['get_android_delivery_report', {}],
      ['run_campaign_preflight', { campaign_id: 'cmp_1', check_links: true }],
      ['list_web_personalizations', { status: 'active' }],
      ['get_web_personalization_report', { personalization_id: 'wpz_1', days: 7 }],
      ['get_site_search', {}],
      ['list_site_search_sources', {}],
      ['list_site_search_documents', { source_id: 'api', q: 'iade' }],
      ['get_site_search_report', { days: 14 }],
      ['list_conversations', { channel: 'telegram', unread: true }],
      ['list_message_deliveries', { message_id: 'msg_1', status: 'failed' }],
      ['list_audit_logs', { action: 'app.update' }],
    ];
    for (const [name, args] of callAll) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${text(r)}`).toBeFalsy();
    }
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/apps/app_1/companies?limit=5&q=acme&domain=acme.com',
      'GET /v1/apps/app_1/companies/cmp_1/members?role=admin',
      'GET /v1/apps/app_1/users/by/external_id/u%201/companies',
      'GET /v1/apps/app_1/affinity/overview',
      'GET /v1/apps/app_1/affinity/users/usr_1',
      'GET /v1/apps/app_1/sql/schema',
      'POST /v1/apps/app_1/sql/query',
      'GET /v1/apps/app_1/sql/runs?status=ok',
      'GET /v1/apps/app_1/data-pipelines/transforms?target=event',
      'POST /v1/apps/app_1/data-pipelines/transforms/preview',
      'GET /v1/apps/app_1/data-pipelines/quarantine?status=pending&limit=20',
      'GET /v1/apps/app_1/warehouse-segments/runs?segment_id=seg_1',
      'GET /v1/apps/app_1/ai-agents/runs?agent_id=aia_1&status=handed_off',
      'GET /v1/apps/app_1/ai-agents/aia_1/metrics',
      'GET /v1/apps/app_1/custom-agents/drafts?status=pending',
      'GET /v1/apps/app_1/analytics/uninstalls?from=2026-11-01T00%3A00%3A00Z&compare=true',
      'GET /v1/apps/app_1/analytics/android-delivery',
      'POST /v1/apps/app_1/campaigns/cmp_1/preflight?check_links=true',
      'GET /v1/apps/app_1/web-personalizations?status=active',
      'GET /v1/apps/app_1/web-personalizations/wpz_1/report?days=7',
      'GET /v1/apps/app_1/site-search',
      'GET /v1/apps/app_1/site-search/sources',
      'GET /v1/apps/app_1/site-search/documents?source_id=api&q=iade',
      'GET /v1/apps/app_1/site-search/report?days=14',
      'GET /v1/apps/app_1/conversations?channel=telegram&unread=true',
      'GET /v1/notifications/msg_1/deliveries?app_id=app_1&status=failed',
      'GET /v1/organization/audit-logs?action=app.update',
    ]);
    expect(calls[6]!.body).toEqual({ query: 'select 1', row_limit: 10 });
    expect(calls[9]!.body).toEqual({ target: 'event', records: [{ name: 'purchase' }], transform_id: 'dtf_1' });
    expect(calls[17]!.body).toBeUndefined();
  });

  it('web büyüme taslakları yalnız MCP taslak uçlarına gider', async () => {
    const { api, calls } = fakeApi(() => ({ id: 'x', status: 'draft' }));
    const client = await connect(api, 'app_1');
    const display = { layout: 'popup', blocks: [{ type: 'title', text: { tr: 'Bülten' } }] };
    await client.callTool({ name: 'create_web_campaign_draft', arguments: { name: 'Bülten', display, trigger: { kind: 'page_load' }, priority: 5 } });
    await client.callTool({ name: 'create_web_personalization_draft', arguments: { name: 'Başlık', changes: [{ action: 'text', selector: 'h1', text: { tr: 'Merhaba' } }], goal: { type: 'click', selector: 'a.cta' } } });
    await client.callTool({ name: 'create_survey_draft', arguments: { name: 'NPS', questions: [{ id: 'nps', type: 'nps', text: { tr: 'Tavsiye eder misiniz?' } }] } });
    await client.callTool({ name: 'create_landing_page_draft', arguments: { name: 'Kış', slug: 'kis', document: { version: 1, sections: [] } } });
    expect(calls).toEqual([
      { method: 'POST', path: '/v1/apps/app_1/mcp/web-campaign-drafts', body: { name: 'Bülten', display, trigger: { kind: 'page_load' }, priority: 5 } },
      {
        method: 'POST',
        path: '/v1/apps/app_1/mcp/web-personalization-drafts',
        body: { name: 'Başlık', changes: [{ action: 'text', selector: 'h1', text: { tr: 'Merhaba' } }], goal: { type: 'click', selector: 'a.cta' } },
      },
      { method: 'POST', path: '/v1/apps/app_1/mcp/survey-drafts', body: { name: 'NPS', questions: [{ id: 'nps', type: 'nps', text: { tr: 'Tavsiye eder misiniz?' } }] } },
      { method: 'POST', path: '/v1/apps/app_1/mcp/landing-page-drafts', body: { name: 'Kış', slug: 'kis', document: { version: 1, sections: [] } } },
    ]);
    const badSlug = await client.callTool({ name: 'create_landing_page_draft', arguments: { name: 'Kış', slug: 'Kış Sayfası', document: {} } });
    expect(badSlug.isError).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it('şema reddi: sınır dışı ve biçimsiz girdiler API çağrısı yapılmadan döner', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const client = await connect(api, 'app_1');
    const attempts: [string, Record<string, unknown>][] = [
      ['list_segments', { limit: 101 }],
      ['get_rfm_transitions', { from: '01.10.2026' }],
      ['list_rfm_users', { segment: 'yok' }],
      ['run_report', { source: 'deliveries', metrics: [] }],
      ['get_recommendations', { catalog_id: 'cat_1', strategy: 'popular', limit: 21 }],
    ];
    for (const [name, args] of attempts) expect((await client.callTool({ name, arguments: args })).isError, name).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('yazma araçları yalnızca kapsam `mcp:write` veya `admin` içeriyorsa listelenir; kapsam bilinmiyorsa hepsi', async () => {
    const names = async (scopes?: readonly string[]) => (await (await connect(fakeApi(() => ({})).api, 'app_1', scopes)).listTools()).tools.map((t) => t.name);
    const writeTools = [
      'create_campaign_draft',
      'create_segment_draft',
      'create_template_draft',
      'create_journey_draft',
      'create_in_app_draft',
      'create_web_campaign_draft',
      'create_web_personalization_draft',
      'create_survey_draft',
      'create_landing_page_draft',
      'send_test_notification',
      'create_app',
    ];
    const readOnly = await names(['analytics:read', 'users:read']);
    expect(readOnly).toHaveLength(231 - writeTools.length);
    for (const tool of writeTools) expect(readOnly).not.toContain(tool);
    expect(await names(['mcp:write'])).toEqual(expect.arrayContaining(writeTools));
    expect(await names(['admin'])).toEqual(expect.arrayContaining(writeTools));
    expect(await names()).toHaveLength(231);
  });

  it('hız sınırı ve zaman aşımı hataları yeniden deneme ipucuyla döner', async () => {
    const limited = await connect(fakeApi(() => {
      throw new PushizoApiError(429, 'HS_RATE_LIMITED', 'Çok fazla istek.');
    }).api, 'app_1');
    expect(text(await limited.callTool({ name: 'list_predictions', arguments: {} }))).toContain('wait a few seconds and retry');
    const slow = await connect(fakeApi(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }).api, 'app_1');
    const timedOut = await slow.callTool({ name: 'run_report', arguments: { source: 'events', metrics: ['count'] } });
    expect(timedOut.isError).toBe(true);
    expect(text(timedOut)).toContain('Request timed out');
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
