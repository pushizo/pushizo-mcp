<!-- pushizo:header -->
<p align="center">
  <a href="https://pushizo.com"><img src="https://raw.githubusercontent.com/pushizo/.github/main/profile/assets/mark.svg" alt="Pushizo" width="56" height="56"></a>
</p>
<p align="center">
  <a href="https://docs.pushizo.com/docs/integrations/mcp"><img src="https://img.shields.io/badge/docs-docs.pushizo.com-5b4bdb" alt="Docs"></a>
  <a href="https://docs.pushizo.com/docs/api"><img src="https://img.shields.io/badge/API-reference-b44fc4" alt="API reference"></a>
  <a href="https://github.com/pushizo/pushizo-mcp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-16130f" alt="License: MIT"></a>
</p>
<p align="center"><a href="#english">English</a> · <a href="#türkçe">Türkçe</a></p>

## English

**Pushizo MCP server** — Model Context Protocol server for Pushizo. AI clients such as Claude, Cursor and VS Code can read segments, campaigns, messages, templates and analytics, and create draft campaigns and segments with explicit approval. There are no send, schedule or delete tools. The remote server works without installation (OAuth 2.1); the local server runs over stdio.

```bash
# Remote server (no install)
claude mcp add --transport http pushizo https://api.pushizo.com/mcp

# Local server (stdio)
PUSHIZO_API_KEY=hs_live_… npx -y @pushizo/mcp-server
```

The detailed guide below is in Turkish; code samples are language-neutral. Full documentation:
[docs.pushizo.com/docs/integrations/mcp](https://docs.pushizo.com/docs/integrations/mcp) · API reference: [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api).

## Türkçe
<!-- /pushizo:header -->

# Pushizo MCP sunucusu

Pushizo için [Model Context Protocol](https://modelcontextprotocol.io) (MCP) sunucusu. Claude, Cursor, VS Code gibi
yapay zekâ istemcileri segment, kampanya, mesaj, şablon ve analitik verisini okuyabilir; onaylı modda yalnızca
**taslak** kampanya ve segment oluşturabilir. Gönderim, zamanlama ve silme aracı yoktur; taslaklar panelden gözden
geçirilip gönderilir.

Araçlar yalnızca Pushizo public REST API'sini çağırır: yetki (API anahtarı kapsamları), IP izin listesi ve kiracı
izolasyonu her çağrıda public API ile birebir aynıdır. Ayrıntılı rehber:
[docs.pushizo.com/docs/integrations/mcp](https://docs.pushizo.com/docs/integrations/mcp).

| Bağlantı | Ne zaman | Kimlik |
|----------|----------|--------|
| **Uzak sunucu** `https://api.pushizo.com/mcp` (Streamable HTTP) | Kurulum istemeyen istemciler (Claude.ai, Claude Desktop bağlayıcısı, Claude Code, Cursor, VS Code) | OAuth 2.1 (tarayıcıda onay) ya da kapsamlı API anahtarı |
| **Yerel sunucu** `npx -y @pushizo/mcp-server` (stdio) | Yerel çalıştırmak ya da kendi kodunuza gömmek | `PUSHIZO_API_KEY` |

## Uzak sunucu (kurulumsuz)

**Claude.ai / Claude Desktop:** Settings → Connectors → **Add custom connector** → URL: `https://api.pushizo.com/mcp`.
Claude tarayıcıda Pushizo yetkilendirme ekranını açar; onayladığınız organizasyon, app ve kapsamlarla çalışır.

**Claude Code:**

```bash
claude mcp add --transport http pushizo https://api.pushizo.com/mcp
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pushizo": { "url": "https://api.pushizo.com/mcp" }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "pushizo": { "type": "http", "url": "https://api.pushizo.com/mcp" }
  }
}
```

OAuth desteklemeyen istemcilerde `Authorization: Bearer hs_live_…` başlığıyla kapsamlı bir API anahtarı verilebilir:

```bash
curl -s -X POST https://api.pushizo.com/mcp   -H "Authorization: Bearer $PUSHIZO_API_KEY"   -H 'content-type: application/json'   -H 'accept: application/json, text/event-stream'   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Yerel sunucu (stdio)

```bash
PUSHIZO_API_KEY=hs_live_… npx -y @pushizo/mcp-server
```

Paket `pushizo-mcp` komutunu da sağlar (`npm install -g @pushizo/mcp-server` sonrası `pushizo-mcp`).

| Ortam değişkeni | Zorunlu | Açıklama |
|---|---|---|
| `PUSHIZO_API_KEY` | evet | `hs_live_…` API anahtarı. Okuma için `segments:read`, `analytics:read`; kullanıcı araçları için `users:read`; taslak ve test gönderimi için `mcp:write`. |
| `PUSHIZO_API_URL` | hayır | API kök adresi; varsayılan `https://api.pushizo.com`. `https` olmalı; yerel geliştirmede `http://localhost:<port>` veya `http://127.0.0.1:<port>` kabul edilir. |
| `PUSHIZO_APP_ID` | hayır | Araçta `app_id` verilmezse kullanılacak app. App'e bağlı anahtarda gerekmez. |

stdout yalnızca MCP iletileri içindir; tanılama ve hata metinleri stderr'e yazılır. Anahtar eksikse veya adres
geçersizse süreç 1 koduyla çıkar.

## Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "pushizo": {
      "command": "npx",
      "args": ["-y", "@pushizo/mcp-server"],
      "env": {
        "PUSHIZO_API_KEY": "hs_live_…",
        "PUSHIZO_API_URL": "https://api.pushizo.com",
        "PUSHIZO_APP_ID": "app_…"
      }
    }
  }
}
```

## Araçlar

228 araç (218 okuma, 9 taslak, test gönderimi); public API'deki her okuma ucunun bir aracı vardır. Ayrıntılı liste
`docs/guides/mcp.md` içindedir. Özet:

| Araç | Tür | Gerekli kapsam |
|---|---|---|
| `list_segments`, `get_segment`, `preview_segment`, `estimate_segment`, `list_segment_campaigns` | okuma | `segments:read` |
| Kampanya, şablon, journey, analitik, in-app, web büyüme ve gelen kutusu okuma araçları | okuma | `analytics:read` |
| RFM, öngörü, karar ajanı, kanal skoru, özellik bayrağı, rapor, yol analizi, katalog ve öneri, bölge araçları | okuma | `analytics:read` |
| `list_messages`, `get_message` | okuma | `analytics:read` veya `notifications:write` |
| `get_app`, `search_users`, `get_user`, `get_user_journeys`, `get_user_preferences`, `list_categories`, `list_rfm_users`, `list_prediction_users`, `list_wallet_templates` | okuma | `users:read` |
| Şirket, ilgi etiketleri, SQL sorgu (`run_sql_query`, yalnız SELECT), veri boru hattı, ambar segmenti, konuşma ve AI ajanı, özel AI ajanları, web kişiselleştirme, site içi arama, reklam, kaldırma ve Android teslimat raporu okuma araçları | okuma | `users:read`, `analytics:read`, `segments:read` veya `admin` (araca göre) |
| `create_campaign_draft`, `create_segment_draft`, `create_template_draft`, `create_journey_draft`, `create_in_app_draft`, `create_web_campaign_draft`, `create_web_personalization_draft`, `create_survey_draft`, `create_landing_page_draft` | onaylı mod — taslak | `mcp:write` |
| `send_test_notification` | onaylı mod — yalnız test cihazı | `mcp:write` |

`admin` kapsamı tüm araçları açar. Taslak araçları gönderim, zamanlama ve yayın yapmaz (kampanya, journey, in-app, web kampanyası, web kişiselleştirme, anket ve landing
`draft`, şablon ve kampanyaya `mcp` etiketi, segment dinamik). `send_test_notification` gerçek kitleye gidemez.
Asistandan çağırmadan önce kullanıcının açık onayı istenir.

## Kütüphane olarak

```ts
import { createFetchApi, createPushizoMcpServer } from '@pushizo/mcp-server';

