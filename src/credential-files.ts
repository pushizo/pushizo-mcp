/**
 * Push anahtarını dosya YOLUNDAN yükleme (ADR-0097): yerel stdio MCP sunucusu ve `pushizo` CLI aynı kodu kullanır.
 * Bu dosya `packages/mcp-server/src/credential-files.ts` ve `packages/cli/src/credential-files.ts` içinde aynı içerikte
 * tutulur (yayımlanan paketler birbirine bağımlı olmaz); eşitliği birim testi zorlar.
 *
 * Kurallar: dosyayı yalnız bu süreç okur; içerik ve sır değerleri dönüş değerine, hata iletisine ya da günlüğe
 * yazılmaz. Dönüş yalnız durumdur (kanal, sağlayıcı, `active`/`invalid`, hata kodu, öneri, dosya parmak izi).
 */
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

export const UPLOAD_CHANNELS = ['apns', 'fcm', 'hms', 'adm', 'wns', 'webpush'] as const;
export type UploadChannel = (typeof UPLOAD_CHANNELS)[number];

/** Kısa ad → public API kanal yolu. */
export const UPLOAD_CHANNEL_PATH: Record<UploadChannel, string> = {
  apns: 'ios_push',
  fcm: 'android_push',
  hms: 'hms_push',
  adm: 'adm_push',
  wns: 'wns_push',
  webpush: 'web_push',
};

/** Anahtar dosyası (`.p8`, `.p12`, servis hesabı JSON'u) üst sınırı. */
export const MAX_KEY_FILE_BYTES = 64 * 1024;
/** Metin sırrı dosyası (`client_secret`, parola, VAPID özel anahtarı) üst sınırı. */
export const MAX_SECRET_FILE_BYTES = 4 * 1024;

/** PKCS#8 PEM sınırları. Parçalı yazılır: gizli bilgi tarayıcıları tam başlığı anahtar sanmasın. */
const PEM_DASHES = '-----';
const PEM_HEAD = `${PEM_DASHES}BEGIN PRIVATE KEY${PEM_DASHES}`;
const PEM_TAIL = `${PEM_DASHES}END PRIVATE KEY${PEM_DASHES}`;

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
/** Sır kaynağı olarak okunamayan ortam değişkenleri (Pushizo API anahtarı başka yere taşınmaz). */
const FORBIDDEN_ENV = new Set(['PUSHIZO_API_KEY']);

export interface CredentialHost {
  /** Dosyaların okunabileceği kök dizin (çalışma dizini ya da `PUSHIZO_CREDENTIALS_DIR`). */
  rootDir: string;
  env: Record<string, string | undefined>;
}

export interface CredentialInput {
  channel: UploadChannel;
  /** APNs `.p8`/`.p12` ya da Firebase servis hesabı `.json` dosyasının yolu. */
  key_file?: string;
  key_id?: string;
  team_id?: string;
  bundle_id?: string;
  environment?: 'sandbox' | 'production';
  p12_password_file?: string;
  p12_password_env?: string;
  confirm_project_change?: boolean;
  hms_app_id?: string;
  high_priority?: boolean;
  client_id?: string;
  package_sid?: string;
  client_secret_file?: string;
  client_secret_env?: string;
  subject?: string;
  site_url?: string;
  vapid_public_key?: string;
  vapid_private_key_file?: string;
  vapid_private_key_env?: string;
}

export interface ApiReply {
  status: number;
  json: unknown;
}
/** Public API çağrısı; hata durumunda fırlatmaz, durum kodu ve gövdeyi döndürür. */
export type ApiCall = (method: 'PUT' | 'POST', path: string, body?: unknown) => Promise<ApiReply>;

export interface FileFingerprint {
  name: string;
  bytes: number;
  /** SHA-256 özetinin ilk 12 onaltılık hanesi (doğru dosyanın yüklendiğini karşılaştırmak için). */
  sha256: string;
}

export interface UploadResult {
  channel: string;
  provider: string;
  /** Kayıt yapıldı mı (`PUT` başarılı). */
  saved: boolean;
  /** Sağlayıcı doğrulaması geçti mi. */
  ok: boolean;
  status: string;
  error_code: string | null;
  message: string | null;
  hint: string | null;
  file: FileFingerprint | null;
}

/** Yerel denetim hatası (yol, boyut, biçim, eksik alan). İleti hiçbir dosya içeriği taşımaz. */
export class CredentialError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CredentialError';
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Kullanıcının verdiği yolu kök dizin altında gerçek yola çözer. Kök dışına çıkan yol (`..`, mutlak yol, sembolik
 * bağ) reddedilir; dosya sistemi kökü kök dizin olarak kabul edilmez.
 */
