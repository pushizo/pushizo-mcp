import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, appIdArg, cursorArg, idArg, limitArg, query, seg, type ToolKit } from './kit.js';

const dayArg = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Provide a day in YYYY-MM-DD format.')
    .optional()
    .describe(what);
const isoArg = (what: string) => z.string().max(40).optional().describe(what);

const RFM_SEGMENTS = ['champions', 'loyal', 'potential', 'new', 'promising', 'need_attention', 'about_to_sleep', 'at_risk', 'cant_lose', 'hibernating', 'lost'] as const;
const RECOMMENDATION_STRATEGIES = ['personalized', 'popular', 'trending', 'similar', 'category', 'recently_viewed', 'new_arrivals'] as const;
const REPORT_SOURCES = ['deliveries', 'events', 'conversions'] as const;

/**
 * İçgörü ve yapılandırma okuma araçları (plan 15 Faz 51, ADR-0076): RFM, öngörü modelleri, özellik bayrakları, yol
 * analizi, rapor oluşturucu, karar ajanları, katalog ve öneriler, kanal skoru, bölgeler, Wallet şablonları. Hepsi
 * mevcut public API okuma uçlarını çağırır; hesap tetikleyen, karar yazan veya kart veren uçlar bilerek yoktur.
 * Wallet kartları (indirme bağlantısı taşır) araç olarak sunulmaz.
 */
