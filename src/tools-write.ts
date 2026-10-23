import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WRITE, WRITE_NOTE, appIdArg, type ToolKit } from './kit.js';

const localized = z.record(z.string().min(2).max(10), z.string().max(4000)).describe('Dile göre metin, ör. {"tr":"Merhaba","en":"Hello"}.');

/** Test gönderimi gerçek bir push gönderir; yalnızca test cihazlarına ve kullanıcı onayıyla. */
const TEST_SEND: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/**
 * Genişletilmiş yazma araçları (ADR-0043): şablon, journey ve in-app TASLAĞI; test cihazlarına test gönderimi. Uçlar
 * `/v1/apps/{appId}/mcp/*` altındadır ve `mcp:write` kapsamı ister; journey ve in-app `draft` oluşur, yayın/etkinleştirme
 * yalnızca dashboard'dan.
 */
export function registerWriteTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  server.registerTool(
    'create_template_draft',
    {
      title: 'Şablon oluştur',
      description:
        `${WRITE_NOTE} Yeniden kullanılabilir mesaj şablonu oluşturur (tek başına gönderilmez; \`mcp\` etiketi eklenir). ` +
        'Örnek içerik: {"headings":{"tr":"Sepetiniz sizi bekliyor"},"contents":{"tr":"{{ first_name | default: \\"Merhaba\\" }}, ürünleriniz hâlâ sepette."}}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        channel: z.string().max(32).optional().describe('Şablonun kanalı (boşsa çok kanallı): ios_push, android_push, web_push, email, sms…'),
        tags: z.array(z.string().min(1).max(50)).max(19).optional(),
        content: z.record(z.string(), z.unknown()).describe('Mesaj içeriği (headings/contents/url/email_subject/email_body/sms_body…).'),
      },
      annotations: WRITE,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/mcp/template-drafts`, { name: a.name, ...(a.channel ? { channel: a.channel } : {}), ...(a.tags ? { tags: a.tags } : {}), content: a.content }),
  );

  server.registerTool(
    'create_journey_draft',
    {
      title: 'Journey taslağı oluştur',
      description:
        `${WRITE_NOTE} Otomasyon akışını \`draft\` olarak oluşturur; yayımlamaz. Grafik verilmezse boş taslak açılır ve dashboard ` +
        'düzenleyicisinde tamamlanır. Grafik biçimi get_journey çıktısındaki `graph` ile aynıdır (nodes + edges; giriş düğümü segment veya olay).',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        graph: z.record(z.string(), z.unknown()).optional().describe('{"nodes":[…],"edges":[…]} (get_journey biçimi).'),
        settings: z.record(z.string(), z.unknown()).optional().describe('Giriş/çıkış kuralları, hedef, sessiz saatler (get_journey `settings` biçimi).'),
      },
      annotations: WRITE,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/journey-drafts`, {
        name: a.name,
        ...(a.description ? { description: a.description } : {}),
        ...(a.graph ? { graph: a.graph } : {}),
        ...(a.settings ? { settings: a.settings } : {}),
      }),
  );

  server.registerTool(
    'create_in_app_draft',
    {
      title: 'In-app mesaj taslağı oluştur',
      description:
        `${WRITE_NOTE} In-app mesajı \`draft\` olarak oluşturur; etkinleştirmez. Örnek: triggers [{"kind":"session_start"}] ` +
        '(diğerleri: session_duration, event, screen, trigger), display {"layout":"modal","blocks":[{"type":"title","text":{"tr":"Yeni özellik"}},' +
        '{"type":"body","text":{"tr":"Hemen deneyin"}},{"type":"button","id":"ok","text":{"tr":"Tamam"},"action":{"type":"dismiss"}}]}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        triggers: z.array(z.record(z.string(), z.unknown())).min(1).max(5).describe('Tetikler (get_in_app_message `triggers` biçimi).'),
        display: z.record(z.string(), z.unknown()).describe('Görünüm: layout (modal, banner_top, banner_bottom, fullscreen) + blocks ya da content_type "html".'),
        audience: z.record(z.string(), z.unknown()).optional(),
        frequency: z.record(z.string(), z.unknown()).optional(),
        priority: z.number().int().min(0).max(100).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/in-app-drafts`, {
        name: a.name,
        triggers: a.triggers,
        display: a.display,
        ...(a.audience ? { audience: a.audience } : {}),
        ...(a.frequency ? { frequency: a.frequency } : {}),
        ...(a.priority !== undefined ? { priority: a.priority } : {}),
      }),
  );

  server.registerTool(
    'send_test_notification',
    {
      title: 'Test cihazlarına test gönder',
      description:
        '[Onaylı mod — test gönderimi] App’in TEST CİHAZLARINA gerçek bir test push’u gönderir (gerçek kitleye asla). ' +
        '`subscription_ids` verilirse hepsi test cihazı olmalıdır. API anahtarında `mcp:write` kapsamı olmalıdır; çağırmadan önce kullanıcıdan açık onay alın.',
      inputSchema: {
        app_id: appIdArg,
        contents: localized,
        headings: localized.optional(),
        url: z.string().url().max(2000).optional(),
        data: z.record(z.string().min(1).max(64), z.string().max(1000)).optional(),
        subscription_ids: z.array(z.string().min(1).max(64)).min(1).max(100).optional().describe('Belirli test cihazları (boşsa tüm test cihazları).'),
      },
      annotations: TEST_SEND,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/test-sends`, {
        contents: a.contents,
        ...(a.headings ? { headings: a.headings } : {}),
        ...(a.url ? { url: a.url } : {}),
        ...(a.data ? { data: a.data } : {}),
        ...(a.subscription_ids ? { subscription_ids: a.subscription_ids } : {}),
      }),
  );
}
