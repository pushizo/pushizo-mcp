# @herosignal/mcp-server

HeroSignal için [Model Context Protocol](https://modelcontextprotocol.io) (MCP) sunucusu. Claude Desktop gibi yapay zekâ
asistanları segment, kampanya, mesaj, şablon ve analitik verisini okuyabilir; onaylı modda yalnızca **taslak** kampanya ve
segment oluşturabilir. Gönderim, zamanlama ve silme aracı yoktur; taslaklar dashboard'dan gözden geçirilip gönderilir.
Node.js ≥ 20, ESM. Ayrıntılı rehber: [`docs/guides/mcp.md`](../../docs/guides/mcp.md).

Araçlar yalnızca HeroSignal public REST API'sini çağırır: yetki (API anahtarı kapsamları), IP izin listesi ve kiracı
izolasyonu her çağrıda public API ile birebir aynıdır.

## Kurulum (stdio)

```bash
HEROSIGNAL_API_KEY=hs_live_… npx -y @herosignal/mcp-server
```

Paket `herosignal-mcp` komutunu da sağlar (`npm install -g @herosignal/mcp-server` sonrası `herosignal-mcp`).

| Ortam değişkeni | Zorunlu | Açıklama |
|---|---|---|
| `HEROSIGNAL_API_KEY` | evet | `hs_live_…` API anahtarı. Okuma için `segments:read`, `analytics:read`; taslak araçları için ayrıca `mcp:write`. |
| `HEROSIGNAL_API_URL` | hayır | API kök adresi; varsayılan `https://api.herosignal.io`. `https` olmalı; yerel geliştirmede `http://localhost:<port>` veya `http://127.0.0.1:<port>` kabul edilir. |
| `HEROSIGNAL_APP_ID` | hayır | Araçta `app_id` verilmezse kullanılacak app. App'e bağlı anahtarda gerekmez. |

stdout yalnızca MCP iletileri içindir; tanılama ve hata metinleri stderr'e yazılır. Anahtar eksikse veya adres
geçersizse süreç 1 koduyla çıkar.

## Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "herosignal": {
      "command": "npx",
      "args": ["-y", "@herosignal/mcp-server"],
      "env": {
        "HEROSIGNAL_API_KEY": "hs_live_…",
        "HEROSIGNAL_API_URL": "https://api.herosignal.io",
        "HEROSIGNAL_APP_ID": "app_…"
      }
    }
  }
}
```

Uzak kullanım için kurulum gerekmez: HeroSignal API'si aynı araçları Streamable HTTP ile `POST {API_URL}/mcp` adresinde
sunar (API anahtarı veya OAuth 2.1; bkz. rehber).

## Araçlar

| Araç | Tür | Gerekli kapsam |
|---|---|---|
| `list_segments`, `get_segment` | okuma | `segments:read` |
| `list_campaigns`, `get_campaign`, `list_campaign_messages` | okuma | `analytics:read` |
| `get_analytics_summary`, `list_templates` | okuma | `analytics:read` |
| `list_messages`, `get_message` | okuma | `analytics:read` veya `notifications:write` |
| `create_campaign_draft` | onaylı mod — yazma | `mcp:write` |
| `create_segment_draft` | onaylı mod — yazma | `mcp:write` |

`admin` kapsamı tüm araçları açar. Yazma araçları yalnızca taslak oluşturur (kampanya her zaman `draft`, `mcp` etiketiyle;
segment dinamik) ve asistandan çağırmadan önce kullanıcının açık onayını alması istenir.

## Kütüphane olarak

```ts
import { createFetchApi, createHeroSignalMcpServer } from '@herosignal/mcp-server';

const server = createHeroSignalMcpServer({
  api: createFetchApi({ baseUrl: 'https://api.herosignal.io', apiKey: process.env.HEROSIGNAL_API_KEY! }),
  defaultAppId: process.env.HEROSIGNAL_APP_ID,
});
// server.connect(<MCP taşıması>)
```

## Depodan derleme

```bash
npm run build --workspace @herosignal/mcp-server
HEROSIGNAL_API_KEY=hs_live_… HEROSIGNAL_API_URL=http://localhost:4000 node packages/mcp-server/dist/stdio.js
npx vitest run --project unit packages/mcp-server
```

Yayın `sdk-release.yml` iş akışındaki `npm` işiyle (`sdk-vX.Y.Z` etiketi, provenance) yapılır; bkz.
[`docs/sdk/publishing.md`](../../docs/sdk/publishing.md).

## Lisans

MIT
