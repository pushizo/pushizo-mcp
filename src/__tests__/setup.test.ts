import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CredentialError,
  MAX_KEY_FILE_BYTES,
  buildChannelCredentials,
  keyIdFromP8FileName,
  readTextSecret,
  resolveInside,
  scrubSecrets,
  uploadChannelCredentials,
  type ApiCall,
  type CredentialHost,
} from '../credential-files.js';
import { PushizoApiError, createPushizoMcpServer, type PushizoApi } from '../index.js';

/** Faz 68 (ADR-0097): kurulum araçları ve anahtarı dosya yolundan yükleme (yalnız yerel süreç). */
const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'pushizo-cred-')));
const root = path.join(base, 'project');
const outside = path.join(base, 'outside');
mkdirSync(root);
mkdirSync(outside);
afterAll(() => rmSync(base, { recursive: true, force: true }));

const p8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const p8Body = p8.split('\n').filter((l) => l && !l.startsWith('-----'));
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const serviceAccount = { type: 'service_account', project_id: 'demo-project', client_email: 'push@demo-project.iam.gserviceaccount.com', private_key: rsa, private_key_id: 'abc' };
const CLIENT_SECRET = `cs_${randomBytes(18).toString('hex')}`;

writeFileSync(path.join(root, 'AuthKey_ABCDE12345.p8'), p8);
writeFileSync(path.join(root, 'key.p8'), p8);
writeFileSync(path.join(root, 'firebase.json'), JSON.stringify(serviceAccount));
writeFileSync(path.join(root, 'google-services.json'), JSON.stringify({ project_info: { project_id: 'demo-project' } }));
writeFileSync(path.join(root, 'secret.txt'), `${CLIENT_SECRET}\n`);
writeFileSync(path.join(root, 'big.p8'), Buffer.alloc(MAX_KEY_FILE_BYTES + 1, 0x41));
writeFileSync(path.join(root, 'openssh.p8'), '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n');
writeFileSync(path.join(outside, 'AuthKey_ZZZZZ99999.p8'), p8);
symlinkSync(path.join(outside, 'AuthKey_ZZZZZ99999.p8'), path.join(root, 'link.p8'));
symlinkSync(outside, path.join(root, 'linkdir'));

const host: CredentialHost = { rootDir: root, env: { HMS_SECRET: CLIENT_SECRET, PUSHIZO_API_KEY: 'hs_live_gizli' } };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof CredentialError) return err.code;
    throw err;
  }
  return null;
};

function recorder(replies: { status: number; json: unknown }[]) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const call: ApiCall = async (method, p, body) => {
    calls.push({ method, path: p, body });
    return replies[calls.length - 1] ?? { status: 200, json: {} };
  };
  return { calls, call };
}

describe('yol güvenliği', () => {
  it('kök altındaki dosya gerçek yola çözülür', async () => {
    expect(await resolveInside(root, 'key.p8')).toBe(path.join(root, 'key.p8'));
    expect(await resolveInside(root, path.join(root, 'key.p8'))).toBe(path.join(root, 'key.p8'));
  });

  it('kök dışına çıkan yol reddedilir: `..`, mutlak yol, sembolik bağ, bağlı dizin', async () => {
    expect(await code(resolveInside(root, '../outside/AuthKey_ZZZZZ99999.p8'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, 'sub/../../outside/AuthKey_ZZZZZ99999.p8'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, path.join(outside, 'AuthKey_ZZZZZ99999.p8')))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, '/etc/hosts'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, 'link.p8'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, 'linkdir/AuthKey_ZZZZZ99999.p8'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInside(root, '.'))).toBe('PATH_OUTSIDE_ROOT');
  });

  it('dosya sistemi kökü kök dizin olamaz; boş ve bozuk yol reddedilir; olmayan dosya bulunamaz', async () => {
    expect(await code(resolveInside(path.parse(root).root, 'etc/hosts'))).toBe('ROOT_NOT_ALLOWED');
    expect(await code(resolveInside(root, ''))).toBe('PATH_INVALID');
    expect(await code(resolveInside(root, 'a\0b'))).toBe('PATH_INVALID');
    expect(await code(resolveInside(root, 'yok.p8'))).toBe('FILE_NOT_FOUND');
    expect(await code(resolveInside(path.join(base, 'yok'), 'key.p8'))).toBe('ROOT_NOT_FOUND');
  });

  it('boyut sınırı, dizin ve uzantı denetimi', async () => {
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'big.p8', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'sandbox', key_id: 'ABCDE12345' }, host))).toBe('FILE_TOO_LARGE');
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'secret.txt' }, host))).toBe('KEY_EXTENSION_INVALID');
    expect(await code(buildChannelCredentials({ channel: 'fcm', key_file: 'key.p8' }, host))).toBe('KEY_EXTENSION_INVALID');
    mkdirSync(path.join(root, 'dir.p8'));
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'dir.p8' }, host))).toBe('NOT_A_FILE');
  });
});

