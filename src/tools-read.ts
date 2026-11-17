import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, aliasArgs, appIdArg, compareArg, cursorArg, definitionArg, fromArg, idArg, limitArg, query, seg, toArg, type ToolKit } from './kit.js';

/**
 * Genişletilmiş okuma araçları (ADR-0043): app, segment, kampanya istatistiği, şablon, journey, kullanıcı, olay,
 * analitik raporları, in-app ve web büyüme araçları. Hepsi mevcut public API uçlarını çağırır; yetki her çağrıda API
 * anahtarının kapsamıyla sunucuda denetlenir (araç açıklamasında gereken kapsam yazılıdır).
 */
export function registerReadTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  // ---- app ve organizasyon
  server.registerTool(
    'get_app',
    { title: 'App info', description: 'App settings: name, platforms, default language, time zone. Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}`),
  );
  server.registerTool(
    'get_organization_usage',
    {
      title: 'Organization usage',
      description: 'Plan quotas, current-month usage and overage forecast (organization-wide key only). Required scope: analytics:read.',
      inputSchema: { days: z.number().int().min(7).max(90).optional().describe('Daily series length (7–90, default 30).') },
      annotations: READ,
    },
    async (a) => get(`/v1/organization/usage${query({ days: a.days })}`),
  );

  // ---- segmentler
  server.registerTool(
    'preview_segment',
    {
      title: 'Preview segment',
      description: 'Audience count and sample users for an unsaved definition (without creating a segment). Required scope: segments:read.',
      inputSchema: { app_id: appIdArg, definition: definitionArg, limit: z.number().int().min(1).max(50).optional().describe('Number of sample users.') },
      annotations: READ,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/segments/preview`, { definition: a.definition, ...(a.limit ? { limit: a.limit } : {}) }),
  );
  server.registerTool(
    'estimate_segment',
    { title: 'Estimate segment audience', description: 'Current audience and per-channel subscription estimate for a saved segment. Required scope: segments:read.', inputSchema: { app_id: appIdArg, segment_id: idArg('Segment') }, annotations: READ },
    async (a) => post(`/v1/apps/${app(a.app_id)}/segments/${seg(a.segment_id)}/estimate`, {}),
  );
  server.registerTool(
    'list_segment_campaigns',
    { title: 'Campaigns using a segment', description: 'Campaigns that include or exclude the segment. Required scope: segments:read.', inputSchema: { app_id: appIdArg, segment_id: idArg('Segment') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/segments/${seg(a.segment_id)}/campaigns`),
  );

  // ---- kampanya istatistikleri
  server.registerTool(
    'get_campaign_stats',
    { title: 'Campaign stats', description: 'Sends, deliveries, opens, clicks, conversions and per-channel breakdown. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Campaign') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}/stats`),
  );
  server.registerTool(
    'get_campaign_variant_stats',
    { title: 'A/B variant stats', description: 'Metrics per campaign variant and significance (z-test) result. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Campaign') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}/variants/stats`),
  );

  // ---- şablonlar
  server.registerTool(
    'get_template',
    { title: 'Get template', description: 'Template content (per-language title/body, email, SMS…). Required scope: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Template') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}`),
  );
  server.registerTool(
    'get_template_stats',
    { title: 'Template performance', description: 'Aggregate metrics of messages that used the template. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Template') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/stats`),
  );
  server.registerTool(
    'list_template_versions',
    { title: 'Template versions', description: 'Saved version history of the template. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Template') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/versions`),
  );
  server.registerTool(
    'render_template',
    {
      title: 'Render template',
      description: 'Renders the template with Liquid variables (does not send): final output for sample user tags/properties and language. Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        template_id: idArg('Template'),
        channel: z.string().max(32).optional().describe('e.g. ios_push, android_push, web_push, email, sms'),
        language: z.string().min(2).max(10).optional(),
        user: z.record(z.string(), z.unknown()).optional().describe('{"external_id":"u1","tags":{"plan":"pro"},"properties":{…}}'),
        custom_data: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/render`, {
        ...(a.channel ? { channel: a.channel } : {}),
        ...(a.language ? { language: a.language } : {}),
        ...(a.user ? { user: a.user } : {}),
        ...(a.custom_data ? { custom_data: a.custom_data } : {}),
      }),
  );

  // ---- journey'ler
  server.registerTool(
    'list_journeys',
    {
      title: 'List journeys',
      description: 'Automation flows (filter by status and name). Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), q: z.string().max(100).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys${query({ status: a.status, q: a.q, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_journey',
    { title: 'Get journey', description: 'Journey graph (nodes, edges), entry/exit rules and publish status. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, journey_id: idArg('Journey') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}`),
  );
  server.registerTool(
    'get_journey_stats',
    {
      title: 'Journey stats',
      description: 'Per-node entries/exits, waiting, goal reached and message metrics. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, journey_id: idArg('Journey'), version: z.number().int().min(1).optional(), all_versions: z.boolean().optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/stats${query({ version: a.version, all_versions: a.all_versions })}`),
  );
  server.registerTool(
    'list_journey_runs',
    {
      title: 'Journey runs',
      description: 'Per-user journey runs (filter by status, user, version). Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        journey_id: idArg('Journey'),
        status: z.enum(['active', 'waiting', 'completed', 'exited', 'failed']).optional(),
        user_id: z.string().max(64).optional(),
        version: z.number().int().min(1).optional(),
        limit: limitArg,
        cursor: cursorArg,
      },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/runs${query({ status: a.status, user_id: a.user_id, version: a.version, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_journey_run',
    { title: 'Get journey run', description: 'Step-by-step timeline of a single run. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, journey_id: idArg('Journey'), run_id: idArg('Run') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/runs/${seg(a.run_id)}`),
  );

  // ---- kullanıcılar
  server.registerTool(
    'search_users',
    {
      title: 'Search users',
      description: 'Users matching conditions (same format as a segment definition; paginated). Contains personal data; request only what you need. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, definition: definitionArg, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg },
      annotations: READ,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/users/search`, { definition: a.definition, ...(a.limit ? { limit: a.limit } : {}), ...(a.cursor ? { cursor: a.cursor } : {}) }),
  );
  server.registerTool(
    'get_user',
    { title: 'Get user', description: 'User identities, tags, properties and subscriptions. Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}`),
  );
  server.registerTool(
    'get_user_journeys',
    { title: 'User journeys', description: 'Journey runs the user is currently in or has completed. Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/journeys`),
  );
  server.registerTool(
    'get_user_preferences',
    { title: 'User preferences', description: 'Subscription preferences per category and channel. Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/preferences`),
  );
  server.registerTool(
    'list_categories',
    { title: 'Message categories', description: 'Message categories in the preference center (default on/off, channels). Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/categories`),
  );

  // ---- olaylar
  server.registerTool(
    'list_event_definitions',
    { title: 'Custom events', description: 'Custom event names seen in the app, their counts and property schemas. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, limit: z.number().int().min(1).max(500).optional(), cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/events/definitions${query({ limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_event_definition',
    { title: 'Event definition', description: 'Properties, first/last seen and volume of a single event. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, name: z.string().min(1).max(100) }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/events/definitions/${seg(a.name)}`),
  );

  // ---- analitik raporları
  server.registerTool(
    'get_message_report',
    {
      title: 'Delivery report',
      description: 'Sends/deliveries/opens/clicks/failures, grouped by day, channel or campaign. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, group_by: z.enum(['day', 'channel', 'campaign']).optional(), compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/messages${query({ from: a.from, to: a.to, group_by: a.group_by, compare: a.compare })}`),
  );
  server.registerTool(
    'get_subscription_report',
    { title: 'Subscription report', description: 'New, cancelled and net subscription trend per channel. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, compare: compareArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/subscriptions${query({ from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'get_event_report',
    {
      title: 'Event report',
      description: 'Custom event volume, grouped by day or event name. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, name: z.string().min(1).max(100).optional(), group_by: z.enum(['day', 'name']).optional(), from: fromArg, to: toArg, compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/events${query({ name: a.name, group_by: a.group_by, from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'get_conversion_report',
    {
      title: 'Conversion report',
      description: 'Conversions and revenue attributed to messages (cross-channel last touch). Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, campaign_id: z.string().max(64).optional(), from: fromArg, to: toArg, compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/conversions${query({ campaign_id: a.campaign_id, from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'run_funnel',
    {
      title: 'Funnel analysis',
      description: 'Conversion and drop-off across ordered event steps (2–8 steps, at most `window_hours` between steps). Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        steps: z
          .array(z.object({ name: z.string().min(1).max(100), where: z.object({ key: z.string().min(1).max(64), value: z.string().max(500) }).optional() }))
          .min(2)
          .max(8),
        from: fromArg,
        to: toArg,
        window_hours: z.number().int().min(1).max(720).optional(),
        compare: z.boolean().optional(),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/funnels`, {
        steps: a.steps,
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        ...(a.window_hours ? { window_hours: a.window_hours } : {}),
        ...(a.compare !== undefined ? { compare: a.compare } : {}),
      }),
  );
  server.registerTool(
    'get_retention_report',
    { title: 'Retention report', description: 'Weekly cohort retention table. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, weeks: z.number().int().min(2).max(26).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/retention${query({ weeks: a.weeks })}`),
  );
  server.registerTool(
    'get_engagement_heatmap',
    { title: 'Engagement heatmap', description: 'Day × hour open/click density (for best send time). Required scope: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/engagement${query({ from: a.from, to: a.to })}`),
  );
  server.registerTool(
    'get_provider_report',
    { title: 'Provider report', description: 'APNs/FCM/HMS/email/SMS provider success and error code distribution. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/providers${query({ from: a.from, to: a.to })}`),
  );

  // ---- in-app
  server.registerTool(
    'list_in_app_messages',
    {
      title: 'List in-app messages',
      description: 'In-app messages (filter by status) with impression/click counters. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/in-app-messages${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_in_app_message',
    { title: 'Get in-app message', description: 'Triggers, display, audience, frequency and stats. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, message_id: idArg('In-app message') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/in-app-messages/${seg(a.message_id)}`),
  );

  // ---- web büyüme ve gelen kutusu
  server.registerTool(
    'list_web_campaigns',
    {
      title: 'List web campaigns',
      description: 'Pop-up, banner and slide-in campaigns. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/web-campaigns${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_web_campaign_report',
    { title: 'Web campaign report', description: 'Impressions, clicks, dismissals and conversions. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Web campaign'), days: z.number().int().min(1).max(365).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/web-campaigns/${seg(a.campaign_id)}/report${query({ days: a.days })}`),
  );
  server.registerTool(
    'list_forms',
    { title: 'List forms', description: 'Web forms and submission counts. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, status: z.enum(['active', 'archived']).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/forms${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_surveys',
    { title: 'List surveys', description: 'Surveys and NPS. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'closed']).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/surveys${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_survey_report',
    { title: 'Survey report', description: 'Per-question answer distribution and NPS score. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, survey_id: idArg('Survey'), days: z.number().int().min(1).max(365).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/surveys/${seg(a.survey_id)}/report${query({ days: a.days })}`),
  );
  server.registerTool(
    'get_inbox_metrics',
    {
      title: 'Inbox metrics',
      description: 'Live chat and unified inbox: conversation volume, first response and resolution times. Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, channel: z.enum(['sms', 'whatsapp', 'rcs', 'telegram', 'viber', 'email', 'chat']).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/inbox/metrics${query({ from: a.from, to: a.to, channel: a.channel })}`),
  );
}
