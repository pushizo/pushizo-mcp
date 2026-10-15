/**
 * MCP araçlarının HeroSignal public REST API'sine erişimi. Araçlar yalnızca bu arayüzü kullanır: yetki (API anahtarı
 * kapsamları), kiracı izolasyonu ve RLS sunucuda, her çağrıda public API ile birebir aynı biçimde uygulanır.
 */
export interface HeroSignalApi {
  request<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

/** API hata yanıtı (`{ error: { code, message } }`). */
export class HeroSignalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HeroSignalApiError';
  }
}

/** HTTP yanıtını çözer; hata gövdesini `HeroSignalApiError`'a çevirir. */
export function parseApiResponse<T>(status: number, text: string): T {
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (status >= 200 && status < 300) return json as T;
  const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
  throw new HeroSignalApiError(status, err?.code ?? `HTTP_${status}`, err?.message ?? (text.slice(0, 300) || `HTTP ${status}`));
}

export interface FetchApiOptions {
  /** API kök adresi (ör. `https://api.herosignal.io`). */
  baseUrl: string;
  /** `hs_live_…` API anahtarı (Bearer). */
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

/** stdio sunucusu için: API'ye HTTPS üzerinden Bearer anahtarla istek. */
export function createFetchApi(options: FetchApiOptions): HeroSignalApi {
  const base = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: 'application/json',
          'user-agent': options.userAgent ?? 'herosignal-mcp',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      return parseApiResponse<T>(res.status, await res.text());
    },
  };
}