describe('biçim doğrulaması ve gövde', () => {
  it('APNs .p8: PKCS#8 başlığı zorunlu, Key ID dosya adından okunur', async () => {
    expect(keyIdFromP8FileName('AuthKey_abcde12345.p8')).toBe('ABCDE12345');
    expect(keyIdFromP8FileName('/x/AuthKey_ABCDE12345 (1).p8')).toBe('ABCDE12345');
    expect(keyIdFromP8FileName('key.p8')).toBeNull();
    const built = await buildChannelCredentials({ channel: 'apns', key_file: 'AuthKey_ABCDE12345.p8', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'production' }, host);
    expect(built.body).toEqual({ provider: 'apns', key_id: 'ABCDE12345', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'production', p8: p8.trim() });
    expect(built.file).toMatchObject({ name: 'AuthKey_ABCDE12345.p8', bytes: Buffer.byteLength(p8) });
    expect(built.file!.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'key.p8', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'sandbox' }, host))).toBe('MISSING_FIELD');
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'AuthKey_ABCDE12345.p8' }, host))).toBe('MISSING_FIELD');
    expect(await code(buildChannelCredentials({ channel: 'apns', key_file: 'openssh.p8', key_id: 'ABCDE12345', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'sandbox' }, host))).toBe('KEY_FORMAT_INVALID');
  });

  it('FCM: yalnız servis hesabı JSON’u kabul edilir (google-services.json reddedilir)', async () => {
    const built = await buildChannelCredentials({ channel: 'fcm', key_file: 'firebase.json' }, host);
    expect(built.body).toEqual({ provider: 'fcm', service_account: { type: 'service_account', project_id: 'demo-project', client_email: serviceAccount.client_email, private_key: rsa } });
    expect(await code(buildChannelCredentials({ channel: 'fcm', key_file: 'google-services.json' }, host))).toBe('KEY_FORMAT_INVALID');
  });

  it('metin sırrı yalnız dosya yolu ya da ortam değişkeni adıyla okunur', async () => {
    expect(await readTextSecret(host, { file: 'secret.txt' }, 'client_secret')).toBe(CLIENT_SECRET);
    expect(await readTextSecret(host, { env: 'HMS_SECRET' }, 'client_secret')).toBe(CLIENT_SECRET);
    expect(await readTextSecret(host, {}, 'client_secret')).toBeUndefined();
    expect(await code(readTextSecret(host, { file: 'secret.txt', env: 'HMS_SECRET' }, 'client_secret'))).toBe('SECRET_SOURCE_CONFLICT');
    expect(await code(readTextSecret(host, { env: 'YOK_BOYLE_BIR_DEGISKEN' }, 'client_secret'))).toBe('ENV_NOT_SET');
    // Değerin kendisi (ad biçimine uymayan metin) ve Pushizo API anahtarı sır kaynağı olamaz.
    expect(await code(readTextSecret(host, { env: CLIENT_SECRET }, 'client_secret'))).toBe('ENV_NAME_INVALID');
    expect(await code(readTextSecret(host, { env: 'PUSHIZO_API_KEY' }, 'client_secret'))).toBe('ENV_NAME_INVALID');
    expect(await code(readTextSecret(host, { file: '../outside/AuthKey_ZZZZZ99999.p8' }, 'client_secret'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(readTextSecret(host, { file: 'AuthKey_ABCDE12345.p8' }, 'client_secret'))).toBe('SECRET_FILE_INVALID');
    const hms = await buildChannelCredentials({ channel: 'hms', hms_app_id: '123456789', client_secret_env: 'HMS_SECRET' }, host);
    expect(hms.body).toEqual({ provider: 'hms', app_id: '123456789', client_secret: CLIENT_SECRET });
    expect((await buildChannelCredentials({ channel: 'wns', package_sid: 'ms-app://s-1-15-2-1', client_secret_file: 'secret.txt' }, host)).body).toEqual({ provider: 'wns', package_sid: 'ms-app://s-1-15-2-1', client_secret: CLIENT_SECRET });
    expect((await buildChannelCredentials({ channel: 'webpush', subject: 'mailto:dev@example.com', site_url: 'https://example.com' }, host)).body).toEqual({ provider: 'webpush', subject: 'mailto:dev@example.com', site_url: 'https://example.com' });
    expect(await code(buildChannelCredentials({ channel: 'webpush', subject: 'mailto:dev@example.com', vapid_public_key: 'B'.repeat(87) }, host))).toBe('MISSING_FIELD');
  });
});

