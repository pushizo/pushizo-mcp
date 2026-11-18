import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PushizoApi } from './api.js';
import { READ, WRITE, WRITE_NOTE, appIdArg, createToolKit, cursorArg, idArg, limitArg, query, seg } from './kit.js';
import { registerDataTools } from './tools-data.js';
import { registerEngageTools } from './tools-engage.js';
import { registerInsightTools } from './tools-insights.js';
import { registerOpsTools } from './tools-ops.js';
import type { CredentialHost } from './credential-files.js';
import { registerReadTools } from './tools-read.js';
import { registerLocalTools, registerSetupReadTools, registerSetupWriteTools } from './tools-setup.js';
import { registerWriteTools } from './tools-write.js';

export const MCP_SERVER_NAME = 'pushizo';
/** `serverInfo.version`; `package.json` sürümüyle aynı olmalıdır (test zorlar). */
export const MCP_SERVER_VERSION = '0.3.0';

export interface PushizoMcpOptions {
  api: PushizoApi;
  /** Araçta `app_id` verilmezse kullanılan app (app'e bağlı anahtarda anahtarın app'i). */
  defaultAppId?: string;
  /**
   * Anahtarın kapsamları biliniyorsa (HTTP taşıma): yazma araçları yalnızca `mcp:write` veya `admin` varken listelenir.
   * Verilmezse (stdio) tüm araçlar listelenir; yetki her çağrıda yine sunucuda denetlenir.
   */
  scopes?: readonly string[];
  /**
   * Yalnız yerel (stdio) süreçte verilir: anahtarı dosya yolundan yükleyen araç kaydedilir (ADR-0097). Uzak (HTTP)
   * taşımada verilmez; sunucu kullanıcının dosya sistemini göremez.
   */
  local?: CredentialHost;
}

/** Yazma araçları listelensin mi: kapsam bilinmiyorsa evet, biliniyorsa `mcp:write` veya `admin` gerekir. */
export function canListWriteTools(scopes: readonly string[] | undefined): boolean {
  return !scopes || scopes.includes('admin') || scopes.includes('mcp:write');
}

/**
 * Pushizo MCP sunucusu (ADR-0031 §6, ADR-0043): segment, kampanya, mesaj, şablon, journey, kullanıcı, olay, analitik,
 * in-app ve web büyüme okuma araçları; veri (şirket, SQL, boru hattı, ambar) ve etkileşim (konuşma, AI ajanı, site
 * araması, reklam) okuma araçları; kampanya/segment/şablon/journey/in-app/web kampanyası/web kişiselleştirme/anket/
 * landing taslağı ve test cihazlarına test gönderimi; kurulum araçları (ADR-0097: app oluşturma, kurulum durumu, SDK kodu
 * ve yalnız yerel süreçte anahtarı dosya yolundan yükleme).
 * Taşıma bağımsızdır (stdio, Streamable HTTP, testte in-memory).
 */
