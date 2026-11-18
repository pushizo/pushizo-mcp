import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, aliasArgs, appIdArg, cursorArg, fromArg, idArg, limitArg, query, seg, toArg, type ToolKit } from './kit.js';

/**
 * Veri ve yapılandırma okuma araçları (public API ↔ MCP eşitliği): organizasyon ve app'ler, kullanıcı listesi, şirketler
 * (ADR-0090), ilgi etiketleri ve kişi başına sıklık (ADR-0081), SQL sorgu ve SQL segment (ADR-0087), veri boru hattı
 * (ADR-0088), ambar segmenti (ADR-0091), ambar dışa aktarımı, reverse ETL, dinamik içerik ve webhook'lar. Hepsi mevcut
 * public API uçlarını çağırır; yetki her çağrıda sunucuda denetlenir. Kimlik bilgisi yöneten (API anahtarı, kimlik
 * anahtarı), indirme bağlantısı taşıyan (dışa aktarım, Wallet kartı, kişi verisi dışa aktarımı) uçlar bilerek yoktur.
 * `run_sql_query` yalnız SELECT çalıştırır (sunucu doğrular, salt okunur transaction); `preview_data_transform` kuru
 * çalıştırmadır, kayıt yazmaz.
 */
export function registerDataTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  // ---- organizasyon ve app'ler
  server.registerTool(
    'get_organization',
    { title: 'Get organization', description: 'Organization that owns the key (org-wide admin key). Works only with an organization-wide admin key. Required scope: admin.', inputSchema: {}, annotations: READ },
    async () => get(`/v1/organization`),
  );
  server.registerTool(
    'list_organization_members',
    { title: 'Organization members', description: 'Organization members (org-wide admin key). Contains personal data (names, emails). Required scope: admin.', inputSchema: {}, annotations: READ },
    async () => get(`/v1/organization/members`),
  );
  server.registerTool(
    'list_audit_logs',
    {
      title: 'Audit log',
      description: 'Audit log (org-wide admin key; action/actor/app/date filters, cursor). Required scope: admin.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, action: z.string().max(100).optional(), actor_id: z.string().max(64).optional(), app_id: z.string().max(64).optional(), from: fromArg, to: toArg },
      annotations: READ,
    },
    async (a) => get(`/v1/organization/audit-logs${query({ limit: a.limit, cursor: a.cursor, action: a.action, actor_id: a.actor_id, app_id: a.app_id, from: a.from, to: a.to })}`),
  );
  server.registerTool(
    'list_apps',
    { title: 'List apps', description: 'List apps (org-wide admin key). Required scope: admin.', inputSchema: {}, annotations: READ },
    async () => get(`/v1/apps`),
  );
  server.registerTool(
    'list_channels',
    { title: 'Channel configurations', description: 'Channel configurations. Shows which channels are configured; credentials are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channels`),
  );
  server.registerTool(
    'list_live_activity_types',
    { title: 'Live Activity types', description: 'Live Activity types. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/live-activities/types`),
  );

  // ---- kullanıcılar, abonelikler, şirketler (ADR-0090)
  server.registerTool(
    'list_users',
    {
      title: 'List users',
      description: 'List users. Contains personal data; request only what you need. For condition-based search use search_users. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, sort: z.enum(['last_active_at', '-last_active_at']).optional(), q: z.string().max(255).optional().describe('Search text.'), ip: z.string().max(64).optional(), tag: z.string().max(320).optional(), last_active_after: z.string().max(200).optional(), last_active_before: z.string().max(200).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users${query({ limit: a.limit, cursor: a.cursor, sort: a.sort, q: a.q, ip: a.ip, tag: a.tag, last_active_after: a.last_active_after, last_active_before: a.last_active_before })}`),
  );
  server.registerTool(
    'get_user_identity',
    { title: 'User identities', description: 'All identities of the user (hs_id, external_id, custom aliases). Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/identity`),
  );
  server.registerTool(
    'get_user_inbox',
    {
      title: 'User notification inbox',
      description: 'The user’s notification inbox (including unread count). Includes content cards delivered to the user. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, ...aliasArgs, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, include_archived: z.boolean().optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/inbox${query({ limit: a.limit, cursor: a.cursor, include_archived: a.include_archived })}`),
  );
  server.registerTool(
    'get_subscription',
    { title: 'Get subscription', description: 'Subscription details. Required scope: users:read.', inputSchema: { app_id: appIdArg, subscription_id: idArg('Subscription') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/subscriptions/${seg(a.subscription_id)}`),
  );
  server.registerTool(
    'get_subscription_identity',
    { title: 'Subscription owner identities', description: 'Identities of the user who owns the subscription. Required scope: users:read.', inputSchema: { app_id: appIdArg, subscription_id: idArg('Subscription') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/subscriptions/${seg(a.subscription_id)}/user/identity`),
  );
  server.registerTool(
    'list_suppressions',
    {
      title: 'Suppression list',
      description: 'Suppression list (email/SMS addresses that will not be sent to; channel/reason/value filter). Contains personal data (addresses). Required scope: users:read.',
      inputSchema: { app_id: appIdArg, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'telegram', 'viber']).optional(), reason: z.enum(['bounce', 'complaint', 'manual', 'unsubscribe_link', 'stop']).optional(), value: z.string().max(320).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/suppressions${query({ limit: a.limit, cursor: a.cursor, channel: a.channel, reason: a.reason, value: a.value })}`),
  );
  server.registerTool(
    'list_companies',
    {
      title: 'List companies',
      description: 'List companies. B2B account objects. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, q: z.string().max(200).optional().describe('Search text.'), external_id: z.string().max(200).optional(), domain: z.string().max(253).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/companies${query({ limit: a.limit, cursor: a.cursor, q: a.q, external_id: a.external_id, domain: a.domain })}`),
  );
  server.registerTool(
    'get_company',
    { title: 'Get company', description: 'Get a company. Required scope: users:read.', inputSchema: { app_id: appIdArg, company_id: idArg('Company') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/companies/${seg(a.company_id)}`),
  );
  server.registerTool(
    'list_company_members',
    {
      title: 'Company members',
      description: 'List company members. Contains personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, company_id: idArg('Company'), limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, role: z.string().max(200).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/companies/${seg(a.company_id)}/members${query({ limit: a.limit, cursor: a.cursor, role: a.role })}`),
  );
  server.registerTool(
    'get_user_companies',
    {
      title: 'User companies',
      description: 'List a user’s companies (by external_id or alias). The most recently linked company comes first. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, ...aliasArgs },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/companies`),
  );

  // ---- ilgi etiketleri ve kişi başına sıklık (ADR-0081), kanal skoru, RFM modeli
  server.registerTool(
    'get_affinity_config',
    {
      title: 'Interest model settings',
      description: 'Interest model. Which event properties feed interest scores and whether the per-person frequency cap is on. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/affinity/config`),
  );
  server.registerTool(
    'get_affinity_overview',
    { title: 'Interest overview', description: 'Most common interests per attribute. Required scope: analytics:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/affinity/overview`),
  );
  server.registerTool(
    'get_user_affinity',
    {
      title: 'User interests and frequency cap',
      description: 'The contact’s interests and weekly frequency cap. Takes the internal user ID (`id` from get_user). Required scope: users:read.',
      inputSchema: { app_id: appIdArg, user_id: idArg('User') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/affinity/users/${seg(a.user_id)}`),
  );
  server.registerTool(
    'get_channel_score_config',
    { title: 'Channel score settings', description: 'Channel score settings. Required scope: analytics:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channel-scores/config`),
  );
  server.registerTool(
    'list_channel_score_users',
    {
      title: 'Users by best channel',
      description: 'Users with a known best channel. Contains personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, channel: z.enum(['push', 'email', 'whatsapp', 'rcs', 'sms']).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channel-scores/users${query({ channel: a.channel, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_user_channel_scores',
    { title: 'User channel scores', description: 'The user’s channel scores. Takes the internal user ID (`id` from get_user). Required scope: users:read.', inputSchema: { app_id: appIdArg, user_id: idArg('User') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channel-scores/users/${seg(a.user_id)}`),
  );
  server.registerTool(
    'get_rfm_config',
    { title: 'RFM model settings', description: 'RFM model. Required scope: analytics:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/config`),
  );

  // ---- SQL sorgu ve SQL segment (ADR-0087)
  server.registerTool(
    'get_sql_schema',
    {
      title: 'SQL views and limits',
      description: 'SQL views and limits. Call this before run_sql_query to learn the available `sql_api` views, columns and limits. Required scope: segments:read or users:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/sql/schema`),
  );
  server.registerTool(
    'list_sql_runs',
    {
      title: 'SQL query log',
      description: 'SQL query log. Required scope: segments:read or users:read.',
      inputSchema: { app_id: appIdArg, segment_id: z.string().max(200).optional(), status: z.enum(['ok', 'rejected', 'timeout', 'failed']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/sql/runs${query({ segment_id: a.segment_id, status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_sql_segments',
    { title: 'SQL segments', description: 'SQL segments. Required scope: segments:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/sql/segments`),
  );

  // ---- veri boru hattı (ADR-0088)
  server.registerTool(
    'list_data_transforms',
    { title: 'Data transformations', description: 'Data transformations. Required scope: users:read.', inputSchema: { app_id: appIdArg, target: z.enum(['event', 'person']).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-pipelines/transforms${query({ target: a.target })}`),
  );
  server.registerTool(
    'get_data_transform',
    { title: 'Get data transformation', description: 'Data transformation. Required scope: users:read.', inputSchema: { app_id: appIdArg, transform_id: idArg('Transform') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-pipelines/transforms/${seg(a.transform_id)}`),
  );
  server.registerTool(
    'list_data_sources',
    { title: 'Data sources', description: 'Data sources (webhook and HTTP pull). Signing secrets are never returned. Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-pipelines/sources`),
  );
  server.registerTool(
    'get_data_source',
    { title: 'Get data source', description: 'Data source. Required scope: users:read.', inputSchema: { app_id: appIdArg, source_id: idArg('Source') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-pipelines/sources/${seg(a.source_id)}`),
  );
  server.registerTool(
    'list_quarantined_records',
    {
      title: 'Quarantined records',
      description: 'Quarantined records. Records a transformation rejected; may contain personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['pending', 'reprocessed', 'discarded']).optional(), target: z.enum(['event', 'person']).optional(), source_id: z.string().max(200).optional(), transform_id: z.string().max(200).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-pipelines/quarantine${query({ status: a.status, target: a.target, source_id: a.source_id, transform_id: a.transform_id, limit: a.limit, cursor: a.cursor })}`),
  );

  // ---- ambar segmenti (ADR-0091), ambar dışa aktarımı, reverse ETL
  server.registerTool(
    'get_warehouse_segment_options',
    { title: 'Warehouse segment options', description: 'Warehouse segment options and limits. Required scope: segments:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-segments/options`),
  );
  server.registerTool(
    'list_warehouse_connections',
    { title: 'Warehouse connections', description: 'Warehouse connections. Credentials are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-segments/connections`),
  );
  server.registerTool(
    'get_warehouse_connection',
    { title: 'Get warehouse connection', description: 'Warehouse connection details. Credentials are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg, connection_id: idArg('Connection') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-segments/connections/${seg(a.connection_id)}`),
  );
  server.registerTool(
    'list_warehouse_segments',
    { title: 'Warehouse segments', description: 'Warehouse segments. Required scope: segments:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-segments/segments`),
  );
  server.registerTool(
    'list_warehouse_segment_runs',
    {
      title: 'Warehouse query log',
      description: 'Warehouse query log. Required scope: segments:read.',
      inputSchema: { app_id: appIdArg, segment_id: z.string().max(200).optional(), connection_id: z.string().max(200).optional(), status: z.enum(['ok', 'rejected', 'timeout', 'failed']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-segments/runs${query({ segment_id: a.segment_id, connection_id: a.connection_id, status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_warehouse_export_tables',
    { title: 'Exportable tables', description: 'Exportable tables, columns and schema versions. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-exports/tables`),
  );
  server.registerTool(
    'list_warehouse_exports',
    { title: 'Data warehouse exports', description: 'Data warehouse exports. Credentials are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-exports`),
  );
  server.registerTool(
    'get_warehouse_export',
    { title: 'Get warehouse export', description: 'Export details. Required scope: admin.', inputSchema: { app_id: appIdArg, export_id: idArg('Export') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-exports/${seg(a.export_id)}`),
  );
  server.registerTool(
    'list_warehouse_export_runs',
    {
      title: 'Warehouse export runs',
      description: 'Run history (cursor). Required scope: admin.',
      inputSchema: { app_id: appIdArg, export_id: idArg('Export'), limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/warehouse-exports/${seg(a.export_id)}/runs${query({ limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_reverse_etl_syncs',
    { title: 'Warehouse imports (reverse ETL)', description: 'Imports from warehouses. Credentials are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/reverse-etl`),
  );
  server.registerTool(
    'get_reverse_etl_sync',
    { title: 'Get warehouse import', description: 'Import details. Required scope: admin.', inputSchema: { app_id: appIdArg, sync_id: idArg('Sync') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/reverse-etl/${seg(a.sync_id)}`),
  );
  server.registerTool(
    'list_reverse_etl_runs',
    {
      title: 'Warehouse import runs',
      description: 'Import history. Required scope: admin.',
      inputSchema: { app_id: appIdArg, sync_id: idArg('Sync'), limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/reverse-etl/${seg(a.sync_id)}/runs${query({ limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_imports',
    { title: 'Import jobs', description: 'Import jobs. Required scope: admin.', inputSchema: { app_id: appIdArg, limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/imports${query({ limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_import',
    { title: 'Get import job', description: 'Import status. Required scope: admin.', inputSchema: { app_id: appIdArg, import_id: idArg('Import') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/imports/${seg(a.import_id)}`),
  );

  // ---- dinamik içerik: veri akışı, içerik tablosu, promosyon kodu, katalog
  server.registerTool(
    'list_data_feeds',
    { title: 'Data feeds', description: 'List data feeds. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-feeds`),
  );
  server.registerTool(
    'get_data_feed',
    { title: 'Get data feed', description: 'Data feed details. Required scope: admin.', inputSchema: { app_id: appIdArg, feed_id: idArg('Feed') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/data-feeds/${seg(a.feed_id)}`),
  );
  server.registerTool(
    'list_content_tables',
    { title: 'Content tables', description: 'Content tables. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/content-tables`),
  );
  server.registerTool(
    'get_content_table',
    { title: 'Get content table', description: 'Content table details. Required scope: admin.', inputSchema: { app_id: appIdArg, table_id: idArg('Table') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/content-tables/${seg(a.table_id)}`),
  );
  server.registerTool(
    'list_content_table_rows',
    {
      title: 'Content table rows',
      description: 'Content table rows. Required scope: admin.',
      inputSchema: { app_id: appIdArg, table_id: idArg('Table'), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(100000).optional().describe('Rows to skip.'), q: z.string().max(200).optional().describe('Search text.') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/content-tables/${seg(a.table_id)}/rows${query({ limit: a.limit, offset: a.offset, q: a.q })}`),
  );
  server.registerTool(
    'list_promo_code_lists',
    { title: 'Promo code lists', description: 'Promo code lists. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/promo-code-lists`),
  );
  server.registerTool(
    'get_promo_code_list',
    { title: 'Get promo code list', description: 'Promo code list details. Required scope: admin.', inputSchema: { app_id: appIdArg, list_id: idArg('List') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/promo-code-lists/${seg(a.list_id)}`),
  );
  server.registerTool(
    'list_promo_codes',
    {
      title: 'Promo codes',
      description: 'Codes in the list and their assignments. Shows codes and who they were assigned to. Required scope: admin.',
      inputSchema: { app_id: appIdArg, list_id: idArg('List'), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(1000000).optional().describe('Rows to skip.'), q: z.string().max(128).optional().describe('Search text.'), status: z.enum(['available', 'assigned']).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/promo-code-lists/${seg(a.list_id)}/codes${query({ limit: a.limit, offset: a.offset, q: a.q, status: a.status })}`),
  );
  server.registerTool(
    'get_catalog',
    { title: 'Get catalog', description: 'Catalog details. Required scope: admin or analytics:read.', inputSchema: { app_id: appIdArg, catalog_id: idArg('Catalog') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}`),
  );
  server.registerTool(
    'list_catalog_items',
    {
      title: 'Catalog products',
      description: 'Products. Required scope: admin or analytics:read.',
      inputSchema: { app_id: appIdArg, catalog_id: idArg('Catalog'), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(1000000).optional().describe('Rows to skip.'), q: z.string().max(200).optional().describe('Search text.'), category: z.string().max(200).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}/items${query({ limit: a.limit, offset: a.offset, q: a.q, category: a.category })}`),
  );
  server.registerTool(
    'get_catalog_item',
    { title: 'Get catalog product', description: 'Product details. Required scope: admin or analytics:read.', inputSchema: { app_id: appIdArg, catalog_id: idArg('Catalog'), item_id: idArg('Item') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}/items/${seg(a.item_id)}`),
  );
  server.registerTool(
    'get_recommendation_config',
    { title: 'Recommendation model', description: 'Recommendation model. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, catalog_id: idArg('Catalog') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}/recommendations/config`),
  );
  server.registerTool(
    'get_geofence',
    { title: 'Get geofence', description: 'Geofence details. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, geofence_id: idArg('Geofence') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/geofences/${seg(a.geofence_id)}`),
  );
  server.registerTool(
    'get_wallet_config',
    { title: 'Wallet configuration', description: 'Wallet configuration. Certificates and keys are never returned. Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/wallet/config`),
  );
  server.registerTool(
    'get_wallet_template',
    { title: 'Get wallet template', description: 'Wallet template. Required scope: users:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Wallet template') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/wallet/templates/${seg(a.template_id)}`),
  );
  server.registerTool(
    'get_decision_agent',
    { title: 'Get decision agent', description: 'Decision agent. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, agent_id: idArg('Decision agent') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/decision-agents/${seg(a.agent_id)}`),
  );

  // ---- webhook'lar
  server.registerTool(
    'list_webhooks',
    { title: 'Webhook endpoints', description: 'Webhook endpoints. Signing secrets are never returned. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/webhooks`),
  );
  server.registerTool(
    'get_webhook',
    { title: 'Get webhook endpoint', description: 'Endpoint details. Required scope: admin.', inputSchema: { app_id: appIdArg, webhook_id: idArg('Webhook') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/webhooks/${seg(a.webhook_id)}`),
  );
  server.registerTool(
    'list_webhook_deliveries',
    {
      title: 'Webhook delivery history',
      description: 'Delivery history (cursor; status/event type filter). Required scope: admin.',
      inputSchema: { app_id: appIdArg, webhook_id: idArg('Webhook'), limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg, status: z.enum(['pending', 'success', 'failed', 'dead']).optional(), event_type: z.string().max(64).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/webhooks/${seg(a.webhook_id)}/deliveries${query({ limit: a.limit, cursor: a.cursor, status: a.status, event_type: a.event_type })}`),
  );

  // ---- salt okunur çalıştırmalar: SQL sorgusu ve dönüştürme önizlemesi
  server.registerTool(
    'run_sql_query',
    {
      title: 'Run read-only SQL query',
      description:
        'Runs a single read-only SELECT over the app’s `sql_api` views (see get_sql_schema for views, columns and limits). The server rejects anything other than SELECT, ' +
        'runs it in a read-only transaction with a timeout and row limit, and logs the query. Results may contain personal data; select only the columns you need. ' +
        'Example: {"query":"select platform, count(*) from sql_api.subscriptions group by 1"}. Required scope: users:read.',
      inputSchema: {
        app_id: appIdArg,
        query: z.string().min(1).max(20000).describe('One SELECT statement over `sql_api.*` views.'),
        row_limit: z.number().int().min(1).max(5000).optional().describe('Maximum rows to return (default from get_sql_schema limits).'),
        timeout_ms: z.number().int().min(1000).max(30000).optional(),
      },
      annotations: READ,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/sql/query`, { query: a.query, ...(a.row_limit ? { row_limit: a.row_limit } : {}), ...(a.timeout_ms ? { timeout_ms: a.timeout_ms } : {}) }),
  );
  server.registerTool(
    'preview_data_transform',
    {
      title: 'Preview data transformation',
      description:
        'Dry-runs data transformations against sample records and returns the transformed, dropped and quarantined results; nothing is stored. ' +
        'Give `transform` (an unsaved definition, get_data_transform format) or `transform_id`; with neither, all enabled transformations of the app run. Required scope: admin.',
      inputSchema: {
        app_id: appIdArg,
        target: z.enum(['event', 'person']),
        source: z.enum(['sdk', 'api', 'import', 'system', 'webhook_source', 'pull_source']).optional().describe('Record source to simulate (default `api`).'),
        records: z.array(z.record(z.string(), z.unknown())).min(1).max(20).describe('Sample records.'),
        transform: z.record(z.string(), z.unknown()).optional().describe('Unsaved transformation definition (kind + rules or code).'),
        transform_id: idArg('Transformation').optional(),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/data-pipelines/transforms/preview`, {
        target: a.target,
        records: a.records,
        ...(a.source ? { source: a.source } : {}),
        ...(a.transform ? { transform: a.transform } : {}),
        ...(a.transform_id ? { transform_id: a.transform_id } : {}),
      }),
  );
}