const server = createPushizoMcpServer({
  api: createFetchApi({ baseUrl: 'https://api.pushizo.com', apiKey: process.env.PUSHIZO_API_KEY! }),
  defaultAppId: process.env.PUSHIZO_APP_ID,
});
// server.connect(<MCP taşıması>)
```

## Geliştirme

Paket Pushizo ana deposunda geliştirilir ve test edilir; bu depo her sürümde oradan otomatik yansıtılır. Kullanmak
için npm paketini (`@pushizo/mcp-server`) ya da uzak sunucuyu tercih edin.

<!-- pushizo:footer -->
---

## Support · Destek

- **Guide · Rehber:** [docs.pushizo.com/docs/integrations/mcp](https://docs.pushizo.com/docs/integrations/mcp)
- **API reference & OpenAPI · API referansı ve OpenAPI:** [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api) ·
  [pushizo-openapi](https://github.com/pushizo/pushizo-openapi)
- **Bugs & ideas · Hata ve öneri:** [Issues](https://github.com/pushizo/pushizo-mcp/issues)
- **Security · Güvenlik:** please do not open public issues; email [security@pushizo.com](mailto:security@pushizo.com) ·
  herkese açık issue açmayın, bu adrese yazın.
- **Help · Destek:** [support@pushizo.com](mailto:support@pushizo.com)

This repository is mirrored automatically from the Pushizo main repository on every release. Please open an issue
instead of a pull request; fixes land in the main repository and ship with the next release.
Bu depo her sürümde Pushizo ana deposundan otomatik yansıtılır. Pull request yerine issue açın; düzeltmeler ana depoda
yapılır ve bir sonraki sürümle buraya gelir.

Released under the MIT License · MIT lisanslıdır — [LICENSE](https://github.com/pushizo/pushizo-mcp/blob/main/LICENSE).
<!-- /pushizo:footer -->