export function createPushizoMcpServer(options: PushizoMcpOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Pushizo' },
    {
      instructions:
        'Tools for the Pushizo messaging platform (push, email, SMS, in-app, journeys). Read tools are side-effect free. create_* tools only create drafts and ' +
        'send_test_notification only sends to test devices; call either only after the user explicitly approves. This server cannot send to real audiences, ' +
        'schedule, publish or delete; drafts are reviewed and sent from the Pushizo dashboard. For analysis, first find IDs with list_* tools, then use get_* and report tools. ' +
        'To set Pushizo up in an app: create_app (after approval), get_sdk_snippet for the code, then the push credentials, then get_setup_status until the first subscriber arrives. ' +
        'Never ask the user to paste a push key (.p8, .p12, service account JSON, client secret) into the chat and never read such a file yourself: on a local server pass its PATH to ' +
        'upload_channel_credentials; otherwise give the user the dashboard link from get_setup_status.',
    },
  );
  const kit = createToolKit(options.api, options.defaultAppId);
  const { api, app, run } = kit;

  server.registerTool(
    'list_segments',
    { title: 'List segments', description: 'Lists the app’s segments (name search, pagination). Required scope: segments:read.', inputSchema: { app_id: appIdArg, q: z.string().max(100).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/segments${query({ q: a.q, limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'get_segment',
    { title: 'Get segment', description: 'Segment definition and estimated audience size. Required scope: segments:read.', inputSchema: { app_id: appIdArg, segment_id: idArg('Segment') }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/segments/${seg(a.segment_id)}`)),
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'List campaigns',
      description: 'Lists campaigns (filter by status, type or name). Required scope: analytics:read.',
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
    { title: 'Get campaign', description: 'Campaign details (audience, content, approval status, stats). Required scope: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Campaign') }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}`)),
  );

  server.registerTool(
    'list_campaign_messages',
    { title: 'Campaign runs', description: 'Messages of a campaign (one message per run) with their counters. Required scope: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Campaign') }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}/messages`)),
  );

  server.registerTool(
    'list_messages',
    {
      title: 'List messages',
      description: 'Sent messages (API, campaign, journey) with delivery counters. Required scope: analytics:read or notifications:write.',
      inputSchema: { app_id: appIdArg, limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/notifications${query({ app_id: decodeURIComponent(app(a.app_id)), limit: a.limit, cursor: a.cursor })}`)),
  );

  server.registerTool(
    'get_message',
    { title: 'Get message', description: 'Message status and counters. Required scope: analytics:read or notifications:write.', inputSchema: { app_id: appIdArg, message_id: idArg('Message') }, annotations: READ },
    async (a) => run(() => api.request('GET', `/v1/notifications/${seg(a.message_id)}${query({ app_id: decodeURIComponent(app(a.app_id)) })}`)),
  );

  server.registerTool(
    'get_analytics_summary',
    {
      title: 'Analytics summary',
      description: 'Overview KPIs: sends, deliveries, open/click rates, subscription growth (last 7/30 days or a custom range). Required scope: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        range: z.enum(['7d', '30d']).optional(),
        from: z.string().max(40).optional().describe('ISO-8601 start (use together with to)'),
        to: z.string().max(40).optional().describe('ISO-8601 end'),
      },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/analytics/overview${query({ range: a.range, from: a.from, to: a.to })}`)),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description: 'Message templates (filter by channel or name). Required scope: analytics:read.',
      inputSchema: { app_id: appIdArg, q: z.string().max(100).optional(), channel: z.string().max(32).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/templates${query({ q: a.q, channel: a.channel, limit: a.limit, cursor: a.cursor })}`)),
  );

  const writable = canListWriteTools(options.scopes);
  if (writable) {
    server.registerTool(
      'create_campaign_draft',
      {
        title: 'Create campaign draft',
        description:
          `${WRITE_NOTE} Creates a campaign in \`draft\` status. Audience is given as segment IDs; content inline or via template_id. ` +
          'Example content: {"headings":{"en":"Title"},"contents":{"en":"Body"}}. Run run_campaign_preflight on the draft to audit it before a person sends it.',
        inputSchema: {
          app_id: appIdArg,
          name: z.string().min(2).max(120),
          included_segments: z.array(z.string().min(1).max(64)).max(20).optional().describe('Included segments; empty means all subscribers.'),
          excluded_segments: z.array(z.string().min(1).max(64)).max(20).optional(),
          channels: z.array(z.string().max(32)).max(10).optional().describe('e.g. ["web_push","android_push","ios_push","email","sms"]'),
          content: z.record(z.string(), z.unknown()).optional().describe('Message content (headings/contents/email_subject…).'),
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
        title: 'Create segment draft',
        description:
          `${WRITE_NOTE} Creates a dynamic segment (no effect until used in a campaign). Definition format: ` +
          '{"all":[{"field":"tags.plan","op":"eq","value":"pro"},{"field":"last_active_at","op":"within_days","value":30}]}.',
        inputSchema: {
          app_id: appIdArg,
          name: z.string().min(1).max(200),
          description: z.string().max(500).optional(),
          definition: z.record(z.string(), z.unknown()).describe('Segment definition (all/any/none condition groups).'),
        },
        annotations: WRITE,
      },
      async (a) => run(() => api.request('POST', `/v1/apps/${app(a.app_id)}/mcp/segment-drafts`, { name: a.name, ...(a.description ? { description: a.description } : {}), definition: a.definition })),
    );
  }

  registerReadTools(server, kit);
  registerInsightTools(server, kit);
  registerDataTools(server, kit);
  registerEngageTools(server, kit);
  registerOpsTools(server, kit);
  registerSetupReadTools(server, kit);
  if (writable) registerWriteTools(server, kit);
  if (writable) registerSetupWriteTools(server, kit);
  if (writable && options.local) registerLocalTools(server, kit, options.local);
  return server;
}
