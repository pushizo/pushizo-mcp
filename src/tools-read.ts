import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ, appIdArg, cursorArg, definitionArg, fromArg, idArg, limitArg, query, seg, toArg, type ToolKit } from './kit.js';

const aliasArgs = {
  label: z.string().min(1).max(64).describe('Kimlik etiketi: `external_id`, `pushizo_id` ya da tanımlı alias (ör. `crm_id`).'),
  value: z.string().min(1).max(255).describe('Etiketin değeri (ör. external_id değeri).'),
};
const compareArg = z.boolean().optional().describe('true: önceki eşit uzunluktaki dönemle karşılaştırma ekler.');

/**
 * Genişletilmiş okuma araçları (ADR-0043): app, segment, kampanya istatistiği, şablon, journey, kullanıcı, olay,
 * analitik raporları, in-app ve web büyüme araçları. Hepsi mevcut public API uçlarını çağırır; yetki her çağrıda API
 * anahtarının kapsamıyla sunucuda denetlenir (araç açıklamasında gereken kapsam yazılıdır).
 */
export function registerReadTools(server: McpServer, kit: ToolKit): void {
  const { api, app, run } = kit;
  const get = (path: string) => run(() => api.request('GET', path));
  const post = (path: string, body: unknown) => run(() => api.request('POST', path, body));

  // ---- app ve organizasyon
  server.registerTool(
    'get_app',
    { title: 'App bilgisi', description: 'App ayarları: ad, platformlar, varsayılan dil, saat dilimi. Gerekli kapsam: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}`),
  );
  server.registerTool(
    'get_organization_usage',
    {
      title: 'Organizasyon kullanımı',
      description: 'Plan kotaları, bu ayki kullanım ve aşım tahmini (yalnızca organizasyon geneli anahtar). Gerekli kapsam: analytics:read.',
      inputSchema: { days: z.number().int().min(7).max(90).optional().describe('Günlük seri uzunluğu (7–90, varsayılan 30).') },
      annotations: READ,
    },
    async (a) => get(`/v1/organization/usage${query({ days: a.days })}`),
  );

  // ---- segmentler
  server.registerTool(
    'preview_segment',
    {
      title: 'Segment önizleme',
      description: 'Kaydedilmemiş bir tanımın kitle sayısı ve örnek kullanıcıları (segment oluşturmadan). Gerekli kapsam: segments:read.',
      inputSchema: { app_id: appIdArg, definition: definitionArg, limit: z.number().int().min(1).max(50).optional().describe('Örnek kullanıcı sayısı.') },
      annotations: READ,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/segments/preview`, { definition: a.definition, ...(a.limit ? { limit: a.limit } : {}) }),
  );
  server.registerTool(
    'estimate_segment',
    { title: 'Segment kitle tahmini', description: 'Kayıtlı segmentin güncel kitle ve kanal bazında abonelik tahmini. Gerekli kapsam: segments:read.', inputSchema: { app_id: appIdArg, segment_id: idArg('Segment') }, annotations: READ },
    async (a) => post(`/v1/apps/${app(a.app_id)}/segments/${seg(a.segment_id)}/estimate`, {}),
  );
  server.registerTool(
    'list_segment_campaigns',
    { title: 'Segmenti kullanan kampanyalar', description: 'Segmenti dahil veya hariç tutan kampanyalar. Gerekli kapsam: segments:read.', inputSchema: { app_id: appIdArg, segment_id: idArg('Segment') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/segments/${seg(a.segment_id)}/campaigns`),
  );

  // ---- kampanya istatistikleri
  server.registerTool(
    'get_campaign_stats',
    { title: 'Kampanya istatistikleri', description: 'Gönderim, teslim, açılma, tıklama, dönüşüm ve kanal kırılımı. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Kampanya') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}/stats`),
  );
  server.registerTool(
    'get_campaign_variant_stats',
    { title: 'A/B varyant istatistikleri', description: 'Kampanya varyantlarının metrikleri ve anlamlılık (z-testi) sonucu. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Kampanya') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/campaigns/${seg(a.campaign_id)}/variants/stats`),
  );

  // ---- şablonlar
  server.registerTool(
    'get_template',
    { title: 'Şablon oku', description: 'Şablon içeriği (dillere göre başlık/metin, e-posta, SMS…). Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Şablon') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}`),
  );
  server.registerTool(
    'get_template_stats',
    { title: 'Şablon performansı', description: 'Şablonu kullanan mesajların toplu metrikleri. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Şablon') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/stats`),
  );
  server.registerTool(
    'list_template_versions',
    { title: 'Şablon sürümleri', description: 'Şablonun kayıtlı sürüm geçmişi. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, template_id: idArg('Şablon') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/versions`),
  );
  server.registerTool(
    'render_template',
    {
      title: 'Şablon önizleme',
      description: 'Şablonu Liquid değişkenleriyle işler (gönderim yapmaz): örnek kullanıcı tag/özellikleri ve dil ile son hali. Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        template_id: idArg('Şablon'),
        channel: z.string().max(32).optional().describe('ör. ios_push, android_push, web_push, email, sms'),
        language: z.string().min(2).max(10).optional(),
        user: z.record(z.string(), z.unknown()).optional().describe('{"external_id":"u1","tags":{"plan":"pro"},"properties":{…}}'),
        custom_data: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/templates/${seg(a.template_id)}/render`, {
        ...(a.channel ? { channel: a.channel } : {}),
        ...(a.language ? { language: a.language } : {}),
        ...(a.user ? { user: a.user } : {}),
        ...(a.custom_data ? { custom_data: a.custom_data } : {}),
      }),
  );

  // ---- journey'ler
  server.registerTool(
    'list_journeys',
    {
      title: 'Journey’leri listele',
      description: 'Otomasyon akışları (durum ve ad filtresi). Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), q: z.string().max(100).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys${query({ status: a.status, q: a.q, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_journey',
    { title: 'Journey oku', description: 'Journey grafiği (düğümler, kenarlar), giriş/çıkış kuralları ve yayın durumu. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, journey_id: idArg('Journey') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}`),
  );
  server.registerTool(
    'get_journey_stats',
    {
      title: 'Journey istatistikleri',
      description: 'Düğüm bazında giriş/çıkış, bekleyen, hedefe ulaşan ve mesaj metrikleri. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, journey_id: idArg('Journey'), version: z.number().int().min(1).optional(), all_versions: z.boolean().optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/stats${query({ version: a.version, all_versions: a.all_versions })}`),
  );
  server.registerTool(
    'list_journey_runs',
    {
      title: 'Journey çalıştırmaları',
      description: 'Kullanıcı bazında journey çalıştırmaları (durum, kullanıcı, sürüm filtresi). Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        journey_id: idArg('Journey'),
        status: z.enum(['active', 'waiting', 'completed', 'exited', 'failed']).optional(),
        user_id: z.string().max(64).optional(),
        version: z.number().int().min(1).optional(),
        limit: limitArg,
        cursor: cursorArg,
      },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/runs${query({ status: a.status, user_id: a.user_id, version: a.version, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_journey_run',
    { title: 'Journey çalıştırması', description: 'Tek çalıştırmanın adım adım zaman çizelgesi. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, journey_id: idArg('Journey'), run_id: idArg('Çalıştırma') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/journeys/${seg(a.journey_id)}/runs/${seg(a.run_id)}`),
  );

  // ---- kullanıcılar
  server.registerTool(
    'search_users',
    {
      title: 'Kullanıcı ara',
      description: 'Koşullara uyan kullanıcılar (segment tanımıyla aynı biçim; sayfalı). Kişisel veri içerir, yalnızca gereken kadar isteyin. Gerekli kapsam: users:read.',
      inputSchema: { app_id: appIdArg, definition: definitionArg, limit: z.number().int().min(1).max(200).optional(), cursor: cursorArg },
      annotations: READ,
    },
    async (a) => post(`/v1/apps/${app(a.app_id)}/users/search`, { definition: a.definition, ...(a.limit ? { limit: a.limit } : {}), ...(a.cursor ? { cursor: a.cursor } : {}) }),
  );
  server.registerTool(
    'get_user',
    { title: 'Kullanıcı oku', description: 'Kullanıcının kimlikleri, tag’leri, özellikleri ve abonelikleri. Gerekli kapsam: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}`),
  );
  server.registerTool(
    'get_user_journeys',
    { title: 'Kullanıcının journey’leri', description: 'Kullanıcının içinde bulunduğu ve tamamladığı journey çalıştırmaları. Gerekli kapsam: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/journeys`),
  );
  server.registerTool(
    'get_user_preferences',
    { title: 'Kullanıcı tercihleri', description: 'Kategori ve kanal bazında abonelik tercihleri. Gerekli kapsam: users:read.', inputSchema: { app_id: appIdArg, ...aliasArgs }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/users/by/${seg(a.label)}/${seg(a.value)}/preferences`),
  );
  server.registerTool(
    'list_categories',
    { title: 'Mesaj kategorileri', description: 'Tercih merkezindeki mesaj kategorileri (varsayılan açık/kapalı, kanallar). Gerekli kapsam: users:read.', inputSchema: { app_id: appIdArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/categories`),
  );

  // ---- olaylar
  server.registerTool(
    'list_event_definitions',
    { title: 'Özel olaylar', description: 'App’te görülen özel olay adları, sayıları ve özellik şemaları. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, limit: z.number().int().min(1).max(500).optional(), cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/events/definitions${query({ limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_event_definition',
    { title: 'Olay tanımı', description: 'Tek olayın özellikleri, ilk/son görülme ve hacmi. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, name: z.string().min(1).max(100) }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/events/definitions/${seg(a.name)}`),
  );

  // ---- analitik raporları
  server.registerTool(
    'get_message_report',
    {
      title: 'Teslimat raporu',
      description: 'Gönderim/teslim/açılma/tıklama/başarısızlık; güne, kanala veya kampanyaya göre. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, group_by: z.enum(['day', 'channel', 'campaign']).optional(), compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/messages${query({ from: a.from, to: a.to, group_by: a.group_by, compare: a.compare })}`),
  );
  server.registerTool(
    'get_subscription_report',
    { title: 'Abonelik raporu', description: 'Kanal bazında yeni, iptal ve net abonelik eğilimi. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, compare: compareArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/subscriptions${query({ from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'get_event_report',
    {
      title: 'Olay raporu',
      description: 'Özel olay hacmi; güne veya olay adına göre. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, name: z.string().min(1).max(100).optional(), group_by: z.enum(['day', 'name']).optional(), from: fromArg, to: toArg, compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/events${query({ name: a.name, group_by: a.group_by, from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'get_conversion_report',
    {
      title: 'Dönüşüm raporu',
      description: 'Mesajlara atfedilen dönüşümler ve gelir (kanallar arası son temas). Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, campaign_id: z.string().max(64).optional(), from: fromArg, to: toArg, compare: compareArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/conversions${query({ campaign_id: a.campaign_id, from: a.from, to: a.to, compare: a.compare })}`),
  );
  server.registerTool(
    'run_funnel',
    {
      title: 'Funnel analizi',
      description: 'Sıralı olay adımlarında dönüşüm ve kayıp (2–8 adım, adımlar arası en çok `window_hours`). Gerekli kapsam: analytics:read.',
      inputSchema: {
        app_id: appIdArg,
        steps: z
          .array(z.object({ name: z.string().min(1).max(100), where: z.object({ key: z.string().min(1).max(64), value: z.string().max(500) }).optional() }))
          .min(2)
          .max(8),
        from: fromArg,
        to: toArg,
        window_hours: z.number().int().min(1).max(720).optional(),
        compare: z.boolean().optional(),
      },
      annotations: READ,
    },
    async (a) =>
      post(`/v1/apps/${app(a.app_id)}/analytics/funnels`, {
        steps: a.steps,
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        ...(a.window_hours ? { window_hours: a.window_hours } : {}),
        ...(a.compare !== undefined ? { compare: a.compare } : {}),
      }),
  );
  server.registerTool(
    'get_retention_report',
    { title: 'Elde tutma (retention)', description: 'Haftalık kohort elde tutma tablosu. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, weeks: z.number().int().min(2).max(26).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/retention${query({ weeks: a.weeks })}`),
  );
  server.registerTool(
    'get_engagement_heatmap',
    { title: 'Etkileşim ısı haritası', description: 'Gün × saat açılma/tıklama yoğunluğu (en iyi gönderim zamanı için). Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/engagement${query({ from: a.from, to: a.to })}`),
  );
  server.registerTool(
    'get_provider_report',
    { title: 'Sağlayıcı raporu', description: 'APNs/FCM/HMS/e-posta/SMS sağlayıcı başarı ve hata kodu dağılımı. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, from: fromArg, to: toArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/analytics/providers${query({ from: a.from, to: a.to })}`),
  );

  // ---- in-app
  server.registerTool(
    'list_in_app_messages',
    {
      title: 'In-app mesajlar',
      description: 'In-app mesajlar (durum filtresi) ve gösterim/tıklama sayaçları. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/in-app-messages${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_in_app_message',
    { title: 'In-app mesaj oku', description: 'Tetikler, görünüm, kitle, sıklık ve istatistikler. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, message_id: idArg('In-app mesaj') }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/in-app-messages/${seg(a.message_id)}`),
  );

  // ---- web büyüme ve gelen kutusu
  server.registerTool(
    'list_web_campaigns',
    {
      title: 'Web kampanyaları',
      description: 'Pop-up, banner ve slide-in kampanyaları. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), limit: limitArg, cursor: cursorArg },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/web-campaigns${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_web_campaign_report',
    { title: 'Web kampanyası raporu', description: 'Gösterim, tıklama, kapatma ve dönüşüm. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, campaign_id: idArg('Web kampanyası'), days: z.number().int().min(1).max(365).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/web-campaigns/${seg(a.campaign_id)}/report${query({ days: a.days })}`),
  );
  server.registerTool(
    'list_forms',
    { title: 'Formlar', description: 'Web formları ve gönderim sayıları. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, status: z.enum(['active', 'archived']).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/forms${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'list_surveys',
    { title: 'Anketler', description: 'Anketler ve NPS. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, status: z.enum(['draft', 'active', 'closed']).optional(), limit: limitArg, cursor: cursorArg }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/surveys${query({ status: a.status, limit: a.limit, cursor: a.cursor })}`),
  );
  server.registerTool(
    'get_survey_report',
    { title: 'Anket raporu', description: 'Soru bazında yanıt dağılımı ve NPS skoru. Gerekli kapsam: analytics:read.', inputSchema: { app_id: appIdArg, survey_id: idArg('Anket'), days: z.number().int().min(1).max(365).optional() }, annotations: READ },
    async (a) => get(`/v1/apps/${app(a.app_id)}/surveys/${seg(a.survey_id)}/report${query({ days: a.days })}`),
  );
  server.registerTool(
    'get_inbox_metrics',
    {
      title: 'Gelen kutusu metrikleri',
      description: 'Canlı sohbet ve birleşik gelen kutusu: konuşma hacmi, ilk yanıt ve çözüm süreleri. Gerekli kapsam: analytics:read.',
      inputSchema: { app_id: appIdArg, from: fromArg, to: toArg, channel: z.enum(['sms', 'whatsapp', 'rcs', 'email', 'chat']).optional() },
      annotations: READ,
    },
    async (a) => get(`/v1/apps/${app(a.app_id)}/inbox/metrics${query({ from: a.from, to: a.to, channel: a.channel })}`),
  );
}