describe('yükleme: çıktı yalnız durumdur', () => {
  const apns = { channel: 'apns', key_file: 'AuthKey_ABCDE12345.p8', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'sandbox' } as const;

  it('kaydeder, doğrular ve sırrı döndürmez', async () => {
    const { calls, call } = recorder([
      { status: 200, json: { channel: 'ios_push', config: { key_id: 'ABCDE12345' } } },
      { status: 200, json: { ok: true, kind: null, code: null, message: null, channel: { status: 'active', config: { bundle_id: 'com.example.app' } } } },
    ]);
    const result = await uploadChannelCredentials(apns, 'app_1', host, call);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /v1/apps/app_1/channels/ios_push', 'POST /v1/apps/app_1/channels/ios_push/validate']);
    expect((calls[0]!.body as { p8: string }).p8).toBe(p8.trim());
    expect(result).toMatchObject({ channel: 'ios_push', provider: 'apns', saved: true, ok: true, status: 'active', error_code: null });
    expect(Object.keys(result).sort()).toEqual(['channel', 'error_code', 'file', 'hint', 'message', 'ok', 'provider', 'saved', 'status']);
    const text = JSON.stringify(result);
    for (const line of p8Body) expect(text).not.toContain(line);
    expect(text).not.toContain('PRIVATE KEY');
  });

  it('doğrulama başarısızsa `invalid`, hata kodu ve öneri döner; ileti sırdan arındırılır', async () => {
    const { call } = recorder([
      { status: 200, json: {} },
      { status: 200, json: { ok: false, kind: 'auth', code: 'InvalidProviderToken', message: `rejected key ${p8Body[0]}`, channel: { status: 'invalid' } } },
    ]);
    const result = await uploadChannelCredentials(apns, 'app_1', host, call);
    expect(result).toMatchObject({ saved: true, ok: false, status: 'invalid', error_code: 'InvalidProviderToken' });
    expect(result.hint).toContain('Key ID');
    expect(result.message).toBe('rejected key [redacted]');
  });

  it('API reddi: kayıt yapılmaz, doğrulama çağrılmaz, yankılanan sır arındırılır', async () => {
    const { calls, call } = recorder([{ status: 403, json: { error: { code: 'HS_FORBIDDEN', message: `scope missing for ${CLIENT_SECRET}` } } }]);
    const result = await uploadChannelCredentials({ channel: 'hms', hms_app_id: '123456789', client_secret_file: 'secret.txt' }, 'app_1', host, call);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ saved: false, ok: false, status: 'not_saved', error_code: 'HS_FORBIDDEN', file: null });
    expect(result.hint).toContain('admin');
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it('yerel hata iletisi dosya içeriği taşımaz ve API çağrılmaz', async () => {
    const { calls, call } = recorder([]);
    const err = await uploadChannelCredentials({ ...apns, key_file: 'link.p8' }, 'app_1', host, call).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CredentialError);
    expect(calls).toHaveLength(0);
    expect(scrubSecrets(`a ${CLIENT_SECRET} b`, [CLIENT_SECRET])).toBe('a [redacted] b');
  });
});

