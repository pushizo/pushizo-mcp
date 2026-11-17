import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PushizoApiError, type PushizoApi } from './api.js';

/** Okuma araçları: yan etkisiz; sunucuda ilgili okuma kapsamı yeterli. */
export const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Yazma araçları: yalnızca taslak oluşturur (gönderim/silme yok), sunucuda `mcp:write` kapsamı zorunlu. */
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const WRITE_NOTE =
  '[Approved mode — write] This tool creates a record in Pushizo. It only creates a DRAFT and never sends or schedules a message; ' +
  'the API key needs the `mcp:write` scope. Get explicit approval from the user before calling it.';

/**
 * Kimlikler URL yoluna yazılır: `.` ve `..` WHATWG URL çözümlemesinde başka uca kayar, `/` yolu böler. Desen bunları
 * dışarıda bırakır (ADR-0076 §5).
 */
const ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9_.:-]+$/;
const ID_MESSAGE = 'ID may only contain letters, digits, `_`, `-`, `.` and `:`.';

export const appIdArg = z.string().min(1).max(64).regex(ID_PATTERN, ID_MESSAGE).optional().describe('App ID (app_…). Not needed with an app-scoped key or when a default app is configured.');
export const limitArg = z.number().int().min(1).max(100).optional().describe('Page size (default 20).');
export const cursorArg = z.string().max(500).optional().describe('The `next_cursor` value from the previous response.');
export const idArg = (what: string) => z.string().min(1).max(64).regex(ID_PATTERN, ID_MESSAGE).describe(`${what} ID`);
export const fromArg = z.string().max(40).optional().describe('ISO-8601 start (e.g. 2026-10-01T00:00:00Z); defaults to the report default.');
export const toArg = z.string().max(40).optional().describe('ISO-8601 end.');
/** Segment/arama tanımı: all/any/none koşul grupları (segment taslağıyla aynı biçim). */
export const definitionArg = z
  .record(z.string(), z.unknown())
  .describe('Condition definition, e.g. {"all":[{"field":"tags.plan","op":"eq","value":"pro"},{"field":"last_active_at","op":"within_days","value":30}]}.');

export function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Sık görülen durum kodları için modelin sonraki adımını belirleyen ipucu. */
const HTTP_HINTS: Record<number, string> = {
  403: ' — Check the API key scopes.',
  429: ' — Rate limited; wait a few seconds and retry, and reduce back-to-back calls.',
};

export function fail(err: unknown): CallToolResult {
  const text =
    err instanceof PushizoApiError
      ? `${err.code} (HTTP ${err.status}): ${err.message}${HTTP_HINTS[err.status] ?? ''}`
      : err instanceof Error
        ? err.name === 'TimeoutError' || err.name === 'AbortError'
          ? 'Request timed out; retry with a narrower date range or a smaller `limit`.'
          : err.message
        : String(err);
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Araç kayıtlarının ortak bağlamı: API erişimi, app yolu çözümü ve hata sarmalayıcı. */
export interface ToolKit {
  api: PushizoApi;
  /** URL'e gömülmeye hazır app kimliği (verilen veya varsayılan). */
  app: (appId?: string) => string;
  run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
}

export function createToolKit(api: PushizoApi, defaultAppId?: string): ToolKit {
  function app(appId?: string): string {
    const id = appId ?? defaultAppId;
    if (!id) throw new Error('app_id is required (pass app_id in the tool call when the key is organization-wide).');
    return seg(id);
  }
  async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      return ok(await fn());
    } catch (err) {
      return fail(err);
    }
  }
  return { api, app, run };
}

/**
 * Yol parçası (kimlik, alias değeri, olay adı) güvenli kodlama. `encodeURIComponent` noktayı kodlamaz; `.` ve `..`
 * tek başına yol parçası olunca istek başka uca gider, bu yüzden reddedilir.
 */
export function seg(value: string): string {
  if (value === '.' || value === '..') throw new Error('Invalid value: `.` and `..` cannot be used as path segments.');
  return encodeURIComponent(value);
}
