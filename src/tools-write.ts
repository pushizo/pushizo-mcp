import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WRITE, WRITE_NOTE, appIdArg, type ToolKit } from './kit.js';

const localized = z.record(z.string().min(2).max(10), z.string().max(4000)).describe('Text per language, e.g. {"en":"Hello","tr":"Merhaba"}.');

/** Test gönderimi gerçek bir push gönderir; yalnızca test cihazlarına ve kullanıcı onayıyla. */
const TEST_SEND: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/**
 * Genişletilmiş yazma araçları (ADR-0043): şablon, journey, in-app, web kampanyası, web kişiselleştirme, anket ve
 * landing sayfası TASLAĞI; test cihazlarına test gönderimi. Uçlar `/v1/apps/{appId}/mcp/*` altındadır ve `mcp:write`
 * kapsamı ister; kayıt her zaman `draft` oluşur, yayın/etkinleştirme yalnızca dashboard'dan.
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
    'create_web_campaign_draft',
    {
      title: 'Create web campaign draft',
      description:
        `${WRITE_NOTE} Creates a website pop-up, banner or slide-in as \`draft\`; does not publish it. Example: display {"layout":"popup","blocks":[{"type":"title","text":{"en":"Join our newsletter"}},` +
        '{"type":"button","id":"close","text":{"en":"Later"},"action":{"type":"dismiss"}}]}, trigger {"kind":"page_load"} (others: scroll_depth, exit_intent, time_on_page; see list_web_campaigns output).',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        display: z.record(z.string(), z.unknown()).describe('Display: layout (popup, banner_top, banner_bottom, slide_in, fullscreen) + blocks (get_web_campaign `display` format).'),
        trigger: z.record(z.string(), z.unknown()).describe('When to show it, e.g. {"kind":"page_load"} or {"kind":"scroll_depth","percent":50}.'),
        conditions: z.record(z.string(), z.unknown()).optional().describe('Page and visit rules (get_web_campaign `conditions` format).'),
        targeting: z.record(z.string(), z.unknown()).optional().describe('Visitor, device and segment targeting (get_web_campaign `targeting` format).'),
        frequency: z.record(z.string(), z.unknown()).optional(),
        variants: z.array(z.record(z.string(), z.unknown())).max(5).optional().describe('A/B variants (id, name, weight_percent, display).'),
        priority: z.number().int().min(0).max(100).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/web-campaign-drafts`, {
        name: a.name,
        display: a.display,
        trigger: a.trigger,
        ...(a.conditions ? { conditions: a.conditions } : {}),
        ...(a.targeting ? { targeting: a.targeting } : {}),
        ...(a.frequency ? { frequency: a.frequency } : {}),
        ...(a.variants ? { variants: a.variants } : {}),
        ...(a.priority !== undefined ? { priority: a.priority } : {}),
      }),
  );

  server.registerTool(
    'create_web_personalization_draft',
    {
      title: 'Create web personalization draft',
      description:
        `${WRITE_NOTE} Creates a page-content personalization experience as \`draft\`; does not publish it (plan feature \`web_personalization\`). ` +
        'Changes target page elements by CSS selector; only text, image, link, hide and show are allowed (no HTML). ' +
        'Example: changes [{"action":"text","selector":"#hero h1","text":{"en":"A deal for you"}}], conditions {"url_rules":[{"op":"starts_with","value":"/"}]}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        changes: z.array(z.record(z.string(), z.unknown())).max(50).optional().describe('Element changes applied when there is no A/B test (get_web_personalization `changes` format).'),
        conditions: z.record(z.string(), z.unknown()).optional().describe('Page rules (get_web_personalization `conditions` format).'),
        targeting: z.record(z.string(), z.unknown()).optional(),
        goal: z.record(z.string(), z.unknown()).optional().describe('Conversion goal, e.g. {"type":"click","selector":"a.cta"}.'),
        variants: z.array(z.record(z.string(), z.unknown())).max(5).optional().describe('A/B variants (id, name, weight_percent, changes); a variant with no changes is the control group.'),
        priority: z.number().int().min(0).max(100).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/web-personalization-drafts`, {
        name: a.name,
        ...(a.changes ? { changes: a.changes } : {}),
        ...(a.conditions ? { conditions: a.conditions } : {}),
        ...(a.targeting ? { targeting: a.targeting } : {}),
        ...(a.goal ? { goal: a.goal } : {}),
        ...(a.variants ? { variants: a.variants } : {}),
        ...(a.priority !== undefined ? { priority: a.priority } : {}),
      }),
  );

  server.registerTool(
    'create_survey_draft',
    {
      title: 'Create survey draft',
      description:
        `${WRITE_NOTE} Creates a survey (question types: nps, csat, single_choice, multiple_choice, text) as \`draft\`; it collects no responses until a person activates it. ` +
        'Example questions: [{"id":"nps","type":"nps","text":{"en":"How likely are you to recommend us?"},"required":true},{"id":"why","type":"text","text":{"en":"Why?"}}].',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        questions: z.array(z.record(z.string(), z.unknown())).min(1).max(20).describe('Questions (get_survey `questions` format).'),
        settings: z.record(z.string(), z.unknown()).optional().describe('Thank-you message and other settings (get_survey `settings` format).'),
      },
      annotations: WRITE,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/mcp/survey-drafts`, { name: a.name, questions: a.questions, ...(a.settings ? { settings: a.settings } : {}) }),
  );

  server.registerTool(
    'create_landing_page_draft',
    {
      title: 'Create landing page draft',
      description:
        `${WRITE_NOTE} Creates a landing page as \`draft\`; it is not published. The document uses the email/landing designer format ` +
        '(see `document` in get_landing_page output): {"version":1,"settings":{"width":640,"font_family":"system"},"sections":[{"id":"hero","type":"section","columns":[{"id":"c1","blocks":[{"id":"h","type":"text","html":"<h1>Title</h1>"}]}]}]}.',
      inputSchema: {
        app_id: appIdArg,
        name: z.string().min(2).max(100),
        slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, digits and `-`.').describe('URL slug, e.g. `winter-sale`.'),
        document: z.record(z.string(), z.unknown()).describe('Page document (get_landing_page `document` format).'),
        seo: z.record(z.string(), z.unknown()).optional().describe('SEO fields (title, description, noindex…).'),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/mcp/landing-page-drafts`, { name: a.name, slug: a.slug, document: a.document, ...(a.seo ? { seo: a.seo } : {}), ...(a.settings ? { settings: a.settings } : {}) }),
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