export function registerInsightTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  // ---- RFM
  server.registerTool(
    'get_rfm_overview',
    {
      title: 'RFM overview',
      description: 'User counts and shares per RFM segment (champions, at_risk, lost…) and last computation time. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/overview`),
  );
  server.registerTool(
    'get_rfm_transitions',
    {
      title: 'RFM segment transitions',
      description: 'How users moved between RFM segments between two days (default: last 30 days). Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, from: dayArg('Start day (YYYY-MM-DD); defaults to 30 days ago.'), to: dayArg('End day (YYYY-MM-DD); defaults to today.') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/transitions${query({ from: a.from, to: a.to })}`),
  );
  server.registerTool(
    'list_rfm_users',
    {
      title: 'Users in an RFM segment',
      description: 'Users in an RFM segment with their R/F/M scores. For more, pass the response `next_cursor` as `cursor`. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, segment: z.enum(RFM_SEGMENTS).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/users${query({ segment: a.segment, limit: a.limit, cursor: a.cursor })}`),
  );

  // ---- öngörü modelleri
  server.registerTool(
    'list_predictions',
    {
      title: 'List prediction models',
      description: 'Churn risk and event likelihood models: status, quality metric and last training time. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions`),
  );
  server.registerTool(
    'get_prediction',
    {
      title: 'Get prediction model',
      description: 'Details of a single model: definition, quality (AUC, accuracy), score distribution. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, prediction_id: idArg('Prediction model') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions/${seg(a.prediction_id)}`),
  );
  server.registerTool(
    'list_prediction_users',
    {
      title: 'Users by prediction score',
      description: 'Users scored by the model; `bucket` selects the low/medium/high likelihood group. Use `next_cursor` for more. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, prediction_id: idArg('Prediction model'), bucket: z.enum(['low', 'medium', 'high']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions/${seg(a.prediction_id)}/users${query({ bucket: a.bucket, limit: a.limit, cursor: a.cursor })}`),
  );

  // ---- özellik bayrakları
  server.registerTool(
    'list_feature_flags',
    {
      title: 'List feature flags',
      description: 'Feature flags: status, rollout percentage, target segment and remote config values. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/feature-flags`),
  );
  server.registerTool(
    'get_feature_flag',
    {
      title: 'Get feature flag',
      description: 'Details of a single flag: staged rollout schedule, targeting and values. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, flag_id: idArg('Flag') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/feature-flags/${seg(a.flag_id)}`),
  );

  // ---- analitik: yol analizi ve rapor oluşturucu
  server.registerTool(
    'run_path_analysis',
    {
      title: 'User path analysis',
      description:
        'Event paths users follow after (`after`) or before (`before`) an event, and the most frequent paths. Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        event: z.string().min(1).max(100).describe('Anchor event, e.g. `add_to_cart`.'),
        direction: z.enum(['after', 'before']).optional(),
        depth: z.number().int().min(1).max(5).optional().describe('Number of steps to trace (default 3).'),
        top: z.number().int().min(2).max(10).optional().describe('Number of events shown separately per step (default 5).'),
        window_hours: z.number().int().min(1).max(720).optional().describe('Maximum distance from the anchor event (hours, default 24).'),
        exclude: z.array(z.string().min(1).max(100)).max(20).optional().describe('Events to ignore in paths.'),
        from: isoArg('ISO-8601 start.'),
        to: isoArg('ISO-8601 end.'),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/paths`, {
        event: a.event,
        ...(a.direction ? { direction: a.direction } : {}),
        ...(a.depth ? { depth: a.depth } : {}),
        ...(a.top ? { top: a.top } : {}),
        ...(a.window_hours ? { window_hours: a.window_hours } : {}),
        ...(a.exclude?.length ? { exclude: a.exclude } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
      }),
  );
  server.registerTool(
    'run_report',
    {
      title: 'Run report',
      description:
        'Ad-hoc report: pick a source, metrics, dimensions and filters. Sources and fields — deliveries: metrics sent, delivered, failed, opened, clicked, ' +
        'delivery_rate, open_rate, click_rate, failure_rate; dimensions day/week/month/channel/provider/campaign/status. events: metrics count, unique_users, ' +
        'value_sum, value_avg; dimensions day/week/month/name/source. conversions: metrics conversions, revenue, unique_users; dimensions day/week/month/campaign/' +
        'event_name/kind. Do not combine `days` with `from`/`to`. Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        source: z.enum(REPORT_SOURCES),
        metrics: z.array(z.string().min(1).max(32)).min(1).max(8),
        dimensions: z.array(z.string().min(1).max(32)).max(2).optional(),
        filters: z.record(z.string().max(32), z.array(z.string().min(1).max(200)).min(1).max(50)).optional().describe('e.g. {"channel":["email","sms"]}'),
        sort: z.object({ by: z.string().max(64), direction: z.enum(['asc', 'desc']).optional() }).optional(),
        limit: z.number().int().min(1).max(1000).optional().describe('Row limit (default 100).'),
        days: z.number().int().min(1).max(730).optional().describe('Number of most recent days.'),
        from: isoArg('ISO-8601 start.'),
        to: isoArg('ISO-8601 end.'),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/reports/run`, {
        source: a.source,
        metrics: a.metrics,
        ...(a.dimensions?.length ? { dimensions: a.dimensions } : {}),
        ...(a.filters ? { filters: a.filters } : {}),
        ...(a.sort ? { sort: a.sort } : {}),
        ...(a.limit ? { limit: a.limit } : {}),
        ...(a.days ? { days: a.days } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        format: 'json',
      }),
  );
  server.registerTool(
    'list_saved_reports',
    {
      title: 'List saved reports',
      description: 'Report definitions saved in the dashboard. Run a definition with `run_report`. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/reports`),
  );
  server.registerTool(
    'get_saved_report',
    {
      title: 'Get saved report',
      description: 'Definition of a saved report (source, metrics, dimensions, filters). Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, report_id: idArg('Report') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/reports/${seg(a.report_id)}`),
  );

  // ---- karar ajanları
  server.registerTool(
    'list_decision_agents',
    {
      title: 'List decision agents',
      description: 'Decision agents that learn the best option per user: status, options and goal. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/decision-agents`),
  );
  server.registerTool(
    'get_decision_agent_report',
    {
      title: 'Decision agent report',
      description: 'Per-option assignment and reward counts and lift versus the control group. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, agent_id: idArg('Decision agent') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/decision-agents/${seg(a.agent_id)}/report`),
  );

  // ---- katalog ve öneriler
  server.registerTool(
    'list_catalogs',
    {
      title: 'List product catalogs',
      description: 'Product catalogs (name, currency, item count). Get `catalog_id` for recommendation tools here. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs`),
  );
  server.registerTool(
    'get_recommendations',
    {
      title: 'Product recommendations',
      description:
        'Product recommendations from a catalog. Strategies: personalized and recently_viewed need a user (`user_id` or `external_id`, not both); ' +
        'similar needs `item_id`, category needs `category`; popular, trending and new_arrivals take no input. Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        catalog_id: idArg('Catalog'),
        strategy: z.enum(RECOMMENDATION_STRATEGIES),
        limit: z.number().int().min(1).max(20).optional(),
        user_id: z.string().max(64).optional(),
        external_id: z.string().max(255).optional(),
        item_id: z.string().max(128).optional(),
        category: z.string().max(200).optional(),
      },
      annotations: READ,
    },
    async (a) =>
      get(
        `/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}/recommendations${query({
          strategy: a.strategy,
          limit: a.limit,
          user_id: a.user_id,
          external_id: a.external_id,
          item_id: a.item_id,
          category: a.category,
        })}`,
      ),
  );

  // ---- kanal skoru
  server.registerTool(
    'get_channel_score_overview',
    {
      title: 'Best channel overview',
      description: 'Distribution of users by best channel (push, email, SMS…) and last computation time. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channel-scores/overview`),
  );

  // ---- bölgeler
  server.registerTool(
    'list_geofences',
    {
      title: 'List geofences',
      description: 'Defined geofences: name, center, radius and status. Contains no user locations. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/geofences`),
  );

  // ---- Wallet
  server.registerTool(
    'list_wallet_templates',
    {
      title: 'List Wallet templates',
      description: 'Apple and Google Wallet pass templates (coupon, loyalty card, ticket) and issued pass counts. Passes themselves and download links are not returned. Required scope: users:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/wallet/templates`),
  );
}
