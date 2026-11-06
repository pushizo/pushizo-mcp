import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, appIdArg, cursorArg, idArg, limitArg, query, seg, type ToolKit } from './kit.js';

const dayArg = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD biçiminde gün verin.')
    .optional()
    .describe(what);
const isoArg = (what: string) => z.string().max(40).optional().describe(what);

const RFM_SEGMENTS = ['champions', 'loyal', 'potential', 'new', 'promising', 'need_attention', 'about_to_sleep', 'at_risk', 'cant_lose', 'hibernating', 'lost'] as const;
const RECOMMENDATION_STRATEGIES = ['personalized', 'popular', 'trending', 'similar', 'category', 'recently_viewed', 'new_arrivals'] as const;
const REPORT_SOURCES = ['deliveries', 'events', 'conversions'] as const;

/**
 * İçgörü ve yapılandırma okuma araçları (plan 15 Faz 51, ADR-0076): RFM, öngörü modelleri, özellik bayrakları, yol
 * analizi, rapor oluşturucu, karar ajanları, katalog ve öneriler, kanal skoru, bölgeler, Wallet şablonları. Hepsi
 * mevcut public API okuma uçlarını çağırır; hesap tetikleyen, karar yazan veya kart veren uçlar bilerek yoktur.
 * Wallet kartları (indirme bağlantısı taşır) araç olarak sunulmaz.
 */
