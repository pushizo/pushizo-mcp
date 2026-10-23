import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PushizoApi } from './api.js';
import { READ, WRITE, WRITE_NOTE, appIdArg, createToolKit, cursorArg, limitArg, query } from './kit.js';
import { registerReadTools } from './tools-read.js';
import { registerWriteTools } from './tools-write.js';

export const MCP_SERVER_NAME = 'pushizo';
export const MCP_SERVER_VERSION = '1.1.0';

export interface PushizoMcpOptions {
  api: PushizoApi;
  /** Araçta `app_id` verilmezse kullanılan app (app'e bağlı anahtarda anahtarın app'i). */
  defaultAppId?: string;
}

/**
 * Pushizo MCP sunucusu (ADR-0031 §6, ADR-0043): segment, kampanya, mesaj, şablon, journey, kullanıcı, olay, analitik,
 * in-app ve web büyüme okuma araçları; kampanya/segment/şablon/journey/in-app taslağı ve test cihazlarına test gönderimi.
 * Taşıma bağımsızdır (stdio, Streamable HTTP, testte in-memory).
 */
export function createPushizoMcpServer(options: PushizoMcpOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Pushizo' },
    {
      instructions:
        'Pushizo bildirim platformu araçları. Okuma araçları serbesttir; create_* araçları yalnızca taslak oluşturur, send_test_notification yalnızca ' +
        'test cihazlarına gönderir ve ikisi de kullanıcının açık onayıyla çağrılmalıdır. Gerçek kitleye gönderim, zamanlama, yayın ve silme bu sunucuda ' +
        'yoktur; taslaklar Pushizo dashboard’undan gözden geçirilip gönderilir. Analiz için önce list_* ile kimlikleri bulun, sonra get_* ve rapor araçlarını kullanın.',
    },
  );
  const kit = createToolKit(options.api, options.defaultAppId);
  const { api, app, run } = kit;

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

  registerReadTools(server, kit);
  registerWriteTools(server, kit);
  return server;
}
