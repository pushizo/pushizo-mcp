import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WRITE, WRITE_NOTE, appIdArg, type ToolKit } from './kit.js';

const localized = z.record(z.string().min(2).max(10), z.string().max(4000)).describe('Text per language, e.g. {"en":"Hello","tr":"Merhaba"}.');

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
      title: 'Create template draft',
      description:
        `${WRITE_NOTE} Creates a reusable message template (never sent on its own; tagged \`mcp\`). ` +
        'Example content: {"headings":{"en":"Your cart is waiting"},"contents":{"en":"{{ first_name | default: \\"Hi\\" }}, your items are still in your cart."}}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        channel: z.string().max(32).optional().describe('Template channel (empty means multi-channel): ios_push, android_push, web_push, email, sms…'),
        tags: z.array(z.string().min(1).max(50)).max(19).optional(),
        content: z.record(z.string(), z.unknown()).describe('Message content (headings/contents/url/email_subject/email_body/sms_body…).'),
      },
      annotations: WRITE,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/mcp/template-drafts`, { name: a.name, ...(a.channel ? { channel: a.channel } : {}), ...(a.tags ? { tags: a.tags } : {}), content: a.content }),
  );

  server.registerTool(
    'create_journey_draft',
    {
      title: 'Create journey draft',
      description:
        `${WRITE_NOTE} Creates an automation flow as \`draft\`; does not publish it. Without a graph an empty draft is created to finish in the dashboard ` +
        'editor. The graph format matches `graph` in get_journey output (nodes + edges; the entry node is a segment or an event).',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        graph: z.record(z.string(), z.unknown()).optional().describe('{"nodes":[…],"edges":[…]} (get_journey format).'),
        settings: z.record(z.string(), z.unknown()).optional().describe('Entry/exit rules, goal, quiet hours (get_journey `settings` format).'),
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
      title: 'Create in-app message draft',
      description:
        `${WRITE_NOTE} Creates an in-app message as \`draft\`; does not activate it. Example: triggers [{"kind":"session_start"}] ` +
        '(others: session_duration, event, screen, trigger), display {"layout":"modal","blocks":[{"type":"title","text":{"en":"New feature"}},' +
        '{"type":"body","text":{"en":"Try it now"}},{"type":"button","id":"ok","text":{"en":"OK"},"action":{"type":"dismiss"}}]}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        triggers: z.array(z.record(z.string(), z.unknown())).min(1).max(5).describe('Triggers (get_in_app_message `triggers` format).'),
        display: z.record(z.string(), z.unknown()).describe('Display: layout (modal, banner_top, banner_bottom, fullscreen) + blocks, or content_type "html".'),
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
      title: 'Send test notification',
      description:
        '[Approved mode — test send] Sends a real test push to the app’s TEST DEVICES only (never to a real audience). ' +
        'If `subscription_ids` is given, all must be test devices. The API key needs the `mcp:write` scope; get explicit approval from the user before calling it.',
      inputSchema: {
        app_id: appIdArg,
        contents: localized,
        headings: localized.optional(),
        url: z.string().url().max(2000).optional(),
        data: z.record(z.string().min(1).max(64), z.string().max(1000)).optional(),
        subscription_ids: z.array(z.string().min(1).max(64)).min(1).max(100).optional().describe('Specific test devices (empty means all test devices).'),
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