export function registerInsightTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  // ---- RFM
  server.registerTool(
    'get_rfm_overview',
    {
      title: 'RFM özeti',
      description: 'RFM segmentlerinin (champions, at_risk, lost…) kullanıcı sayıları, payları ve son hesap zamanı. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/overview`),
  );
  server.registerTool(
    'get_rfm_transitions',
    {
      title: 'RFM segment geçişleri',
      description: 'İki gün arasında kullanıcıların hangi RFM segmentinden hangisine geçtiği (varsayılan son 30 gün). Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, from: dayArg('Başlangıç günü (YYYY-MM-DD); boşsa 30 gün önce.'), to: dayArg('Bitiş günü (YYYY-MM-DD); boşsa bugün.') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/transitions${query({ from: a.from, to: a.to })}`),
  );
  server.registerTool(
    'list_rfm_users',
    {
      title: 'RFM segmentindeki kullanıcılar',
      description: 'Bir RFM segmentindeki kullanıcılar ve R/F/M skorları. Devamı için yanıttaki `next_cursor` değerini `cursor` olarak verin. Gerekli kapsam: users:read.',
      inputSchema: { app_id: appIdArg, segment: z.enum(RFM_SEGMENTS).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/rfm/users${query({ segment: a.segment, limit: a.limit, cursor: a.cursor })}`),
  );

  // ---- öngörü modelleri
  server.registerTool(
    'list_predictions',
    {
      title: 'Öngörü modelleri',
      description: 'Kayıp riski ve olay olasılığı modelleri: durum, kalite ölçümü ve son eğitim zamanı. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions`),
  );
  server.registerTool(
    'get_prediction',
    {
      title: 'Öngörü modeli',
      description: 'Tek modelin ayrıntısı: tanım, kalite (AUC, isabet), skor dağılımı. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, prediction_id: idArg('Öngörü modeli') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions/${seg(a.prediction_id)}`),
  );
  server.registerTool(
    'list_prediction_users',
    {
      title: 'Öngörü skoruna göre kullanıcılar',
      description: 'Modelin skorladığı kullanıcılar; `bucket` ile düşük/orta/yüksek olasılık grubu seçilir. Devamı için `next_cursor`. Gerekli kapsam: users:read.',
      inputSchema: { app_id: appIdArg, prediction_id: idArg('Öngörü modeli'), bucket: z.enum(['low', 'medium', 'high']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/predictions/${seg(a.prediction_id)}/users${query({ bucket: a.bucket, limit: a.limit, cursor: a.cursor })}`),
  );

  // ---- özellik bayrakları
  server.registerTool(
    'list_feature_flags',
    {
      title: 'Özellik bayrakları',
      description: 'Özellik bayrakları: durum, yayın yüzdesi, hedef segment ve uzaktan yapılandırma değerleri. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/feature-flags`),
  );
  server.registerTool(
    'get_feature_flag',
    {
      title: 'Özellik bayrağı',
      description: 'Tek bayrağın ayrıntısı: kademeli yayın takvimi, hedefleme ve değerler. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, flag_id: idArg('Bayrak') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/feature-flags/${seg(a.flag_id)}`),
  );

  // ---- analitik: yol analizi ve rapor oluşturucu
  server.registerTool(
    'run_path_analysis',
    {
      title: 'Kullanıcı yol analizi',
      description:
        'Bir olaydan sonra (`after`) veya olaya gelmeden önce (`before`) kullanıcıların izlediği olay yolları ve en sık yollar. Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        event: z.string().min(1).max(100).describe('Başlangıç olayı, ör. `add_to_cart`.'),
        direction: z.enum(['after', 'before']).optional(),
        depth: z.number().int().min(1).max(5).optional().describe('İzlenecek adım sayısı (varsayılan 3).'),
        top: z.number().int().min(2).max(10).optional().describe('Adım başına ayrı gösterilecek olay sayısı (varsayılan 5).'),
        window_hours: z.number().int().min(1).max(720).optional().describe('Başlangıç olayından en fazla uzaklık (saat, varsayılan 24).'),
        exclude: z.array(z.string().min(1).max(100)).max(20).optional().describe('Yolda sayılmayacak olaylar.'),
        from: isoArg('ISO-8601 başlangıç.'),
        to: isoArg('ISO-8601 bitiş.'),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/paths`, {
        event: a.event,
        ...(a.direction ? { direction: a.direction } : {}),
        ...(a.depth ? { depth: a.depth } : {}),
        ...(a.top ? { top: a.top } : {}),
        ...(a.window_hours ? { window_hours: a.window_hours } : {}),
        ...(a.exclude?.length ? { exclude: a.exclude } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
      }),
  );
  server.registerTool(
    'run_report',
    {
      title: 'Rapor çalıştır',
      description:
        'Serbest rapor: kaynak, metrik, kırılım ve filtre seçilir. Kaynaklar ve alanları — deliveries: sent, delivered, failed, opened, clicked, ' +
        'delivery_rate, open_rate, click_rate, failure_rate; kırılım day/week/month/channel/provider/campaign/status. events: count, unique_users, ' +
        'value_sum, value_avg; kırılım day/week/month/name/source. conversions: conversions, revenue, unique_users; kırılım day/week/month/campaign/' +
        'event_name/kind. `days` ile `from`/`to` birlikte verilmez. Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        source: z.enum(REPORT_SOURCES),
        metrics: z.array(z.string().min(1).max(32)).min(1).max(8),
        dimensions: z.array(z.string().min(1).max(32)).max(2).optional(),
        filters: z.record(z.string().max(32), z.array(z.string().min(1).max(200)).min(1).max(50)).optional().describe('ör. {"channel":["email","sms"]}'),
        sort: z.object({ by: z.string().max(64), direction: z.enum(['asc', 'desc']).optional() }).optional(),
        limit: z.number().int().min(1).max(1000).optional().describe('Satır sınırı (varsayılan 100).'),
        days: z.number().int().min(1).max(730).optional().describe('Son kaç gün.'),
        from: isoArg('ISO-8601 başlangıç.'),
        to: isoArg('ISO-8601 bitiş.'),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/reports/run`, {
        source: a.source,
        metrics: a.metrics,
        ...(a.dimensions?.length ? { dimensions: a.dimensions } : {}),
        ...(a.filters ? { filters: a.filters } : {}),
        ...(a.sort ? { sort: a.sort } : {}),
        ...(a.limit ? { limit: a.limit } : {}),
        ...(a.days ? { days: a.days } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        format: 'json',
      }),
  );
  server.registerTool(
    'list_saved_reports',
    {
      title: 'Kayıtlı raporlar',
      description: 'Panelde kaydedilmiş rapor tanımları. Tanımı `run_report` ile çalıştırabilirsiniz. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/reports`),
  );
  server.registerTool(
    'get_saved_report',
    {
      title: 'Kayıtlı rapor',
      description: 'Kayıtlı raporun tanımı (kaynak, metrikler, kırılımlar, filtreler). Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, report_id: idArg('Rapor') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/reports/${seg(a.report_id)}`),
  );

  // ---- karar ajanları
  server.registerTool(
    'list_decision_agents',
    {
      title: 'Karar ajanları',
      description: 'Kişi başına en iyi seçeneği öğrenen karar ajanları: durum, seçenekler ve hedef. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/decision-agents`),
  );
  server.registerTool(
    'get_decision_agent_report',
    {
      title: 'Karar ajanı raporu',
      description: 'Ajanın seçenek başına atama ve ödül sayıları ile kontrol grubuna karşı kazancı. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, agent_id: idArg('Karar ajanı') },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/decision-agents/${seg(a.agent_id)}/report`),
  );

  // ---- katalog ve öneriler
  server.registerTool(
    'list_catalogs',
    {
      title: 'Ürün katalogları',
      description: 'Ürün katalogları (ad, para birimi, ürün sayısı). Öneri araçları için `catalog_id` buradan alınır. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/catalogs`),
  );
  server.registerTool(
    'get_recommendations',
    {
      title: 'Ürün önerileri',
      description:
        'Katalogdan ürün önerileri. Stratejiler: personalized ve recently_viewed kullanıcı ister (`user_id` ya da `external_id`, ikisi birlikte verilmez); ' +
        'similar `item_id`, category `category` ister; popular, trending ve new_arrivals girdisizdir. Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        catalog_id: idArg('Katalog'),
        strategy: z.enum(RECOMMENDATION_STRATEGIES),
        limit: z.number().int().min(1).max(20).optional(),
        user_id: z.string().max(64).optional(),
        external_id: z.string().max(255).optional(),
        item_id: z.string().max(128).optional(),
        category: z.string().max(200).optional(),
      },
      annotations: READ,
    },
    async (a) =>
      get(
        `/v1/apps/${app(a.app_id)}/catalogs/${seg(a.catalog_id)}/recommendations${query({
          strategy: a.strategy,
          limit: a.limit,
          user_id: a.user_id,
          external_id: a.external_id,
          item_id: a.item_id,
          category: a.category,
        })}`,
      ),
  );

  // ---- kanal skoru
  server.registerTool(
    'get_channel_score_overview',
    {
      title: 'En iyi kanal özeti',
      description: 'Kullanıcıların en iyi kanala göre dağılımı (push, e-posta, SMS…) ve son hesap zamanı. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/channel-scores/overview`),
  );

  // ---- bölgeler
  server.registerTool(
    'list_geofences',
    {
      title: 'Bölgeler (geofence)',
      description: 'Tanımlı bölgeler: ad, merkez, yarıçap ve durum. Kullanıcı konumu içermez. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/geofences`),
  );

  // ---- Wallet
  server.registerTool(
    'list_wallet_templates',
    {
      title: 'Wallet şablonları',
      description: 'Apple ve Google Wallet kart şablonları (kupon, sadakat kartı, bilet) ve verilmiş kart sayıları. Kartların kendisi ve indirme bağlantıları dönmez. Gerekli kapsam: users:read.',
      inputSchema: { app_id: appIdArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/wallet/templates`),
  );
}
