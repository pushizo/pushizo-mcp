import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PushizoApiError, type PushizoApi } from './api.js';

/** Okuma araçları: yan etkisiz; sunucuda ilgili okuma kapsamı yeterli. */
export const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Yazma araçları: yalnızca taslak oluşturur (gönderim/silme yok), sunucuda `mcp:write` kapsamı zorunlu. */
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const WRITE_NOTE =
  '[Onaylı mod — yazma] Bu araç Pushizo’da kayıt oluşturur. Yalnızca TASLAK oluşturur, hiçbir mesaj göndermez veya zamanlamaz; ' +
  'API anahtarında `mcp:write` kapsamı olmalıdır. Çağırmadan önce kullanıcıdan açık onay alın.';

export const appIdArg = z.string().min(1).max(64).optional().describe('App kimliği (app_…). App’e bağlı anahtarda veya varsayılan app tanımlıysa gerekmez.');
export const limitArg = z.number().int().min(1).max(100).optional().describe('Sayfa boyutu (varsayılan 20).');
export const cursorArg = z.string().max(500).optional().describe('Önceki yanıttaki `next_cursor` değeri.');
export const idArg = (what: string) => z.string().min(1).max(64).describe(`${what} kimliği`);
export const fromArg = z.string().max(40).optional().describe('ISO-8601 başlangıç (ör. 2026-10-01T00:00:00Z); verilmezse rapor varsayılanı.');
export const toArg = z.string().max(40).optional().describe('ISO-8601 bitiş.');
/** Segment/arama tanımı: all/any/none koşul grupları (segment taslağıyla aynı biçim). */
export const definitionArg = z
  .record(z.string(), z.unknown())
  .describe('Koşul tanımı, ör. {"all":[{"field":"tags.plan","op":"eq","value":"pro"},{"field":"last_active_at","op":"within_days","value":30}]}.');

export function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function fail(err: unknown): CallToolResult {
  const text =
    err instanceof PushizoApiError
      ? `${err.code} (HTTP ${err.status}): ${err.message}${err.status === 403 ? ' — API anahtarının kapsamlarını kontrol edin.' : ''}`
      : err instanceof Error
        ? err.message
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
    if (!id) throw new Error('app_id gerekli (anahtar organizasyon geneliyse araçta app_id verin).');
    return encodeURIComponent(id);
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

/** Yol parçası (kimlik, alias değeri) güvenli kodlama. */
export const seg = (value: string): string => encodeURIComponent(value);