export async function resolveInside(rootDir: string, userPath: string): Promise<string> {
  if (typeof userPath !== 'string' || userPath.trim() === '' || userPath.includes('\0'))
    throw new CredentialError('PATH_INVALID', 'A file path is required.');
  let root: string;
  try {
    root = await realpath(rootDir);
  } catch {
    throw new CredentialError('ROOT_NOT_FOUND', 'The credentials directory does not exist.');
  }
  if (root === path.parse(root).root)
    throw new CredentialError('ROOT_NOT_ALLOWED', 'The filesystem root cannot be the credentials directory. Start the process in your project folder or set PUSHIZO_CREDENTIALS_DIR.');
  const candidate = path.resolve(root, userPath.trim());
  if (!isInside(root, candidate))
    throw new CredentialError('PATH_OUTSIDE_ROOT', 'The file must be inside the credentials directory (the working directory or PUSHIZO_CREDENTIALS_DIR).');
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new CredentialError('FILE_NOT_FOUND', `File not found: ${path.basename(candidate)}`);
  }
  if (!isInside(root, real))
    throw new CredentialError('PATH_OUTSIDE_ROOT', 'The file resolves outside the credentials directory (symbolic link).');
  return real;
}

/** Kök altındaki normal dosyayı boyut sınırıyla okur. */
export async function readBoundedFile(rootDir: string, userPath: string, maxBytes: number): Promise<{ real: string; data: Buffer }> {
  const real = await resolveInside(rootDir, userPath);
  const handle = await open(real, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CredentialError('NOT_A_FILE', `Not a regular file: ${path.basename(real)}`);
    if (info.size === 0) throw new CredentialError('FILE_EMPTY', `File is empty: ${path.basename(real)}`);
    if (info.size > maxBytes) throw new CredentialError('FILE_TOO_LARGE', `File is larger than ${maxBytes} bytes: ${path.basename(real)}`);
    const data = await handle.readFile();
    if (data.length > maxBytes) throw new CredentialError('FILE_TOO_LARGE', `File is larger than ${maxBytes} bytes: ${path.basename(real)}`);
    return { real, data };
  } finally {
    await handle.close();
  }
}

