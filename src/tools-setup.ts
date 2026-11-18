import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PushizoApiError } from './api.js';
import { UPLOAD_CHANNELS, CredentialError, uploadChannelCredentials, type ApiCall, type CredentialHost } from './credential-files.js';
import { READ, WRITE, appIdArg, fail, ok, query, type ToolKit } from './kit.js';

const PLATFORMS = ['ios', 'android', 'huawei', 'amazon', 'web', 'windows', 'email', 'sms'] as const;
const FRAMEWORKS = ['native', 'flutter', 'react-native', 'expo', 'kmp', 'unity', 'capacitor', 'cordova', 'maui'] as const;
const SDK_PLATFORMS = [
  'ios', 'android', 'flutter', 'react-native', 'expo', 'capacitor', 'cordova', 'maui', 'unity', 'kmp', 'web', 'windows', 'react', 'nextjs', 'vue',
  'angular', 'wordpress', 'gtm', 'node', 'php', 'python', 'go', 'java', 'csharp', 'ruby', 'rust', 'rest',
] as const;

const CREATE_APP_NOTE =
  '[Approved mode — write] This tool creates a new app in the Pushizo organization. It needs an organization-wide API key with the `mcp:write` scope ' +
  'whose creator may create apps (owner/admin), or the `admin` scope. Get explicit approval from the user before calling it.';

/**
 * Kurulum araçları (ADR-0097): app oluşturma, kurulum durumu ve panel rehberiyle aynı SDK kodu. Hepsi public API'yi
 * çağırır; sır ve yapılandırma ayrıntısı dönmez.
 */
export function registerSetupReadTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;

  server.registerTool(
    'get_setup_status',
    {
      title: 'Setup status',
      description:
        'Setup progress of an app: selected platforms, status per channel (no secrets or configuration details), whether the first subscriber has arrived, ' +
        'the missing steps and a dashboard link for each. Use it after create_app and after each setup step. Required scope: users:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/setup/status`)),
  );

  server.registerTool(
    'get_sdk_snippet',
    {
      title: 'SDK setup code',
      description:
        'Copy-paste SDK setup code for a platform, identical to the dashboard setup guide: install, init and extra steps with the app ID and API URL filled in. ' +
        'Write the code into the user’s project as given. Required scope: users:read.',
      inputSchema: {
        app_id: appIdArg,
        platform: z.enum(SDK_PLATFORMS).describe('SDK platform; use `sdk_platforms` from get_setup_status for the app’s own selection.'),
        variant: z.string().min(1).max(40).optional().describe('Code tab, e.g. kotlin|java (android), spm|cocoapods (ios), script|npm|package (react, nextjs, vue, angular). Defaults to the first tab.'),
        lang: z.enum(['en', 'tr']).optional().describe('Language of the comments inside the code (default en).'),
      },
      annotations: READ,
    },
    async (a) => run(() => api.request('GET', `/v1/apps/${app(a.app_id)}/setup/snippet${query({ platform: a.platform, variant: a.variant, lang: a.lang })}`)),
  );
}

export function registerSetupWriteTools(server: McpServer, kit: ToolKit): void {
  const { api, run } = kit;

  server.registerTool(
    'create_app',
    {
      title: 'Create app',
      description:
        `${CREATE_APP_NOTE} Records the same setup state as the dashboard wizard (platforms and framework), so the user can continue in the dashboard. ` +
        'Next steps: get_setup_status, get_sdk_snippet, then upload the push credentials (local server: upload_channel_credentials; otherwise the dashboard link from get_setup_status).',
      inputSchema: {
        name: z.string().min(2).max(100),
        platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length).describe('Platforms the app targets.'),
        framework: z.enum(FRAMEWORKS).optional().describe('Mobile framework (default native).'),
        web_integration: z.enum(['code', 'wordpress']).optional().describe('Website integration type (default code).'),
        default_language: z.string().min(2).max(10).optional(),
        timezone: z.string().min(1).max(64).optional(),
      },
      annotations: WRITE,
    },
    async (a) =>
      run(() =>
        api.request('POST', '/v1/mcp/apps', {
          name: a.name,
          platforms: a.platforms,
          ...(a.framework ? { framework: a.framework } : {}),
          ...(a.web_integration ? { web_integration: a.web_integration } : {}),
          ...(a.default_language ? { default_language: a.default_language } : {}),
          ...(a.timezone ? { timezone: a.timezone } : {}),
        }),
      ),
  );
}