describe('MCP kurulum araçları', () => {
  async function connect(options: { local?: CredentialHost; scopes?: readonly string[]; handler?: (method: string, p: string, body?: unknown) => unknown }) {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const api: PushizoApi = {
      async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown): Promise<T> {
        calls.push({ method, path: p, body });
        return (options.handler?.(method, p, body) ?? {}) as T;
      },
    };
    const server = createPushizoMcpServer({ api, defaultAppId: 'app_1', scopes: options.scopes, local: options.local });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return { client, calls };
  }
  const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

  it('uzak (HTTP) sunucuda yükleme aracı yoktur; yerel sunucuda vardır; yazma kapsamı yoksa hiçbirinde yoktur', async () => {
    const remote = await names((await connect({ scopes: ['mcp:write', 'users:read'] })).client);
    expect(remote).toEqual(expect.arrayContaining(['create_app', 'get_setup_status', 'get_sdk_snippet']));
    expect(remote).not.toContain('upload_channel_credentials');
    const local = await names((await connect({ local: host })).client);
    expect(local).toContain('upload_channel_credentials');
    expect(local).toHaveLength(remote.length + 1);
    const readOnly = await names((await connect({ local: host, scopes: ['users:read'] })).client);
    expect(readOnly).toEqual(expect.arrayContaining(['get_setup_status', 'get_sdk_snippet']));
    expect(readOnly).not.toContain('create_app');
    expect(readOnly).not.toContain('upload_channel_credentials');
  });

  it('create_app, get_setup_status ve get_sdk_snippet public API uçlarını çağırır', async () => {
    const { client, calls } = await connect({});
    await client.callTool({ name: 'create_app', arguments: { name: 'Mağaza', platforms: ['ios', 'android'], framework: 'flutter' } });
    await client.callTool({ name: 'get_setup_status', arguments: {} });
    await client.callTool({ name: 'get_sdk_snippet', arguments: { app_id: 'app_2', platform: 'flutter', lang: 'tr' } });
    expect(calls).toEqual([
      { method: 'POST', path: '/v1/mcp/apps', body: { name: 'Mağaza', platforms: ['ios', 'android'], framework: 'flutter' } },
      { method: 'GET', path: '/v1/apps/app_1/setup/status', body: undefined },
      { method: 'GET', path: '/v1/apps/app_2/setup/snippet?platform=flutter&lang=tr', body: undefined },
    ]);
  });

  it('upload_channel_credentials: şema sır değeri kabul etmez, çıktı yalnız durumdur', async () => {
    const { client, calls } = await connect({
      local: host,
      handler: (method) => (method === 'PUT' ? { config: { private: 'x' } } : { ok: true, channel: { status: 'active' } }),
    });
    const tool = (await client.listTools()).tools.find((t) => t.name === 'upload_channel_credentials')!;
    const props = Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties);
    for (const forbidden of ['p8', 'p12', 'p12_password', 'client_secret', 'service_account', 'vapid_private_key', 'private_key']) expect(props).not.toContain(forbidden);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool.description).toContain('Required scope: admin');

    const result = await client.callTool({ name: 'upload_channel_credentials', arguments: { channel: 'fcm', key_file: 'firebase.json' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ channel: 'android_push', provider: 'fcm', saved: true, ok: true, status: 'active', file: { name: 'firebase.json' } });
    expect(text(result)).not.toContain('PRIVATE KEY');
    expect(text(result)).not.toContain(rsa.split('\n')[1]!);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /v1/apps/app_1/channels/android_push', 'POST /v1/apps/app_1/channels/android_push/validate']);

    const escaped = await client.callTool({ name: 'upload_channel_credentials', arguments: { channel: 'apns', key_file: '../outside/AuthKey_ZZZZZ99999.p8', team_id: 'TEAM123456', bundle_id: 'com.example.app', environment: 'sandbox' } });
    expect(escaped.isError).toBe(true);
    expect(text(escaped)).toContain('PATH_OUTSIDE_ROOT');
    // Ortam değişkeni adı yerine değer verilirse şema reddeder.
    const rawSecret = await client.callTool({ name: 'upload_channel_credentials', arguments: { channel: 'hms', hms_app_id: '123456789', client_secret_env: CLIENT_SECRET } });
    expect(rawSecret.isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('API hatası durum olarak döner (kapsam reddi)', async () => {
    const { client } = await connect({
      local: host,
      handler: () => {
        throw new PushizoApiError(403, 'HS_FORBIDDEN', 'Bu işlem için admin kapsamı gerekir.');
      },
    });
    const result = await client.callTool({ name: 'upload_channel_credentials', arguments: { channel: 'fcm', key_file: 'firebase.json' } });
    expect(JSON.parse(text(result))).toMatchObject({ saved: false, ok: false, status: 'not_saved', error_code: 'HS_FORBIDDEN' });
  });
});

describe('CLI ile ortak kod', () => {
  it('`credential-files.ts` iki pakette aynı içeriktedir', () => {
    const normalize = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(normalize('../../../cli/src/credential-files.ts')).toBe(normalize('../credential-files.ts'));
  });
});
