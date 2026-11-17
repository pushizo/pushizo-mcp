import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, aliasArgs, appIdArg, cursorArg, idArg, query, seg, type ToolKit } from './kit.js';

const pageLimit = z.number().int().min(1).max(200).optional();
const daysArg = z.number().int().min(7).max(90).optional().describe('Window in days (7–90).');

/**
 * Operasyon ve tanılama okuma araçları (public API kapsam tamamlama, ADR-0095): kullanıcı zaman çizelgesi/olayları/
 * mesajları, abonelik listesi, son olaylar, oturum hacmi, mesaj izleme, SDK hataları, istek logları, kanal özeti, webhook
 * olay türleri ve teslim ayrıntısı, konuşma kişisi, atama kuralları, liste temizliği ve bounce/sağlayıcı içgörüleri,
 * entegrasyon durumu ve reklam platformu/önizleme/ayar okumaları. Hepsi mevcut public API uçlarını çağırır; yazan,
 * senkron başlatan veya bağlantı (imzalı görsel, Zapier hedef adresi) döndüren uçlar bilerek yoktur.
 */
export function registerOpsTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));

  // ---- kullanıcı ve abonelik
  server.registerTool(
    'get_user_timeline',
    { title: 'User timeline', description: 'The user’s latest events and deliveries merged into one timeline (newest 40). Contains personal data. Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/timeline`),
  );
  server.registerTool(
    'list_user_events',
    { title: 'User events', description: 'The user’s latest events with their properties. Contains personal data. Required scope: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs, limit: pageLimit }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/events${query({ limit: a.limit })}`),
  );
  server.registerTool(
    'list_user_messages',
    {
      title: 'User messages',
      description: 'Messages delivered to the user (per delivery, newest first) with status and open/click times. Contains personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, ...aliasArgs, limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/messages${query({ limit: a.limit })}`),
  );
  server.registerTool(
    'list_subscriptions',
    {
      title: 'List subscriptions',
      description: 'Subscriptions (devices/addresses) with channel, status and test-device filters. Tokens are masked to the last 8 characters. Required scope: users:read.',
      inputSchema: {
        app_id: appIdArg,
        limit: pageLimit,
        cursor: cursorArg,
        channel: z.string().max(32).optional().describe('e.g. web_push, android_push, ios_push, email, sms'),
        status: z.string().max(32).optional().describe('e.g. subscribed, unsubscribed, invalid'),
        test_device: z.boolean().optional(),
        since: z.string().max(40).optional().describe('ISO-8601; only subscriptions created after this time.'),
      },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/subscriptions${query({ limit: a.limit, cursor: a.cursor, channel: a.channel, status: a.status, test_device: a.test_device, since: a.since })}`),
  );

  // ---- olaylar, oturumlar, izleme ve loglar
  server.registerTool(
    'list_recent_events',
    {
      title: 'Recent events',
      description: 'Most recent events across users (with user ID and properties); filter by event name or `since`. Contains personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, name: z.string().min(1).max(100).optional(), limit: pageLimit, since: z.string().max(40).optional().describe('ISO-8601; only events received after this time.') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/events/recent${query({ name: a.name, limit: a.limit, since: a.since })}`),
  );
  server.registerTool(
    'get_session_volume',
    { title: 'Session volume', description: 'Daily session count and unique users for the last 14 days. Required scope: analytics:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/sessions`),
  );
  server.registerTool(
    'trace_message',
    {
      title: 'Message trace',
      description: 'Traces a message, delivery or subscription: pass a msg_/dlv_/sub_ ID, an external_id or the last 8 characters of a token. Contains personal data. Required scope: admin.',
      inputSchema: { app_id: appIdArg, q: z.string().min(3).max(255).describe('msg_/dlv_/sub_ ID, external_id or token suffix.') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/trace${query({ q: a.q })}`),
  );
  server.registerTool(
    'list_sdk_errors',
    {
      title: 'SDK error reports',
      description: 'Error reports sent by the client SDKs (last 7 days, cursor). Required scope: admin.',
      inputSchema: { app_id: appIdArg, limit: pageLimit, cursor: cursorArg, platform: z.string().max(20).optional(), level: z.enum(['error', 'warning']).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/sdk-errors${query({ limit: a.limit, cursor: a.cursor, platform: a.platform, level: a.level })}`),
  );
  server.registerTool(
    'list_request_logs',
    {
      title: 'API request logs',
      description: 'Public API request logs for the organization (last 7 days, cursor; organization-wide key only). Required scope: admin.',
      inputSchema: { limit: pageLimit, cursor: cursorArg, app_id: z.string().max(64).optional(), status_class: z.enum(['2xx', '4xx', '5xx']).optional(), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/organization/logs${query({ limit: a.limit, cursor: a.cursor, app_id: a.app_id, status_class: a.status_class, method: a.method })}`),
  );

  // ---- kanallar ve webhook'lar
  server.registerTool(
    'get_channel_status',
    { title: 'Channel status summary', description: 'Provider and status per channel (no configuration details). Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channels/status`),
  );
  server.registerTool(
    'list_webhook_event_types',
    { title: 'Webhook event types', description: 'Event types a webhook endpoint can subscribe to. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/webhooks/event-types`),
  );
  server.registerTool(
    'get_webhook_delivery',
    { title: 'Webhook delivery detail', description: 'A single webhook delivery including the payload that was sent. May contain personal data. Required scope: admin.', inputSchema: { app_id: appIdArg, delivery_id: idArg('Delivery') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/webhooks/deliveries/${seg(a.delivery_id)}`),
  );

  // ---- gelen kutusu
  server.registerTool(
    'get_conversation_contact',
    {
      title: 'Conversation contact',
      description: 'Profile of the person in a conversation: properties, tags, subscriptions (masked), recent events and other conversations. Contains personal data. Required scope: users:read.',
      inputSchema: { app_id: appIdArg, conversation_id: idArg('Conversation') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/conversations/${seg(a.conversation_id)}/contact`),
  );
  server.registerTool(
    'list_assignment_rules',
    { title: 'Inbox assignment rules', description: 'Assignment rules in evaluation order (channel/language/tag conditions, strategy, team). Required scope: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/inbox/assignment-rules`),
  );

  // ---- e-posta teslim edilebilirliği
  server.registerTool(
    'get_email_hygiene',
    { title: 'Email list hygiene', description: 'List hygiene status: validation breakdown of email subscriptions and the latest validation run. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/email-deliverability/hygiene`),
  );
  server.registerTool(
    'get_email_hygiene_run',
    { title: 'Email list validation run', description: 'Progress and summary of a list validation run. Required scope: admin.', inputSchema: { app_id: appIdArg, run_id: idArg('Run') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/email-deliverability/hygiene-runs/${seg(a.run_id)}`),
  );
  server.registerTool(
    'get_email_provider_insights',
    { title: 'Email insights by mailbox provider', description: 'Delivered, open, click, bounce and complaint counts per mailbox provider (Gmail, Outlook, Yahoo, other). Required scope: admin.', inputSchema: { app_id: appIdArg, days: daysArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/email-deliverability/insights${query({ days: a.days })}`),
  );
  server.registerTool(
    'get_email_bounce_stats',
    { title: 'Email bounce statistics', description: 'Bounce trend (2% target), type/reason breakdown and the recipient domains that bounce most. Required scope: admin.', inputSchema: { app_id: appIdArg, days: daysArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/email-deliverability/bounces${query({ days: a.days })}`),
  );

  // ---- entegrasyonlar
  server.registerTool(
    'list_integrations',
    { title: 'Integrations', description: 'Connected integrations with their status, plus the catalog of available ones. Credentials are masked. Required scope: admin.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/integrations`),
  );
  server.registerTool(
    'get_integration',
    { title: 'Get integration', description: 'Status, settings and health of one integration (credentials masked). Required scope: admin.', inputSchema: { app_id: appIdArg, type: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/).describe('Integration type, e.g. slack, segment, amplitude.') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/integrations/${seg(a.type)}`),
  );
  server.registerTool(
    'list_integration_runs',
    {
      title: 'Integration runs',
      description: 'Recent runs of an integration (sync, event export, inbound requests, tests). Required scope: admin.',
      inputSchema: { app_id: appIdArg, type: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/), limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/integrations/${seg(a.type)}/runs${query({ limit: a.limit })}`),
  );

  // ---- reklam
  server.registerTool(
    'list_ad_platforms',
    { title: 'Ad platforms', description: 'Supported ad platforms (enabled/mock, identifiers, lookalike support). Required scope: segments:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/ads/platforms`),
  );
  server.registerTool(
    'get_ad_campaign_preview',
    { title: 'Ad creative preview', description: 'Creative summary and the platform preview link of an ad campaign, ad set or ad. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, entity_id: idArg('Ad entity') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/ads/campaigns/${seg(a.entity_id)}/preview`),
  );
  server.registerTool(
    'list_ad_pages',
    { title: 'Promotable Facebook pages', description: 'Meta: Facebook pages the ad account can promote. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, account_id: idArg('Ad account') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/ads/accounts/${seg(a.account_id)}/pages`),
  );
  server.registerTool(
    'get_ad_settings',
    { title: 'Ad reporting settings', description: 'Reporting currency (organization) and attribution defaults (app). Required scope: analytics:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/ads/settings`),
  );
}
