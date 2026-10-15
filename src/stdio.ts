#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFetchApi } from './api.js';
import { createHeroSignalMcpServer } from './server.js';

/**
 * Claude Desktop için stdio MCP sunucusu. Ortam değişkenleri:
 * - `HEROSIGNAL_API_KEY` (zorunlu): `hs_live_…` API anahtarı (okuma kapsamları; taslak için `mcp:write`).
 * - `HEROSIGNAL_API_URL` (varsayılan `https://api.herosignal.io`).
 * - `HEROSIGNAL_APP_ID` (isteğe bağlı): araçlarda app_id verilmezse kullanılacak app.
 * stdout yalnızca MCP iletileri içindir; tanılama stderr'e yazılır.
 */
const apiKey = process.env.HEROSIGNAL_API_KEY?.trim();
if (!apiKey) {
  console.error('HEROSIGNAL_API_KEY tanımlı değil.');
  process.exit(1);
}
const baseUrl = process.env.HEROSIGNAL_API_URL?.trim() || 'https://api.herosignal.io';
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseUrl)) {
  console.error('HEROSIGNAL_API_URL https olmalı (yerel geliştirmede http://localhost kabul edilir).');
  process.exit(1);
}

const server = createHeroSignalMcpServer({
  api: createFetchApi({ baseUrl, apiKey, userAgent: 'herosignal-mcp-stdio' }),
  defaultAppId: process.env.HEROSIGNAL_APP_ID?.trim() || undefined,
});
await server.connect(new StdioServerTransport());
console.error(`HeroSignal MCP sunucusu (stdio) hazır: ${baseUrl}`);
