#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFetchApi } from './api.js';
import { createPushizoMcpServer } from './server.js';

/**
 * Claude Desktop için stdio MCP sunucusu. Ortam değişkenleri:
 * - `PUSHIZO_API_KEY` (zorunlu): `hs_live_…` API anahtarı (okuma kapsamları; taslak için `mcp:write`).
 * - `PUSHIZO_API_URL` (varsayılan `https://api.pushizo.com`).
 * - `PUSHIZO_APP_ID` (isteğe bağlı): araçlarda app_id verilmezse kullanılacak app.
 * - `PUSHIZO_CREDENTIALS_DIR` (isteğe bağlı): `upload_channel_credentials` aracının dosya okuyabileceği kök dizin
 *   (varsayılan: sürecin çalışma dizini). Anahtar dosyaları yalnız bu dizinin altından okunur (ADR-0097).
 * stdout yalnızca MCP iletileri içindir; tanılama stderr'e yazılır.
 */
const apiKey = process.env.PUSHIZO_API_KEY?.trim();
if (!apiKey) {
  console.error('PUSHIZO_API_KEY is not set.');
  process.exit(1);
}
const baseUrl = process.env.PUSHIZO_API_URL?.trim() || 'https://api.pushizo.com';
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseUrl)) {
  console.error('PUSHIZO_API_URL must use https (http://localhost is accepted for local development).');
  process.exit(1);
}

const server = createPushizoMcpServer({
  api: createFetchApi({ baseUrl, apiKey, userAgent: 'pushizo-mcp-stdio' }),
  defaultAppId: process.env.PUSHIZO_APP_ID?.trim() || undefined,
  local: { rootDir: process.env.PUSHIZO_CREDENTIALS_DIR?.trim() || process.cwd(), env: process.env },
});
await server.connect(new StdioServerTransport());
console.error(`Pushizo MCP server (stdio) ready: ${baseUrl}`);