function fingerprint(real: string, data: Buffer): FileFingerprint {
  return { name: path.basename(real), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex').slice(0, 12) };
}

/** `AuthKey_ABCDE12345.p8` → `ABCDE12345` (Apple'ın indirdiği dosya adı); eşleşmezse null. */
export function keyIdFromP8FileName(name: string): string | null {
  const m = /^AuthKey_([A-Za-z0-9]{10})(?:\s*\(\d+\))?\.p8$/i.exec(path.basename(name).trim());
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Metin sırrı: yalnız dosya yolu ya da ortam değişkeni ADI ile verilir; değerin kendisi argüman olamaz.
 * İkisi de verilmediyse `undefined` (güncellemede kayıtlı sır korunur).
 */
export async function readTextSecret(host: CredentialHost, source: { file?: string; env?: string }, label: string): Promise<string | undefined> {
  if (source.file && source.env) throw new CredentialError('SECRET_SOURCE_CONFLICT', `Give either ${label}_file or ${label}_env, not both.`);
  if (source.file) {
    const { data } = await readBoundedFile(host.rootDir, source.file, MAX_SECRET_FILE_BYTES);
    const value = data.toString('utf8').trim();
    if (!value || /[\r\n]/.test(value)) throw new CredentialError('SECRET_FILE_INVALID', `${label}_file must contain a single non-empty line.`);
    return value;
  }
  if (source.env) {
    if (!ENV_NAME.test(source.env) || FORBIDDEN_ENV.has(source.env))
      throw new CredentialError('ENV_NAME_INVALID', `${label}_env must be an environment variable NAME (A-Z, 0-9, _), not a value.`);
    const value = host.env[source.env]?.trim();
    if (!value) throw new CredentialError('ENV_NOT_SET', `Environment variable ${source.env} is not set in the process that runs this tool.`);
    return value;
  }
  return undefined;
}

function required(input: CredentialInput, fields: (keyof CredentialInput)[]): void {
  const missing = fields.filter((f) => input[f] === undefined || input[f] === '');
  if (missing.length) throw new CredentialError('MISSING_FIELD', `Missing: ${missing.join(', ')}.`);
}

function extensionOf(file: string): string {
  return path.extname(file).toLowerCase();
}

export interface BuiltCredentials {
  provider: string;
  body: Record<string, unknown>;
  file: FileFingerprint | null;
  /** Çıktıdan arındırılacak sır değerleri. */
  secrets: string[];
}

/** PEM gövdesinin satırları da sır sayılır (ileti içinde parça olarak geçebilir). */
function pemSecrets(pem: string): string[] {
  return [pem, ...pem.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 16 && !l.startsWith(PEM_DASHES))];
}

/** Girdi ve dosyalardan `PUT /v1/apps/{app}/channels/{channel}` gövdesini üretir; biçimi yerelde doğrular. */
export async function buildChannelCredentials(input: CredentialInput, host: CredentialHost): Promise<BuiltCredentials> {
  switch (input.channel) {
    case 'apns': {
      required(input, ['key_file']);
      const ext = extensionOf(input.key_file!);
      if (ext === '.p8') {
        const { real, data } = await readBoundedFile(host.rootDir, input.key_file!, MAX_KEY_FILE_BYTES);
        const pem = data.toString('utf8').trim();
        if (!pem.startsWith(PEM_HEAD) || !pem.endsWith(PEM_TAIL) || pem.length <= PEM_HEAD.length + PEM_TAIL.length)
          throw new CredentialError('KEY_FORMAT_INVALID', 'The .p8 file is not a PKCS#8 PEM private key (expected a "BEGIN PRIVATE KEY" header).');
        const keyId = (input.key_id ?? keyIdFromP8FileName(real) ?? '').toUpperCase();
        if (!keyId) throw new CredentialError('MISSING_FIELD', 'Missing: key_id (not found in the file name; expected AuthKey_XXXXXXXXXX.p8).');
        required(input, ['team_id', 'bundle_id', 'environment']);
        return {
          provider: 'apns',
          body: { provider: 'apns', key_id: keyId, team_id: input.team_id, bundle_id: input.bundle_id, environment: input.environment, p8: pem },
          file: fingerprint(real, data),
          secrets: pemSecrets(pem),
        };
      }
      if (ext === '.p12') {
        const { real, data } = await readBoundedFile(host.rootDir, input.key_file!, MAX_KEY_FILE_BYTES);
        if (data[0] !== 0x30) throw new CredentialError('KEY_FORMAT_INVALID', 'The .p12 file is not a PKCS#12 (DER) container.');
        const password = await readTextSecret(host, { file: input.p12_password_file, env: input.p12_password_env }, 'p12_password');
        const p12 = data.toString('base64');
        return {
          provider: 'apns',
          body: { provider: 'apns', p12, ...(password !== undefined ? { p12_password: password } : {}), ...(input.bundle_id ? { bundle_id: input.bundle_id } : {}) },
          file: fingerprint(real, data),
          secrets: [p12, ...(password ? [password] : [])],
        };
      }
      throw new CredentialError('KEY_EXTENSION_INVALID', 'APNs needs a .p8 (token) or .p12 (certificate) file.');
    }
    case 'fcm': {
      required(input, ['key_file']);
      if (extensionOf(input.key_file!) !== '.json') throw new CredentialError('KEY_EXTENSION_INVALID', 'FCM needs the Firebase service account .json file.');
      const { real, data } = await readBoundedFile(host.rootDir, input.key_file!, MAX_KEY_FILE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        throw new CredentialError('KEY_FORMAT_INVALID', 'The file is not valid JSON.');
      }
      const sa = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
      if (sa.type !== 'service_account' || typeof sa.project_id !== 'string' || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string' || !sa.private_key.includes(`PRIVATE KEY${PEM_DASHES}`))
        throw new CredentialError(
          'KEY_FORMAT_INVALID',
          'The JSON is not a Firebase service account key (needs type: service_account, project_id, client_email, private_key). google-services.json is a different file.',
        );
      return {
        provider: 'fcm',
        body: {
          provider: 'fcm',
          service_account: {
            type: 'service_account',
            project_id: sa.project_id,
            client_email: sa.client_email,
            private_key: sa.private_key,
            ...(typeof sa.token_uri === 'string' ? { token_uri: sa.token_uri } : {}),
          },
          ...(input.confirm_project_change ? { confirm_project_change: true } : {}),
        },
        file: fingerprint(real, data),
        secrets: pemSecrets(sa.private_key),
      };
    }
    case 'hms':
    case 'adm':
    case 'wns': {
      const idField = input.channel === 'hms' ? 'hms_app_id' : input.channel === 'adm' ? 'client_id' : 'package_sid';
      required(input, [idField]);
      const secret = await readTextSecret(host, { file: input.client_secret_file, env: input.client_secret_env }, 'client_secret');
      const idKey = input.channel === 'hms' ? 'app_id' : idField;
      return {
        provider: input.channel,
        body: {
          provider: input.channel,
          [idKey]: input[idField],
          ...(secret !== undefined ? { client_secret: secret } : {}),
          ...(input.channel === 'hms' && input.high_priority !== undefined ? { high_priority: input.high_priority } : {}),
        },
        file: null,
        secrets: secret ? [secret] : [],
      };
    }
    case 'webpush': {
      required(input, ['subject']);
      const privateKey = await readTextSecret(host, { file: input.vapid_private_key_file, env: input.vapid_private_key_env }, 'vapid_private_key');
      if ((privateKey === undefined) !== (input.vapid_public_key === undefined))
        throw new CredentialError('MISSING_FIELD', 'Give vapid_public_key together with vapid_private_key_file/_env, or neither (a new key pair is generated).');
      return {
        provider: 'webpush',
        body: {
          provider: 'webpush',
          subject: input.subject,
          ...(input.site_url ? { site_url: input.site_url } : {}),
          ...(privateKey !== undefined ? { vapid_public_key: input.vapid_public_key, vapid_private_key: privateKey } : {}),
        },
        file: null,
        secrets: privateKey ? [privateKey] : [],
      };
    }
    default:
      throw new CredentialError('CHANNEL_INVALID', `Unknown channel. Use one of: ${UPLOAD_CHANNELS.join(', ')}.`);
  }
}

/** İletiyi okunan sır değerlerinden arındırır ve kısaltır. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

const HINTS: Record<string, string> = {
  auth: 'The provider rejected the credentials. Check that the key belongs to this app (APNs: Key ID, Team ID, bundle id, environment; FCM: the service account of the same Firebase project) and has not been revoked.',
  config: 'The configuration is incomplete or inconsistent. Check the identifiers passed with the file.',
  transient: 'The provider could not be reached. The credentials are saved; run the upload or validation again in a moment.',
  HTTP_401: 'The Pushizo API key is invalid, expired or revoked.',
  HTTP_403: 'Uploading channel credentials needs an API key with the `admin` scope that can access this app.',
  HTTP_404: 'The app was not found for this API key. Check app_id.',
  HTTP_429: 'Rate limited. Wait a minute and try again.',
  HS_VALIDATION_ERROR: 'The API rejected a field. Check the identifiers (Key ID and Team ID are 10 characters; bundle id; numeric HMS App ID).',
  HS_PLAN_FEATURE_REQUIRED: 'This channel is not included in the organization plan.',
};

function errorOf(json: unknown): { code: string | null; message: string | null } {
  const err = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return { code: typeof err?.code === 'string' ? err.code : null, message: typeof err?.message === 'string' ? err.message : null };
}

/**
 * Anahtarı dosyadan okur, kaydeder ve sağlayıcıya doğrulatır. Dönüş yalnız durumdur; API'nin döndürdüğü yapılandırma
 * ayrıntısı ve okunan içerik dönüşe girmez.
 */
export async function uploadChannelCredentials(input: CredentialInput, appId: string, host: CredentialHost, call: ApiCall): Promise<UploadResult> {
  const built = await buildChannelCredentials(input, host);
  const channel = UPLOAD_CHANNEL_PATH[input.channel];
  const base = `/v1/apps/${encodeURIComponent(appId)}/channels/${channel}`;
  const result = (patch: Partial<UploadResult>): UploadResult => ({
    channel,
    provider: built.provider,
    saved: false,
    ok: false,
    status: 'not_saved',
    error_code: null,
    message: null,
    hint: null,
    file: built.file,
    ...patch,
  });

  const saved = await call('PUT', base, built.body);
  if (saved.status < 200 || saved.status >= 300) {
    const err = errorOf(saved.json);
    const code = err.code ?? `HTTP_${saved.status}`;
    return result({ error_code: code, message: err.message ? scrubSecrets(err.message, built.secrets) : null, hint: HINTS[code] ?? HINTS[`HTTP_${saved.status}`] ?? null });
  }

  const checked = await call('POST', `${base}/validate`);
  if (checked.status < 200 || checked.status >= 300) {
    const err = errorOf(checked.json);
    const code = err.code ?? `HTTP_${checked.status}`;
    return result({ saved: true, status: 'unverified', error_code: code, message: err.message ? scrubSecrets(err.message, built.secrets) : null, hint: HINTS[code] ?? HINTS[`HTTP_${checked.status}`] ?? HINTS.transient! });
  }
  const view = (checked.json ?? {}) as { ok?: unknown; kind?: unknown; code?: unknown; message?: unknown; channel?: { status?: unknown } };
  const ok = view.ok === true;
  const status = typeof view.channel?.status === 'string' ? view.channel.status : ok ? 'active' : 'invalid';
  if (ok) return result({ saved: true, ok: true, status });
  return result({
    saved: true,
    status,
    error_code: typeof view.code === 'string' ? view.code : 'VALIDATION_FAILED',
    message: typeof view.message === 'string' ? scrubSecrets(view.message, built.secrets) : null,
    hint: (typeof view.kind === 'string' ? HINTS[view.kind] : undefined) ?? HINTS.config!,
  });
}