/** Kayıtlı kimlik bilgisinin üzerine yazar ve sağlayıcıya bağlanır; yerel dosya okur. */
const LOCAL_UPLOAD: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const pathArg = (what: string) => z.string().min(1).max(1024).describe(`${what} Path relative to the working directory of this server (or PUSHIZO_CREDENTIALS_DIR); files outside it are refused.`);
const envArg = (what: string) => z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/).describe(`NAME of an environment variable of this server process that holds ${what} (never the value itself).`);

/**
 * Yalnız yerel (stdio) sunucuda: anahtarı dosya YOLUNDAN yükler. Dosyayı bu süreç okur; içerik model bağlamına girmez.
 * Uzak (HTTP) sunucu kullanıcının dosya sistemini göremediği için bu araç orada kaydedilmez.
 */
export function registerLocalTools(server: McpServer, kit: ToolKit, host: CredentialHost): void {
  const { api, app } = kit;
  const call: ApiCall = async (method, path, body) => {
    try {
      return { status: 200, json: await api.request(method, path, body) };
    } catch (err) {
      if (err instanceof PushizoApiError) return { status: err.status, json: { error: { code: err.code, message: err.message } } };
      throw err;
    }
  };

  server.registerTool(
    'upload_channel_credentials',
    {
      title: 'Upload push credentials from a file',
      description:
        '[Local only — write] Uploads push credentials to Pushizo by reading a key FILE on this machine and validates them with the provider. ' +
        'Pass file PATHS only: never ask the user to paste a key, never read the key file yourself and never put its contents in a tool call. ' +
        'Text secrets (client secret, .p12 password, VAPID private key) are given as a `*_file` path or the NAME of an environment variable. ' +
        'Returns status only (active/invalid, error code, hint, file fingerprint). Replaces the stored credentials of that channel; get explicit approval first. ' +
        'apns: key_file (.p8 with team_id, bundle_id, environment; key_id is read from AuthKey_XXXXXXXXXX.p8, or .p12 with optional p12_password_*). ' +
        'fcm: key_file (Firebase service account .json). hms: hms_app_id + client_secret_*. adm: client_id + client_secret_*. wns: package_sid + client_secret_*. ' +
        'webpush: subject (+ site_url; a VAPID key pair is generated unless given). Required scope: admin.',
      inputSchema: {
        app_id: appIdArg,
        channel: z.enum(UPLOAD_CHANNELS),
        key_file: pathArg('APNs .p8/.p12 or Firebase service account .json file.').optional(),
        key_id: z.string().regex(/^[A-Za-z0-9]{10}$/).optional().describe('APNs Key ID (10 characters); read from the file name when omitted.'),
        team_id: z.string().regex(/^[A-Za-z0-9]{10}$/).optional().describe('Apple Team ID (10 characters).'),
        bundle_id: z.string().min(3).max(200).optional().describe('iOS bundle identifier, e.g. com.example.app.'),
        environment: z.enum(['sandbox', 'production']).optional().describe('APNs environment for the .p8 key.'),
        p12_password_file: pathArg('File holding the .p12 password.').optional(),
        p12_password_env: envArg('the .p12 password').optional(),
        confirm_project_change: z.boolean().optional().describe('FCM: confirm switching to a different Firebase project (existing Android tokens become invalid).'),
        hms_app_id: z.string().regex(/^\d{6,20}$/).optional().describe('Huawei AppGallery Connect numeric App ID.'),
        high_priority: z.boolean().optional().describe('HMS: high-priority data messages (needs Huawei approval).'),
        client_id: z.string().min(8).max(200).optional().describe('Amazon ADM client ID.'),
        package_sid: z.string().min(8).max(200).optional().describe('Windows Package SID (ms-app://…).'),
        client_secret_file: pathArg('File holding the client secret (HMS, ADM, WNS).').optional(),
        client_secret_env: envArg('the client secret').optional(),
        subject: z.string().max(320).optional().describe('Web Push VAPID subject: mailto:address or https URL.'),
        site_url: z.string().max(500).optional().describe('Website URL for Web Push.'),
        vapid_public_key: z.string().min(80).max(120).optional().describe('Existing VAPID public key (only when migrating existing subscribers).'),
        vapid_private_key_file: pathArg('File holding the existing VAPID private key.').optional(),
        vapid_private_key_env: envArg('the existing VAPID private key').optional(),
      },
      annotations: LOCAL_UPLOAD,
    },
    async (a) => {
      try {
        const { app_id, ...input } = a;
        return ok(await uploadChannelCredentials(input, decodeURIComponent(app(app_id)), host, call));
      } catch (err) {
        if (err instanceof CredentialError) return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}` }] };
        return fail(err);
      }
    },
  );
}
