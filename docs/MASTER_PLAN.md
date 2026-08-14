# AI Agent Workspace / Mission Control — Product + Technical + Development Master Plan

> **Rol:** Chief Architect / Principal Engineer perspektifi
> **Durum:** Plan dokümanı (kod yok). Bağımsız bir AI/insan tarafından incelenebilecek şekilde yazıldı.

---

## 0. Yönetici Özeti ve Temel Varsayımlar

**Tek cümlelik ürün tanımı:** Birden fazla AI modelinden oluşan bir "AI ekibini" gerçek bir yazılım projesi üzerinde görevlendiren, çalışmalarını izlenebilir kılan ve hata durumunda **açıkla → düzelt → tekrar test et** döngüsünü yöneten bir Mission Control platformu.

**Erken ve dürüst tespit (pushback):** "Birden fazla modeli tek yerde kullan" değeri sıfıra yakın — OpenRouter, TypingMind, LibreChat bunu zaten yapıyor ve komodite. "Agent'lar kod yazsın, test etsin, düzeltsin" değeri ise tekil-model ürünlerde (Claude Code, Cursor, Devin, Copilot coding agent, OpenHands) hızla standartlaşıyor. Bu ürünün savunulabilir tek konumu, ikisinin kesişimi değil; **orkestrasyon + gözlemlenebilirlik + kurtarma (recovery) deneyiminin kendisi**dir: "AI ekibim ne yapıyor, nerede takıldı, neden takıldı, düzeltme denemesi ne durumda" sorusuna tek bakışta cevap veren ürün. Multi-model olmak bir *moat* değil, bir *hijyen faktörü* ve maliyet/kalite optimizasyon aracıdır. Bu plan bu varsayım üzerine kuruludur.

**Ana varsayımlar (açıkça):**

| # | Varsayım | Güven | Yanlışsa etkisi |
|---|---|---|---|
| V1 | Builder segmenti (vibe coder / indie dev) çoklu-AI kullanıyor ve koordinasyon acısı yaşıyor | Orta | Ürünün çekirdek talebi zayıflar; tek-model derinliğine dönülür |
| V2 | Kullanıcılar agent sürecini "izlemek" istiyor, sadece sonucu değil | Orta-Yüksek | Timeline yatırımı boşa gider; ürün bir CI aracı gibi arka plana düşer |
| V3 | Error→Explain→Fix döngüsü, tek agent'ın kendi kendini düzeltmesinden ölçülebilir şekilde daha iyi sonuç verir | **Düşük-Orta — doğrulanmamış, MVP'de test edilmeli** | Ana farklılaşma iddiası çöker; positioning "observability + kontrol"e kayar |
| V4 | Model API fiyatları 12 ay içinde dramatik artmaz (tarihsel eğilim: düşüş) | Yüksek | Kredi ekonomisi yeniden kurulur |
| V5 | Sandbox'ta kod çalıştırma (test dahil) makul maliyetle (<$0.05/dk) sağlanabilir | Yüksek | Fix/retest döngüsü pahalılaşır, ücretsiz katman küçülür |
| V6 | Ekip küçük (1–3 kişi), MVP bütçesi sınırlı, süre ~4–6 ay | Varsayım | Roadmap ölçekleri değişir |

**Verdict önizlemesi:** Yapılmaya değer, ama yalnızca (a) MVP acımasızca dar tutulursa, (b) V3 hipotezi ilk 8 haftada gerçek kullanıcı görevleriyle ölçülürse, (c) maliyet kontrolü birinci sınıf mimari bileşen olarak ilk günden kurulursa. Detaylı karar §21'de.

---

## 1. Ürün Tanımı ve Pozisyonlama

### 1.1 Ne DEĞİL
- Çoklu-model chat arayüzü (TypingMind klonu) değil.
- Genel amaçlı agent framework'ü (LangGraph/CrewAI rakibi, geliştiriciye SDK satan) değil.
- IDE değil (Cursor/Windsurf ile editör içinde rekabet edilmez).

### 1.2 Ne
Kullanıcının **projesi** (MVP'de: GitHub reposu) etrafında kurulan, görev (mission) bazlı çalışan bir kontrol odası:

1. Kullanıcı bir görev tanımlar ("auth bug'ını çöz").
2. Manager agent projeyi analiz eder, planı çıkarır, alt görevleri dağıtır.
3. Developer agent sandbox'ta değişiklik yapar; testler otomatik koşar.
4. Hata olursa sistem yakalar; Reviewer/Debugger agent kök nedeni açıklar; kullanıcı tek tıkla fix görevini başlatır (veya otomatik mod).
5. Tüm süreç insan-okunur bir timeline'da akar; sonuç PR olarak teslim edilir.

### 1.3 Positioning önerisi (ORCHESTRATE / OBSERVE / RECOVER sorgulaması)

Üçlünün tek tek savunulabilirliği:
- **ORCHESTRATE** — zayıf moat. CrewAI/AutoGen/LangGraph geliştiricilere bunu kod olarak veriyor; Devin/Copilot Workspace son kullanıcıya kapalı kutu olarak veriyor. Bizim farkımız orkestrasyonun *görünür ve müdahale edilebilir* olması olabilir, orkestrasyonun varlığı değil.
- **OBSERVE** — orta moat. LangSmith/Langfuse geliştirici-odaklı trace aracı; biz "son kullanıcıya anlamlı timeline" katmanındayız. Bu gerçek bir boşluk: mevcut araçlar ya ham trace gösteriyor ya hiçbir şey göstermiyor.
- **RECOVER** — potansiyel en güçlü ayrım, ama en az kanıtlanmış olanı (V3). "Hata → başka bir model açıklasın → düzeltme görevi → retest" akışını birinci sınıf UI nesnesi yapan bilinen bir tüketici ürünü yok. Ancak tek-agent ürünler kendi self-correction döngülerini sürekli iyileştiriyor; pencere daralabilir.

**Önerilen positioning cümlesi:** *"Your AI dev team, with a mission control: assign work, watch progress, and recover from failures — across any model."*
Alt-pozisyon (pivot rezervi): eğer V3 çürürse ürün "**AI work you can trust because you can see it**" (observe + kontrol + onay kapıları) eksenine kayar; mimari her iki pozisyonu da destekler.

---

## 2. Hedef Kullanıcılar

### 2.1 Segment A — Builder (ilk hedef)
- **Kim:** Vibe coder, indie developer, AI-destekli geliştirici, öğrenci, hobi geliştiricisi, teknik founder.
- **Bugünkü davranış:** ChatGPT + Claude + belki Cursor arasında kopyala-yapıştır; hangi modelin neyi iyi yaptığına dair sezgisel tercihler; hata çıktığında hatayı elle diğer modele taşıyıp "bunu düzelt" deme alışkanlığı. (Ürün tam olarak bu manuel köprüyü otomatikleştiriyor — bu davranış kalıbı ürünün en güçlü talep sinyali.)
- **Acı noktaları:** bağlam kaybı (her modele projeyi yeniden anlatmak), süreç görünmezliği (agent ne yaptı?), hata döngüsünde elle taşıma, maliyet belirsizliği.
- **Beklenti:** hızlı kurulum (<5 dk, GitHub OAuth), düşük fiyat, "sihir"in çalışması; enterprise compliance beklentisi düşük ama API key'lerinin güvenliği konusunda hassas.

### 2.2 Segment B — Business (faz 2+)
Team management, RBAC, audit log, BYOK, SSO, data isolation, retention kontrolleri, private deployment. MVP'de **satılmaz** ama mimari kararları (tenant izolasyonu, event-sourced audit, şifreleme) ilk günden Business'ı mümkün kılacak şekilde alınır (§9). "Security-by-design, compliance-by-roadmap."

---

## 3. Rakip Analizi

### 3.1 Multi-model platformlar

| | Ne çözüyor | Kime | Güçlü | Zayıf | Şikayetler | Bizim farkımız | Kopyalanmamalı | İlham |
|---|---|---|---|---|---|---|---|---|
| **OpenRouter** | Tek API'den 300+ modele erişim, unified billing | Geliştirici | Devasa model kataloğu, basit fiyat pass-through, güvenilir routing | Son kullanıcı ürünü değil; orkestrasyon/state yok | Rate limit sürprizleri, bazı sağlayıcılarda gecikme | Biz uygulama katmanıyız; OpenRouter bizim potansiyel *tedarikçimiz* | API-marketplace olmaya çalışmak | Provider abstraction, fallback routing, fiyat şeffaflığı |
| **TypingMind / LibreChat** | Çoklu-model chat UI, BYOK | Prosumer | Ucuz, hızlı, BYOK ile marjsız kullanım | Chat'ten öteye geçmiyor; proje/agent kavramı yok | Sync, mobil deneyim | Chat değil mission-odaklıyız | Sonsuz ayar/plugin çöplüğü | BYOK modeli (Builder katmanında maliyet riskini kullanıcıya devretme) |

### 3.2 Agent framework/platformları

| | Ne çözüyor | Kime | Güçlü | Zayıf | Şikayetler | Fark | Kopyalanmamalı | İlham |
|---|---|---|---|---|---|---|---|---|
| **LangChain/LangGraph** | Agent/workflow kütüphanesi (graph tabanlı durable execution) | Geliştirici | Ekosistem, LangGraph'ın checkpoint/state modeli olgun | Kod yazmayı gerektirir; son kullanıcıya hiçbir şey sunmaz; API churn tarihçesi | Soyutlama karmaşası, breaking changes | Biz ürünüz, framework değiliz; LangGraph'ı *içeride kullanmayı değerlendirebiliriz* | Her şeyi soyutlama hastalığı | Checkpoint'li graph execution, human-in-the-loop interrupt modeli |
| **CrewAI** | Rol bazlı multi-agent kurgusu | Geliştirici | "Ekip" metaforu sezgisel, hızlı prototip | Üretimde kırılganlık, gözlemlenebilirlik zayıf, kontrolsüz döngüler | Debug zorluğu, token yakımı | Aynı metafor + üretim disiplini + UI | Serbest agent-agent sohbeti (maliyet/loop bombası) | Rol/görev tanım şeması |
| **AutoGen** | Konuşma-tabanlı multi-agent | Araştırmacı/dev | Esnek, akademik olarak güçlü | Öngörülemez akışlar, ürünleşmemiş | Kararlılık | Deterministik orkestrasyon (state machine) tercih ediyoruz | Açık uçlu group-chat orkestrasyonu | Nested conversation kavramı (Explain alt-görevi buna benzer) |
| **OpenAI Agents SDK** | OpenAI ekosisteminde agent + handoff | Geliştirici | Basit, resmi destek | Tek sağlayıcı yerçekimi | — | Provider-bağımsızlık | Vendor-özel primitive'lere kilitlenme | Handoff + guardrail kavramları |
| **Claude Code / Devin / OpenHands / Copilot coding agent** | Otonom kodlama agent'ı (repo→PR) | Geliştirici | Uçtan uca gerçek iş bitirme; Claude Code terminal/CI entegrasyonu çok güçlü; OpenHands açık kaynak referans mimarisi (sandbox+event stream) | Tek model ailesi (çoğunlukla); süreç görünürlüğü sınırlı (Devin kapalı kutu eleştirisi); fiyat (Devin) | Devin: "demo'daki gibi çalışmıyor", uzun görevlerde raydan çıkma; genel: hataya saplanma | Multi-model ekip + görünür süreç + explicit recovery döngüsü; **ama bunlar en tehlikeli rakip sınıfı — küçümseme yok: iş bitirme kalitesinde bizden ileriler** | Kapalı kutu otonomi (kullanıcı güvenini yiyor) | OpenHands'in event-stream mimarisi ve sandbox modeli birebir ders niteliğinde |
| **Cursor / Windsurf** | AI-native IDE | Geliştirici | Akış içi deneyim, devasa dağıtım | Editör oturumuna bağlı; async "ekip" yönetimi ikincil | Model maliyet/limit şikayetleri | Biz IDE değil, async mission control'üz; Cursor kullanıcısı bizim kullanıcımız *olabilir* (tamamlayıcı) | IDE yapmaya kalkışmak | Background agent + PR akışı |
| **Kimi (Moonshot) Agent** | Uzun bağlam + agentic arama | Son kullanıcı (CN ağırlıklı) | Uzun context, agresif fiyat | Batı pazarında dağıtım/güven | — | — | — | Ucuz model olarak tedarik zincirimizde yer alabilir |

### 3.3 Observability

| | Ne çözüyor | Kime | Güçlü | Zayıf | Fark | İlham |
|---|---|---|---|---|---|---|
| **LangSmith / Langfuse** | LLM trace, eval, prompt yönetimi | Geliştirici ekipleri | Derin trace, eval altyapısı | Son kullanıcıya anlamsız; ürün değil altyapı | Biz trace'i *kullanıcı-dili timeline'a* çeviriyoruz | Trace veri modeli (run tree), eval-driven development |
| **Coralogix (AI obs.) / benzeri APM'ler** | Üretim AI telemetrisi | Platform/SRE ekipleri | Ölçek, alerting | Agent-workflow semantiği yok | Farklı katman; rakip değil | Maliyet/latency metrik tasarımı |

**Sentez:** Pazarda (a) geliştiriciye kod-seviyesi framework, (b) geliştiriciye kapalı-kutu otonom agent, (c) geliştirici ekibine trace altyapısı var. **"Teknik olmayan/orta-teknik kullanıcıya, çoklu-model ekip + görünür süreç + recovery"** kombinasyonu boş. Boşluğun boş olma sebebi kısmen zorluk (maliyet + güvenilirlik), kısmen büyük oyuncuların tek-model teşviki. Bu boşluk 12–18 ay içinde kapanabilir; hız önemli.

---

## 4. Farklılaşma (nihai)

1. **Görünür orkestrasyon:** Plan, görev dağılımı ve agent adımları kullanıcı-dilinde timeline olarak akar; kullanıcı istediği anda duraklatır/yönlendirir. (Devin'in "kapalı kutu" eleştirisinin tam tersi.)
2. **Cross-model recovery:** Hatayı yapan modelden *farklı* bir model kök neden analizi yapar (çapraz kontrol → tek modelin kör noktası hipotezi). Bu, ölçülecek ana hipotezdir (V3); MVP'de A/B olarak (aynı model self-fix vs. çapraz model fix) enstrümante edilecek.
3. **Güven + kontrol kapıları:** Yazma işlemleri (commit, PR) her zaman izlenebilir; otomatik-fix opsiyonel ve bütçe-sınırlı. "AI'a iş verdim ama neye mal olacağını ve ne yaptığını biliyorum."
4. **Maliyet şeffaflığı:** Her görev ve her agent adımı için canlı maliyet sayacı. (Rakiplerde en çok şikayet edilen alanlardan biri; ucuz farklılaşma.)

**Ne farklılaşma DEĞİL:** model sayısı, agent sayısı, "10+ agent şablonu", genel amaçlı otomasyon (Zapier-leşme).

---

## 5. MVP Kapsamı

### 5.1 MVP'ye giren (7 özellik — üst sınır)
1. **GitHub entegrasyonu (dar):** OAuth + tek repo bağlama, clone, branch, commit, PR açma. (GitHub App; §14.)
2. **3 sabit rol:** Manager/Planner, Developer, Reviewer-Debugger. Roller konfigürasyonla tanımlı (system prompt + izinler + model ataması) — kod değişmeden 10+ role genişleyebilir, ama UI'da MVP'de sadece 3'ü var.
3. **Mission çalıştırma:** Görev gir → plan onayı (insan kapısı) → uygulama → test → PR. Tam async, kullanıcı sekmeyi kapatabilir.
4. **Activity Timeline:** İnsan-okunur olay akışı + her satırdan ham detaya (diff, log, model çağrısı) inilebilir "derinleş" görünümü.
5. **Error detection + Explain:** Test/build hatası yakalanır; "Explain" tıklanınca Debugger agent yapılandırılmış kök neden raporu üretir (root cause, olası dosya:satır, güven skoru — güven skoru kalibre edilmemiş bir LLM tahmini olarak etiketlenir, "91%" gibi kesinlik iddiası UI'da "high/medium/low" olarak yumuşatılır).
6. **Fix & Retest:** Tek tık ile fix görevi + otomatik retest; görev başına max N düzeltme turu (varsayılan 3) ve maliyet tavanı.
7. **Model entegrasyonu (2 sağlayıcı + BYOK):** Anthropic + OpenAI doğrudan; kullanıcı kendi anahtarını da girebilir. Model Gateway soyutlaması ilk günden (§14.7).

### 5.2 MVP'ye GİRMEYEN (bilinçli olarak)
- Business/Team özellikleri: SSO, RBAC, audit log UI, BYOK-kurumsal, on-prem.
- 4+ agent, özel agent tanımlama UI'ı, agent marketplace.
- Browser-use / computer-use, genel web araçları.
- GitHub dışı entegrasyonlar (GitLab, Jira, Slack, Linear).
- Otomatik model seçimi/routing zekâsı (MVP: rol başına sabit, kullanıcı değiştirebilir).
- Mobil uygulama; realtime co-editing; chat-first arayüz.
- Kendi eval/prompt-yönetim ürünü; public API/SDK.
- **Tam otonom mod** (insan plan onayı MVP'de zorunlu — güven ve maliyet kontrolü için).
- Fine-tuning, RAG-tabanlı kurumsal bilgi tabanı.

### 5.3 MVP başarı kriterleri (ölçülebilir)
- Aktivasyon: kayıt → ilk başarılı PR ≤ 15 dk (medyan).
- Görev başarı oranı: seçilmiş görev sınıfında (küçük bugfix, test ekleme, küçük refactor) ≥ %50 "kullanıcı PR'ı merge etti".
- V3 ölçümü: çapraz-model fix vs self-fix başarı farkı için enstrümantasyon canlı.
- Görev başına ortalama model maliyeti ≤ $1.50 (hedef; §19).

---

## 6. Temel Ürün Akışı (referans senaryo)

"Bu repodaki authentication problemini çöz" görevi için uçtan uca akış — her adım Event System'e (§14.10) yazılır:

1. `mission.created` — kullanıcı görevi girdi, bütçe/limitler set edildi.
2. Manager: repo haritası çıkarır (dosya ağacı + önemli dosyaların özeti; tam repo'yu context'e sokmaz), problem hipotezi ve 2–5 adımlık plan üretir → `plan.proposed`.
3. **İnsan kapısı:** kullanıcı planı onaylar/düzenler → `plan.approved`.
4. Orchestrator, plan adımlarını sıralı görevler olarak Developer'a atar → `task.assigned`.
5. Developer sandbox'ta çalışır: dosya okur, patch üretir, uygular → `code.modified` (dosya listesi + diff referansı).
6. Test runner koşar → `test.run` (sonuç: pass/fail + log referansı).
7. Fail ise → `failure.detected`; timeline'da ⚠️ kartı; Explain butonu.
8. Explain → Debugger agent (farklı model) log + diff + ilgili kod ile analiz → `failure.explained` (yapılandırılmış rapor).
9. Kullanıcı Fix der (veya auto-fix açıksa ve tur/bütçe limiti aşılmamışsa otomatik) → düzeltme görevi Developer'a → 5–6 tekrar.
10. Pass → Reviewer son inceleme (diff review, riskli değişiklik uyarıları) → `review.completed`.
11. PR açılır → `mission.completed`; timeline özeti PR açıklamasına yazılır.

Her adımda: token/maliyet sayacı güncellenir; tur limiti, süre limiti (görev başına duvar-saat timeout) ve bütçe tavanı kontrol edilir; aşımda `mission.suspended` + kullanıcıya bildirim (para/loop koruması, §15).

---

## 7. Activity / Mission Timeline

- **Veri modeli:** Timeline, ayrı bir sistem değil; Event System'deki olayların **kullanıcı-dili projeksiyonu**dur. Her event: `{id, mission_id, actor(type: agent|system|user, role, model), kind, summary, detail_ref, cost, ts, parent_id}`. `parent_id` ile hiyerarşi: mission → task → step.
- **İki seviye görünüm:** (1) Özet akış ("Claude/Developer 14 dosya değiştirdi"), (2) tıklayınca derinleşme: diff, tool çağrıları, model istek/yanıt metadata'sı (prompt içeriği değil — §9 retention), test logları.
- **Canlılık:** SSE ile push (WebSocket MVP'de gereksiz karmaşıklık; tek yönlü akış yeterli, kullanıcı komutları normal HTTP).
- **Özetleme:** Agent adımlarının insan-dili özetini, adımı yapan agent'ın kendisi üretir (her tool-use turunda 1 cümlelik "status" alanı zorunlu — ekstra model çağrısı yok, aynı yanıtın parçası).
- **Anti-hedef:** Ham log yığını göstermek. Ham veri her zaman *erişilebilir* ama asla *varsayılan* değil.

---

## 8. Error → Explain → Fix Tasarımı

### 8.1 Hata yakalama
Hata kaynakları ve yakalama biçimi:
- **Deterministik:** test/build/lint exit code + stdout/stderr (sandbox runner'dan yapılandırılmış sonuç). En güvenilir sinyal; MVP'nin bel kemiği.
- **Agent-düzeyi:** tool çağrısı hataları, model API hataları, timeout, format ihlalleri (Orchestrator yakalar).
- **Semantik (MVP-sonrası):** Reviewer'ın "testler geçti ama davranış yanlış" tespiti; MVP'de Reviewer sadece diff-review yapar, blocking değildir.

### 8.2 Explain
- Debugger agent'a giden bağlam paketi (deterministik olarak derlenir, agent'a bırakılmaz): hata logu (kırpılmış, son N satır + ilk hata bloğu), başarısız test kodu, son diff, ilgili dosyaların güncel hali (hata stack trace'inden çıkarılan dosyalar), mission planı özeti.
- Çıktı **şema-zorunlu** (structured output): `{root_cause, evidence[], suspected_locations[{file,line?}], suggested_fix_strategy, confidence: high|medium|low, is_flaky_suspect: bool}`.
- Explain çıktısı timeline'a kart olarak düşer; Fix butonu bu yapıyı düzeltme görevinin girdisi yapar.

### 8.3 Fix & Retest — güvenlik/kontrol mekanizmaları
- **Tur limiti:** Görev başına max fix turu (varsayılan 3; kullanıcı 1–5 arası ayarlayabilir). Aşımda durur, "insan yardımı gerekli" kartı + o ana kadarki en iyi durumun PR taslağı.
- **İlerleme kontrolü:** Her fix turunda hata imzası (normalize edilmiş hata mesajı hash'i) karşılaştırılır; aynı hata 2 kez üst üste → döngü kırılır, farklı strateji zorlanır veya durdurulur ("thrashing detection").
- **Bütçe tavanı:** Mission başına $ tavanı; her model çağrısı öncesi rezervasyon-kontrol (§15).
- **Kapsam sınırı:** Fix görevi, Explain'in işaret ettiği dosyalarla + testle sınırlı bir izin kapsamında çalışır (Developer'ın genel yazma izni vardır ama fix turunda dokunulan dosya sayısı patlarsa uyarı).
- **Flaky test şüphesi:** Explain `is_flaky_suspect=true` derse sistem önce testi değişiklik olmadan 1 kez tekrar koşar (ucuz doğrulama), sonra fix'e gider.
- **Auto-fix opsiyonel:** Varsayılan: Explain otomatik, Fix insan-onaylı. Kullanıcı "auto" moda alabilir; auto modda bile tur+bütçe limitleri mutlaktır.

---

## 9. Security & Privacy (security-by-design)

> İlke: "Veri hiçbir yerde tutulmaz" **iddia edilmez**. Bunun yerine her veri sınıfı için nerede/ne kadar/neden tutulduğu tanımlanır ve kullanıcıya beyan edilir.

### 9.1 Veri sınıflandırma ve retention matrisi

| Veri | Nerede | Şifreleme | Retention (varsayılan) | Not |
|---|---|---|---|---|
| Hesap/kimlik | Postgres | at-rest (disk) + TLS | Hesap ömrü | |
| GitHub token'ları | Secrets store (KMS-şifreli, ayrı tablo/servis) | envelope encryption (KMS) | Hesap ömrü; bağlantı kesilince anında silme + token revoke | Uygulama loglarına asla yazılmaz; GitHub App kısa-ömürlü installation token tercih edilir (kalıcı PAT saklamaktan kaçınılır) |
| Kullanıcı BYOK model anahtarları | Secrets store | envelope encryption | Kullanıcı silene kadar | Sadece server-side, model çağrısı anında decrypt |
| Kaynak kod (repo klonu) | Sandbox ephemeral disk + geçici workspace cache | at-rest | **Mission bitince silinir**; cache max 24h | Kalıcı repo kopyası tutulmaz; gerektiğinde yeniden clone |
| Diff'ler / PR içerikleri | Object storage | at-rest | Mission geçmişi olarak kullanıcı silene kadar (kullanıcıya görünür, silinebilir) | Timeline'ın "derinleş" verisi |
| Prompt/yanıt tam metinleri | **Varsayılan: tutulmaz.** Debug opt-in ise object storage | at-rest | Opt-in: 7 gün | Timeline özet + metadata (model, token, süre, maliyet) yeterli |
| Test/build logları | Object storage (kırpılmış) | at-rest | 30 gün | Loglar kod içerebilir → kod ile aynı hassasiyet sınıfı |
| Event/audit kayıtları | Postgres (append-only) | at-rest | 90 gün (Business'ta konfigüre edilebilir) | İçerik değil metadata + özet |
| Telemetri/metrics | Metrics store | — | 30–90 gün | İçeriksiz |

### 9.2 Mimari kararlar
- **Multi-tenancy:** MVP: paylaşımlı Postgres, her tabloda `tenant_id` (org) + `user_id`; tüm erişim repository-katmanında zorunlu tenant filtresi + Postgres **Row-Level Security** (savunma derinliği — uygulama bug'ı tek başına sızıntı yaratmasın). Business/Enterprise'da schema-per-tenant veya dedicated DB'ye evrilebilir; veri modeli bunu bloklamaz.
- **Sandbox izolasyonu:** Kod çalıştırma her zaman tenant-başına ephemeral, ağ-kısıtlı micro-VM/container'da (§16). Sandbox'lar arası ve sandbox→internal-network erişimi yok; dış ağ varsayılan kapalı, paket kurulumu için allowlist proxy.
- **AuthN:** GitHub OAuth (Builder için doğal) + e-posta. Session: kısa ömürlü JWT + refresh, httpOnly. AuthZ MVP'de basit (owner-only), ama izin kontrolü tek bir policy modülünden geçer → RBAC'a evrim kolay.
- **Secrets:** Uygulama DB'sinden ayrı, KMS envelope encryption'lı secrets servisi (MVP'de aynı Postgres'te ayrı şifreli tablo kabul edilebilir; arayüz soyut tutulur → Vault/KMS'e geçiş kırılımsız).
- **Prompt injection yüzeyi (kritik):** Repo içeriği, issue metinleri, test logları = **güvenilmeyen girdi**. Önlemler: (a) agent'lara verilen sistem talimatı ile untrusted içerik ayrımı (içerik her zaman ayrı, işaretli bloklarda), (b) agent'ın yapabileceği yan etkiler izin listesiyle sınırlı (örn. Developer'ın "başka repo'ya push" veya "secrets oku" yetkisi *yok* — yetki modeli tool katmanında, prompt'ta değil), (c) dış ağ kapalı sandbox → exfiltration kanalı daralır, (d) PR her zaman insan merge'üne bırakılır. Bu risk **tamamen çözülemez**; kalıcı (residual) risk olarak belgelenir.
- **Model sağlayıcı veri politikaları:** API kullanımında Anthropic/OpenAI varsayılan olarak API verisiyle eğitim yapmadığını beyan ediyor (ZDR opsiyonları ayrıca mevcut) — bu beyanlar sağlayıcı sözleşmesine dayanır, biz garanti veremeyiz; kullanıcıya sağlayıcı-başına beyan linki gösterilir. BYOK'ta sorumluluk açıkça kullanıcıya aittir. Business fazında ZDR/enterprise anlaşmaları değerlendirilir.
- **Auditability:** Event sistemi append-only olduğundan audit log Business fazında büyük ölçüde "UI + retention + imza" işidir, yeni altyapı değil.
- **Pen-test hazırlığı:** Tek giriş noktası (API gateway), tenant filtresi tek katmanda, secrets tek serviste → denetlenebilir yüzey küçük tutulur. İlk bağımsız pen-test hedefi: Business fazı öncesi.

---

## 10. Business Model

### 10.1 Yapı
- **Builder:** Free (deneme: ~aylık sınırlı kredi + BYOK'la genişletilebilir) → Pro (~aylık kredi paketi + tüm özellikler) → Power (daha yüksek kredi + paralel mission).
- **Business (faz 2+):** Team (paylaşımlı workspace, temel roller) → Business (RBAC, audit, retention kontrolleri, BYOK) → Enterprise (SSO, DPA/ZDR, private deployment görüşmeli).
- **Kredi sistemi:** 1 kredi = sabitlenmiş bir iç maliyet birimi (örn. $0.01 COGS karşılığı; kesin kur launch öncesi model maliyet ölçümüyle belirlenir — şimdi fiyat sabitlenmez, §19'daki model güncellenerek belirlenir). Model çağrıları + sandbox dakikaları + storage kredi düşer. **BYOK kullanımda model maliyeti kredi düşmez, sadece platform/sandbox payı düşer** — Free katmanın maliyet riskini sınırlar ve BYOK'u büyüme kanalı yapar.
- **Fiyat ilkesi:** Marj, model token'ının üzerine %X koymaktan değil, orkestrasyon/observability/recovery değerinden gelir; token pass-through'a yakın + platform aboneliği. (Token marjlama, fiyat düşüşlerinde ve BYOK karşısında savunulamaz.)

### 10.2 Ekonomik mantık (gross margin şekli)
- Free: negatif marj (CAC olarak muhasebeleştirilir); BYOK teşviki + düşük kredi tavanı ile sınırlanır.
- Pro: hedef %60–75 brüt marj (abonelik – [model COGS + sandbox + infra payı]); kredi aşımı ek paket olarak satılır (aşım da marjlı).
- Business: seat + kredi havuzu; marj daha yüksek (özellikler yazılım-marjlı, kullanım pass-through'a yakın).
- Detaylı sayısal model §19'da.

---

## 11. Teknik Mimari

### 11.1 Katman haritası

```
[Next.js Frontend] ──HTTPS/SSE──► [API (Fastify/TS) + Auth + Policy]
                                        │
                                        ├─► Postgres (tenant data, missions, events, state)
                                        ├─► Redis (queue, cache, rate-limit, budget counters)
                                        ├─► Object Storage S3 (diffs, logs, artifacts)
                                        │
                                  [Orchestrator worker'ları]  ◄── queue (BullMQ)
                                        │
                        ┌───────────────┼───────────────┐
                  [Agent Runtime]  [Tool Runtime]  [Model Gateway]
                        │               │               │
                        │         [Sandbox: E2B/     [Anthropic]
                        │          Firecracker VM,   [OpenAI]
                        │          git+test runner]  [BYOK keys]
                        └── events ──► Event tablosu ──► SSE ──► Timeline UI
```

### 11.2 Katman katman kararlar

| Katman | Görev | MVP seçimi | Neden | Alternatif | Trade-off / Scale'de |
|---|---|---|---|---|---|
| **Frontend** | Timeline, mission yönetimi, ayarlar | Next.js + TypeScript + Tailwind | Ekosistem, SSE kolay, hızlı iterasyon | SvelteKit (daha hafif) | Scale'de değişmez |
| **Backend API** | REST + SSE, auth, policy | Node.js + Fastify + TypeScript | Tek dil (FE+BE), async I/O ağırlıklı iş yükü, tip paylaşımı | Python/FastAPI (AI ekosistemi daha zengin) | Agent runtime Python gerektirirse polyglot'a gidilir; MVP'de tek dil hız kazandırır. **Bilinçli karar: agent mantığı framework'süz/ince yazılacaksa TS yeterli; LangGraph'a yaslanılacaksa Python seçilmeli. Öneri: TS + framework'süz ince orkestrasyon (§11.3)** |
| **Auth** | OAuth, session | GitHub OAuth + Lucia/Auth.js | Builder kitlesi GitHub'lı | Clerk/Auth0 (hız ama bağımlılık+maliyet) | Business'ta SSO için WorkOS eklenir |
| **API Gateway** | TLS, rate limit, WAF | MVP: Cloudflare + uygulama-içi rate limit | Ayrı gateway ürünü MVP'de gereksiz | Kong/Envoy | Enterprise'da değerlendirilir |
| **Orchestrator** | Mission state machine, görev atama, limit enforcement | Kendi ince state-machine'imiz: Postgres'te durable state + BullMQ işleri | Çekirdek IP burası; framework'e devredilmez. Durable-execution ihtiyacı var ama Temporal MVP için ağır | **Temporal** (durable execution, retry, uzun işler — güçlü ama operasyonel yük + öğrenme eğrisi); LangGraph (Python'a çeker) | Scale'de Temporal'a geçiş ciddi olasılık; bu yüzden orchestrator adımları **idempotent ve event-sourced** yazılır ki geçiş mümkün olsun |
| **Agent Runtime** | Tek agent'ın tool-use döngüsü | İnce in-house loop (model çağrısı → tool çağrıları → sonuç), her adım event | Kontrol + gözlemlenebilirlik birinci sınıf; framework soyutlamaları bunu gizler | LangGraph, OpenAI Agents SDK | Framework churn riskinden kaçınma; maliyet: bazı hazır özellikleri (memory vb.) kendimiz yazarız |
| **Model Gateway** | Provider soyutlama, fallback, usage metering | İnce in-house adapter (ortak `complete(request)->response` arayüzü, provider-adapter'lar) + gerekirse OpenRouter *bir adapter olarak* | Bağımsızlık ilkesi: routing sağlayıcısı da bir bağımlılıktır; arayüz bizim olmalı | LiteLLM (hızlı ama Python), OpenRouter-only (tek bağımlılık) | Adapter sayısı arttıkça bakım maliyeti; kabul edilir |
| **Tool Runtime** | Tool tanımı, izin kontrolü, çağrı yürütme | JSON-schema tool registry + policy check + sandbox RPC | İzin modeli tool katmanında yaşamalı (§9) | MCP standardı | MCP'yi faz 2'de tool tanım formatı olarak benimsemek mantıklı (ekosistem yönü orası) |
| **Sandbox** | Kod çalıştırma, git, test | **E2B** (veya Modal) ephemeral micro-VM; dış ağ kapalı/allowlist | Firecracker izolasyonu hazır servis olarak; kendi Firecracker filomuz MVP için aşırı | Kendi Firecracker/gVisor filosu (maliyet ↓ kontrol ↑, ops yükü ↑↑); Fly Machines | Scale'de maliyet için kendi filoya geçiş muhtemel; sandbox arayüzü (create/exec/upload/download/destroy) soyut tutulur |
| **Project State** | Mission/task/plan/artifact durumu | Postgres (normalize tablolar) + event-sourcing hibrit (§13) | Tek doğruluk kaynağı, transaction garanti | — | — |
| **Event System** | Append-only olay akışı | Postgres `events` tablosu + LISTEN/NOTIFY→SSE | MVP ölçeğinde Kafka gereksiz; Postgres yeterli ve transactional (state+event tek commit) | Redis Streams, NATS, Kafka | >~1K eşzamanlı mission'da Redis Streams/NATS'a taşınır; event şeması şimdiden taşınabilir tasarlanır |
| **Queue** | Async iş dağıtımı, retry | BullMQ (Redis) | Olgun, TS-native, delayed/retry/priority hazır | pg-boss (tek-store sadeliği), SQS | Redis zaten cache için var; kabul |
| **Database** | Kalıcı veri | Postgres 16 (yönetilen: Neon/RDS/Supabase) | Standart, RLS, JSONB | — | Sharding çok uzak |
| **Cache** | Rate-limit, budget sayaçları, kısa TTL cache | Redis (yönetilen) | Atomic sayaçlar (bütçe/limit enforcement için kritik) | — | — |
| **Object Storage** | Diff, log, artifact | S3 (veya R2 — egress ucuz) | Standart | — | — |
| **GitHub Integration** | Repo erişimi, PR | **GitHub App** (OAuth app değil) — kısa ömürlü installation token, ince izin (contents+PR), webhook | Token güvenliği + izin darlığı | PAT (kötü: geniş+kalıcı) | GitLab/Bitbucket faz 4+ |
| **Monitoring** | Metrics, alerting, trace | OpenTelemetry + Grafana Cloud (veya Axiom) + Sentry | Standart, ucuz başlangıç | Datadog (pahalı) | LLM-özel metrikler (token, maliyet, tur sayısı) OTel attribute olarak |
| **Logging** | Uygulama logları | Yapılandırılmış JSON → aynı stack; **içerik redaksiyonu** (secret scanner) log pipeline'ında | §9 uyumu | — | — |
| **Security Layer** | Policy, secrets, tenant filtresi | Yukarıda dağıtık ama: tek policy modülü + secrets servisi + RLS | §9 | — | — |
| **Deploy/Infra** | Barındırma | MVP: Render/Fly.io + yönetilen DB (tek bölge) | Ops yükü minimum; k8s MVP'de erken | AWS ECS→EKS | Business fazında AWS'e taşınma olasılığı yüksek; container-first yazılır |

### 11.3 "Framework'süz orkestrasyon" kararının gerekçesi
Orchestrator + Agent Runtime bu ürünün çekirdek IP'si ve farklılaşma yüzeyidir (timeline, limitler, recovery). Framework'ler (LangGraph/CrewAI) bu katmanı hızlandırır ama (a) event/observability modelini kendi biçimlerine zorlar, (b) Python'a kilitler, (c) API churn riski taşır. İhtiyacımız olan döngü ~birkaç yüz satırlık disiplinli koddur: model çağır → tool çağrılarını policy'den geçir → çalıştır → event yaz → tekrar. **Risk kabulü:** durable-execution (crash-recovery, uzun işler) alanını kendimiz çözmek zorundayız; bunun için her adım idempotent + state Postgres'te + iş kuyruğu retry'lı tasarlanır. Bu karmaşıklık yönetilemez hale gelirse Temporal'a geçiş planı hazırdır (adımlar zaten activity-benzeri yazılmış olacak).

---

## 12. Agent Execution Modeli

### 12.1 Yürütme yaklaşımı karşılaştırması

| Yaklaşım | Artı | Eksi | Karar |
|---|---|---|---|
| Synchronous (request-response) | Basit | Dakikalarca süren mission'lar için imkânsız; timeout, ölçeklenmez | Sadece "Explain" gibi kısa tekil çağrılarda bile riskli; kullanılmaz |
| Asynchronous (fire-and-forget worker) | Uzun iş desteği | Tek başına durability/retry zayıf | Yetersiz |
| **Queue-based + event-driven (seçilen)** | Durability, retry, backpressure, paralellik kontrolü; event akışı timeline'ı bedavaya getirir | Altyapı parçası fazla (Redis, worker) | ✅ Mission = state machine; her geçiş bir queue işi; her sonuç bir event. UI event'leri SSE ile tüketir |

### 12.2 Kontrol mekanizmaları (runaway/maliyet koruması — mimarinin birinci sınıf parçası)

- **Bütçe (para):** Mission başına $ tavanı (kullanıcı ayarlı, plan bazlı üst sınır). Her model çağrısı *öncesi* Redis'te atomic rezervasyon (tahmini maliyet), *sonrası* gerçek maliyetle mutabakat. Tavan aşımı → mission `suspended`, kullanıcı onayıyla devam. Ek olarak kullanıcı-günlük ve tenant-aylık tavanlar (katmanlı devre kesici).
- **Tur/adım limitleri:** Agent başına max tool-round (örn. 30), mission başına max task, task başına max fix turu (3). Hepsi konfig, hepsi enforcement Orchestrator'da (prompt'a güvenilmez).
- **Duvar-saat timeout:** step (örn. 5 dk), task (30 dk), mission (2 saat). Timeout → graceful cancel → durum kaydı → timeline'a bildirim.
- **Loop/thrashing tespiti:** (a) hata imzası tekrarı (§8.3), (b) aynı tool'un aynı argümanlarla ardışık çağrısı (n≥3) → müdahale, (c) diff churn (aynı satırların ileri-geri değişmesi) sezgisel uyarısı.
- **Cancellation:** Kullanıcı her an durdurabilir; cancel = queue işaretleme + sandbox'a SIGTERM + model çağrısı stream abort; adımlar idempotent olduğundan yarım iş güvenli.
- **Retry:** Sadece *transient* hatalarda (API 429/5xx, sandbox network) exponential backoff (max 3); model çıktı kalitesi hataları retry edilmez, recovery döngüsüne girer (bu ayrım önemli: retry ≠ fix).
- **Rate limiting:** Provider başına global token-bucket (Redis) — tenant'lar arası adil paylaşım; kullanıcı başına eşzamanlı mission limiti (Free:1, Pro:2–3).
- **Token limitleri:** Context assembler her çağrıda bütçelenmiş bağlam kurar (sabit tavan, örn. 60–100K token); repo asla komple context'e dökülmez (dosya haritası + hedefli okuma).
- **Permission boundaries:** Tool registry'de rol-başına izin seti: Manager = read-only + plan; Developer = read/write (workspace içi) + test çalıştırma; Reviewer/Debugger = read-only + test çalıştırma. Hiçbir agent: secrets okuma, workspace dışı dosya, dış ağ (allowlist hariç), force-push, başka repo. İzinler tool-çağrı anında policy modülünde kontrol edilir.

---

## 13. Shared Project State

### 13.1 Model: "State machine + event sourcing hibriti"
- **Kalıcı (Postgres):** `missions` (durum, bütçe, limitler), `tasks` (atama, durum, girdi/çıktı referansı), `plans` (versiyonlu), `events` (append-only), `artifacts` (diff/log/rapor referansları → S3). Mevcut durum normalize tablolarda (hızlı sorgu); events tablosu tarihçe/audit/timeline için.
- **Geçici:** sandbox dosya sistemi (mission-ömürlü), agent'ın o anki context penceresi (çağrı-ömürlü), model ham yanıtları (varsayılan tutulmaz, §9).
- **Kalıcı olması gerekenler:** plan + kararlar, task sonuç *özetleri*, diff'ler, test sonuçları, Explain raporları, maliyet kayıtları. **Kalıcı olmaması gerekenler:** ara düşünce zincirleri, tam prompt metinleri, repo kopyaları.

### 13.2 Agent context yönetimi
Agent'lar birbirinin chat geçmişini görmez; **paylaşılan bellek = yapılandırılmış state'tir.** Her göreve başlarken context assembler şunları derler: mission hedefi, onaylı plan, önceki task'ların yapılandırılmış özetleri (serbest metin sohbet değil), ilgili artifact'lar (son diff, son hata raporu), hedefli dosya içerikleri. Bu tasarım: (a) context şişmesini keser, (b) "telefon oyunu" bilgi bozulmasını azaltır, (c) herhangi bir agent'ın modelini değiştirmeyi bedavaya getirir (provider-bağımsızlık state seviyesinde sağlanır).

### 13.3 Concurrency / race condition / conflict
- **MVP kuralı — sadelik:** Bir mission içinde workspace'e yazan **tek aktif task** (sıralı yürütme). Paralellik MVP'de yalnızca read-only işlerde (örn. Reviewer analizi ile sonraki planlama). Bu, dosya-çakışması sınıfını kökünden yok eder; "paralel developer agent'lar" bilinçli olarak faz 3+ konusudur (git worktree/branch-per-task + merge stratejisi gerektirir — teknik olarak çekici, MVP için gereksiz zorluk: **işaretlendi, ertelendi**).
- **State geçişleri:** Postgres transaction + optimistic locking (`version` kolonu); geçersiz geçiş (örn. cancel edilmiş task'ın sonucu gelirse) event olarak kaydedilir ama state'i değiştirmez (idempotent consumer).
- **Kuyruk yarışları:** Task işleme idempotency-key ile (aynı iş iki worker'a düşerse ikincisi no-op).
- **Git conflict:** Mission başına tek branch; base branch ilerlemişse PR açılışında GitHub conflict durumu kullanıcıya yansıtılır (MVP'de otomatik rebase yok).

---

## 14. Tool / Computer Access

### 14.1 MVP tool seti (dar)
1. `repo.read` — dosya okuma/arama/ağaç (sandbox içi).
2. `repo.write` — patch uygulama (tam dosya yazma değil, diff-tabanlı; yanlışlıkla dosya ezme riskini azaltır).
3. `shell.run` — **allowlist'li** komutlar: test/build/lint komutları (proje türüne göre tespit edilen: `pytest`, `npm test`, vb.) + paket kurulumu (allowlist proxy üzerinden). Serbest shell MVP'de yok — prompt injection ve runaway yüzeyini daraltır. (Kısıt: bazı projelerde meşru komutlar engellenecek; kabul edilen trade-off, allowlist genişletilebilir.)
4. `git.*` — branch, add/commit (sandbox içi), push yalnızca mission branch'ine (server-side kontrol).
5. `github.pr` — PR aç/güncelle (server-side, sandbox'tan değil — token sandbox'a girmez).

**Kritik güvenlik kararı:** GitHub token'ları sandbox'a asla verilmez. Clone/push, server-side git servisi üzerinden yapılır (sandbox'a kod upload edilir / sandbox'tan diff alınır) veya tek-kullanımlık, tek-repo, kısa-ömürlü token ile yapılır.

### 14.2 MVP'de olmayan tool'lar
Browser/computer-use, serbest internet erişimi, veritabanı bağlantıları, cloud CLI'ları, dosya sistemi (workspace dışı). Bunlar faz 4+ ve her biri kendi izin/sandbox incelemesini gerektirir.

### 14.3 Sandbox modeli
- Mission başına ephemeral micro-VM (E2B/Modal): repo workspace + runtime image (dil bazlı hazır image'lar: node, python).
- Ağ: varsayılan kapalı; paket registry'leri (npm, PyPI) proxy allowlist'i.
- Kaynak limitleri: CPU/RAM/disk/duvar-saat kotası; mission bitiminde imha.
- İleride (Business): tenant-pinned sandbox havuzları, kendi Firecracker filosu.

---

## 15. Multi-Model / Provider Bağımsızlığı

- **İlke:** Provider-independent agent architecture = (a) tek iç arayüz: `ModelGateway.complete({messages, tools, schema, budget, model_ref})`, (b) `model_ref` soyut ("developer-default" gibi rol-bazlı alias → konfig ile gerçek modele bağlanır), (c) yetenek matrisi (tool-use kalitesi, context limiti, structured-output desteği, maliyet) konfigde tutulur; kod modele değil yeteneğe koşullanır.
- **MVP sağlayıcıları:** Anthropic (Developer/Reviewer varsayılanı) + OpenAI (Manager/Debugger varsayılanı) — çapraz-model recovery hipotezi için 2 sağlayıcı yeter. Kimi/Gemini adapter'ları faz 3 (Gemini muhtemelen önce: agresif fiyat/uzun context).
- **OpenRouter kararı:** Tek entegrasyonla geniş katalog cazip; ancak (a) BYOK kullanıcıları kendi Anthropic/OpenAI anahtarını getirir → doğrudan adapter zaten gerekli, (b) kritik yol için araya ek bağımlılık/latency. Karar: doğrudan adapter'lar birincil, OpenRouter "uzun kuyruk modeller" için opsiyonel ek adapter.
- **Fallback:** Provider 5xx/429'da aynı yetenek sınıfındaki yedek modele otomatik geçiş (kullanıcıya timeline'da beyan edilir — sessiz model değişimi güven sözleşmesine aykırı).

---

## 16. Test Stratejisi

### 16.1 Neden klasik testler yetmez
Agent sistemlerinde çekirdek davranış **non-deterministik ve model-bağımlı**: aynı input farklı çıktı üretebilir; model sağlayıcı sessizce model günceller ve davranış kayar; kalite "doğru/yanlış" değil dağılımsaldır ("görevlerin %X'i başarılı"). Bu yüzden klasik test piramidinin üstüne **eval katmanı** (istatistiksel, dataset-tabanlı, sürekli koşan) eklenir; ayrıca hata modları fonksiyonel değil davranışsaldır (loop, kapsam kayması, maliyet patlaması) ve bunlar ancak senaryo-tabanlı simülasyonla yakalanır.

### 16.2 Katmanlar
- **Unit:** Orchestrator state machine geçişleri, policy/izin kontrolleri, bütçe sayacı, context assembler, hata-imza normalizasyonu. (Model çağrıları mock'lu — deterministik.)
- **Integration:** Queue→worker→sandbox→event zinciri; GitHub App akışı (test org'unda); Model Gateway adapter'ları (kayıtlı yanıtlarla + günlük smoke canlı çağrı).
- **E2E:** "Golden repo" seti (bilinen bug'lı 5–10 küçük repo) üzerinde tam mission akışı; CI'da mock-model ile deterministik, nightly'de gerçek modelle.
- **Agent behavior eval (sürekli):** Görev başarı oranı, fix-turu dağılımı, maliyet/görev, thrashing oranı — golden repo seti + gerçek kullanımdan anonimleştirilmiş metrik. Model/prompt değişikliği = eval koşmadan deploy yok. (Araç: basit in-house harness + kayıt; LangSmith/Braintrust benzeri araç faz 3'te değerlendirilir.)
- **Prompt evaluation:** Sistem prompt'ları versiyonlu (git'te); değişiklik PR'ı eval sonucu eklemeden merge edilmez.
- **Security:** (a) prompt-injection test seti (zehirli repo/loglarla agent'ı yetki dışına çıkarma denemeleri — beklenen: policy katmanı bloklar), (b) tenant izolasyon testleri (RLS bypass denemeleri, otomatik), (c) secrets sızıntı taraması (loglar/eventler/PR içerikleri), (d) sandbox kaçış yüzeyi için sağlayıcı güvencesi + konfig testleri.
- **Load:** Eşzamanlı N mission simülasyonu (mock model, gerçek queue/DB) — hedef: 100 eşzamanlı mission'da event gecikmesi < 2 sn.
- **Failure recovery:** Chaos testleri: worker crash mid-task, sandbox ölümü, provider timeout, Redis kaybı → beklenen: mission tutarlı durumda kalır, çift yürütme yok (idempotency kanıtı).
- **Cost control:** Bütçe tavanının kasıtlı aşım senaryolarında (pahalı model + uzun loop simülasyonu) devre kesicinin tetiklendiğinin otomatik testi — **bu testler release-blocking'dir.**

---

## 17. Development Roadmap

> Varsayım: 1–3 mühendis. Süreler tek deneyimli full-stack + AI-destekli geliştirme temposuna göre; ±%50 belirsizlik.

**Faz 0 — Mimari & İskelet (2–3 hafta)**
Hedef: Karar kayıtları (bu doküman + ADR'ler), monorepo iskeleti, CI, deploy hattı, Postgres/Redis/S3, auth, event tablosu + SSE ucu.
Tamamlanma: "Merhaba dünya mission'ı" — sahte agent bir event yazar, timeline'da canlı görünür.
Risk: altyapı yak-shaving'e dalmak → sınır: hafta 3 sonunda kesilir.

**Faz 1 — Tek Agent Dikeyi (4–5 hafta)**
Hedef: GitHub App + clone→sandbox→Developer agent→patch→test→PR tam dikeyi, tek agent'la.
Bağımlılık: Faz 0. İçerik: Model Gateway (Anthropic), tool runtime + izinler, sandbox entegrasyonu, bütçe/timeout enforcement v1.
Tamamlanma: Golden repo'daki basit bug, uçtan uca PR'a dönüyor; maliyet kaydı doğru.
Risk: sandbox+git entegrasyon sürprizleri (en yüksek belirsizlikli faz).

**Faz 2 — Orkestrasyon: 3 Agent (3–4 hafta)**
Hedef: Manager plan üretimi + insan onay kapısı + task dağıtımı; Reviewer diff-review; OpenAI adapter; rol-model konfigürasyonu.
Tamamlanma: Referans akış (§6) 1–10 adımlarıyla çalışıyor.
Risk: plan kalitesi düşükse akış anlamsızlaşır → plan şeması + eval erken kurulur.

**Faz 3 — Recovery & Observability cilası (3–4 hafta)**
Hedef: Explain (yapılandırılmış rapor) + Fix/Retest + thrashing tespiti + timeline derinleşme görünümleri + maliyet sayacı UI; V3 A/B enstrümantasyonu.
Tamamlanma: Hata senaryolu golden repo'larda Error→Explain→Fix döngüsü ≥%40 başarıyla dönüyor; tüm limitler test edilmiş.

**Faz 4 — Builder Launch (3 hafta + sürekli)**
Hedef: Onboarding (<15 dk aktivasyon), Free/Pro faturalama (Stripe), kredi sayacı, BYOK, durum/hata UX'i, dokümantasyon, private beta → public.
Tamamlanma: İlk 50 dış kullanıcı, aktivasyon ve görev-başarı metrikleri akıyor.
Risk: launch kalitesi — beta'da acımasız görev-sınıfı daraltması (sadece iyi çalışan görev türlerini vaat et).

**Faz 5 — Öğren & Business temeli (6–8 hafta, veriye bağlı)**
Hedef: V3 verdiktine göre positioning ayarı; Team workspace, paylaşım, temel roller; retention kontrolleri UI; Gemini/Kimi adapter'ları; paralel task (worktree) araştırması.
Bağımlılık: Faz 4 verisi.

**Faz 6 — Enterprise güvenlik (zaman: talebe bağlı)**
Hedef: SSO (WorkOS), RBAC, audit UI, DPA/ZDR anlaşmaları, bağımsız pen-test, SOC2 hazırlık süreci başlangıcı.
Tamamlanma kriteri: ilk ödeyen Business müşterisinin güvenlik anketinden geçmek.

---

## 18. (Bölüm 15–16 içerikleri yukarıda §12 ve §14'te işlendi — çapraz referans)

Agent execution kontrolleri → §12; tool/sandbox → §14. (Numaralandırma, talep edilen başlıkların tamamının kapsandığını doğrulamak içindir.)

---

## 19. Cost Model

> **Varsayımlar (fiyatlar değişkendir; launch öncesi güncellenir):** Frontier model ~$3/M input + $15/M output token; orta sınıf model ~$0.25–1/M input; sandbox ~$0.03–0.05/CPU-saat-eşdeğeri dakika bazlı; storage/egress ihmal seviyesi. Prompt caching ile tekrar eden bağlam (repo haritası, plan) %50–90 indirimli — mimaride caching birinci sınıf varsayım.

**Örnek: 1 proje, 3 agent, 20 task'lık kullanıcı (aylık):**

| Kalem | Hesap | Tahmin |
|---|---|---|
| Manager (plan/koordinasyon) | 20 task × ~40K in / 3K out, orta-üst model | ~$3–6 |
| Developer (kod, çoğunluk yükü) | 20 task × ort. 6 tur × ~25K in / 3K out, frontier | ~$12–25 (caching ile ~$8–15) |
| Debugger/Reviewer | ~10 explain + 20 review × ~20K in / 2K out | ~$3–7 |
| Sandbox | 20 task × ~15 dk | ~$1–3 |
| Storage/infra payı (kullanıcı başına amorti) | | ~$1–2 |
| **Toplam COGS** | | **~$20–40/ay** (caching + kısmi orta-sınıf model kullanımıyla hedef: **$15–25**) |

**Marj mantığı:** Free: ~5 task/ay tavan (≈$4–6 COGS, CAC sayılır) + BYOK ile model maliyeti $0'a düşer → Free sürdürülebilir. Pro ~$40–60 bandında konumlanırsa (kesinleştirilmedi) 20-task kullanıcıda %40–65 brüt marj; kredi aşımı satışı marjı korur. Business: seat başına kullanım benzer ama fiyat 2–3×, marj %70+. **Kırılganlık:** görev başına tur sayısı beklenenin 2×'i çıkarsa marj erir → tur limitleri ve caching sadece güvenlik değil, birim ekonominin kendisidir.

---

## 20. En Büyük Riskler (P: olasılık, I: etki, 1–5)

| # | Risk | P | I | Mitigasyon |
|---|---|---|---|---|
| 1 | **Agent güvenilirliği**: görev başarı oranı vaadi taşımaz, kullanıcı 2. denemede terk eder | 4 | 5 | Görev sınıfını daralt (küçük bugfix/test/refactor); başarı oranını sınıf bazında ölç; başaramayacağını erken söyleyen "triage" adımı |
| 2 | **V3 çürür**: çapraz-model recovery ölçülebilir fayda sağlamaz | 3 | 4 | 8. haftadan itibaren A/B; pivot pozisyonu hazır (observe+kontrol ekseni) |
| 3 | **Maliyet patlaması** (runaway loop, verbose model) | 3 | 5 | §12 devre kesiciler (release-blocking testli); rezervasyon-tabanlı bütçe; caching |
| 4 | **Prompt injection** (zehirli repo/issue/log ile yetki dışı eylem) | 3 | 4 | İzinler tool katmanında; ağ-kapalı sandbox; PR insan merge'ü; injection test seti; residual risk beyanı |
| 5 | **Malicious repository** (sandbox'ı kripto-madencilik/saldırı için kullanma, kaçış) | 2 | 4 | Ephemeral micro-VM, ağ allowlist, kaynak kotası, anomali izleme |
| 6 | **Veri sızıntısı** (kod/token'ların loglara, yanlış tenant'a, sağlayıcıya sızması) | 2 | 5 | RLS + tek policy katmanı; secrets ayrımı; log redaksiyonu; token'ın sandbox'a girmemesi; retention matrisi |
| 7 | **Model sağlayıcı bağımlılığı / API değişimi** (fiyat artışı, davranış kayması, deprecation) | 3 | 3 | Gateway soyutlaması; 2+ sağlayıcı ilk günden; eval'lerle davranış kayması erken tespiti; fallback |
| 8 | **Rate limit / kapasite** (sağlayıcı 429'ları büyümeyi boğar) | 3 | 3 | Global token-bucket, çoklu sağlayıcı yayılımı, BYOK (kullanıcı kendi kotasını getirir) |
| 9 | **Rekabet penceresi**: Cursor/Claude Code/Copilot çoklu-agent + timeline özelliklerini yerleşik hale getirir | 4 | 4 | Hız + niş odak (mission control UX + cross-model); tek-model oyuncuların yapamayacağı "provider-tarafsızlık" konumu; gerekirse bu araçların *üstünde* orkestrasyon katmanı olmaya pivot |
| 10 | **Kullanıcı karmaşıklığı**: "3 agent + plan onayı" vibe coder'a fazla gelir | 3 | 4 | Varsayılan tek-tık akış (agent'lar perde arkası), detay isteyene; onboarding'de tek örnek görev |
| 11 | **Vendor lock-in (kendi tedarikçilerimiz)**: E2B/OpenRouter/Clerk gibi bağımlılıklar | 2 | 3 | Her kritik bağımlılık arayüz arkasında; sandbox/gateway soyut |
| 12 | **Model kalite değişimi** (sessiz güncelleme sonrası davranış bozulması) | 3 | 3 | Model sürüm sabitleme (dated snapshots); nightly eval; sürüm geçişleri kontrollü |
| 13 | **Birim ekonomi**: kullanıcı başına COGS tahminlerin 2×'i | 3 | 4 | §19 telemetri ilk günden; kredi sistemi COGS'a endeksli; ucuz-model kademelendirme |
| 14 | **Güven krizi**: tek kötü otomatik-fix deneyimi (yanlış kod push) viral olumsuzluk yaratır | 2 | 4 | Auto-merge asla yok; PR-only teslim; muhafazakâr varsayılanlar |
| 15 | **Tek kurucu / küçük ekip yürütme riski**: kapsam bu plan için bile geniş | 4 | 4 | Fazlar kesin sınırlı; Faz 1 dikeyi bitmeden hiçbir yatay genişleme yok |
| 16 | **Yasal/uyumluluk**: kullanıcı repo'sundaki lisanslı/3. taraf kod, üretilen kodun sorumluluğu | 2 | 3 | ToS netliği; kod sahipliği kullanıcıda; DMCA süreci |
| 17 | **GitHub API bağımlılığı** (izin modeli/limit değişiklikleri) | 2 | 3 | GitHub App best-practice; git-protokol seviyesi işlemler mümkün olduğunca standart git |

---

## 21. SONUÇ — Karar Bölümü

**PRODUCT VERDICT**
Yapılmaya değer — **şartlı**. Boşluk gerçek (görünür, çoklu-model, recovery-odaklı mission control tüketici ürünü yok), ama iki ölümcül belirsizlik var: agent görev-başarı oranı (R1) ve cross-model recovery hipotezi (V3/R2). Plan bu ikisini ilk 3 fazda ölçülebilir kılıyor; 4. fazın sonunda veriler zayıfsa observe+kontrol eksenine pivot net biçimde tanımlı. "Çoklu-AI erişimi" olarak asla konumlandırılmamalı.

**MVP**
§5.1'deki 7 özellik: GitHub App entegrasyonu, 3 konfigüre-rol (Manager/Developer/Reviewer-Debugger), insan-onaylı plan ile async mission, timeline (özet+derinleşme), hata yakalama+Explain, Fix&Retest (limitli), 2 sağlayıcı + BYOK. Tam otonomi yok, auto-merge yok, 4+ agent yok.

**DIFFERENTIATION**
(1) Görünür ve müdahale-edilebilir orkestrasyon (kapalı-kutu otonom rakiplerin tersi), (2) çapraz-model Error→Explain→Fix döngüsü birinci sınıf UI nesnesi olarak, (3) maliyet şeffaflığı + sert bütçe kapıları, (4) provider-tarafsızlık (tek-model devlerinin yapısal olarak kopyalayamayacağı tek özellik). Model sayısı ve agent sayısı farklılaşma değildir.

**TECHNICAL FEASIBILITY**
Yapılabilir. Hiçbir bileşen araştırma-seviyesi değil; OpenHands/Claude Code benzerleri fizibiliteyi kanıtlıyor. Zorluk icat değil **disiplin**: idempotent orkestrasyon, limit enforcement, izolasyon. En belirsiz mühendislik alanı sandbox+git+server-side-token akışı (Faz 1'in odağı olması bu yüzden).

**BIGGEST TECHNICAL RISK**
Güvenilir, maliyet-sınırlı agent yürütme döngüsü: runaway/loop/maliyet kontrolünün *gerçekten* su geçirmez olması ve buna rağmen görev başarı oranının satılabilir seviyede kalması. (İkincisi: prompt injection'ın tool-izin katmanıyla sınırlanması — çözülmez, yönetilir.)

**BIGGEST BUSINESS RISK**
Tek-model devlerinin (Cursor, Claude Code, Copilot) dağıtım gücüyle "yeterince iyi" multi-agent + görünürlük sunarak pencereyi kapatması; ikinci sırada birim ekonomi (COGS/kullanıcı beklenenin 2×'i çıkarsa fiyatlama sıkışır).

**RECOMMENDED STACK**
Next.js + TypeScript (FE) · Fastify + TypeScript (API) · in-house ince Orchestrator/Agent-loop (framework'süz; Temporal'a geçiş yolu açık) · Postgres 16 (+RLS, event tablosu) · Redis + BullMQ · S3/R2 · E2B (sandbox, soyut arayüz arkasında) · in-house Model Gateway (Anthropic + OpenAI adapter, BYOK; OpenRouter opsiyonel adapter) · GitHub App · OpenTelemetry + Sentry + Grafana Cloud · Deploy: Fly.io/Render → ileride AWS.

**DEVELOPMENT ORDER**
1) Faz 0: iskelet + event/SSE/timeline temeli → 2) Faz 1: **tek-agent dikey dilim** (GitHub→sandbox→patch→test→PR) — her şeyden önce bu → 3) Faz 2: Manager+Reviewer orkestrasyonu + plan kapısı → 4) Faz 3: Explain/Fix/Retest + limit sertleştirme + eval → 5) Faz 4: faturalama+onboarding+beta launch → 6) veriye göre Faz 5/6. İlke: dikey dilim bitmeden yatay genişleme yasak.

**WHAT NOT TO BUILD (şimdilik kesinlikle)**
Özel agent tanımlama/marketplace · 4+ agent rolü · tam otonom mod ve auto-merge · browser/computer-use · paralel-yazan agent'lar (worktree orkestrasyonu) · GitLab/Jira/Slack entegrasyonları · kendi eval/prompt-yönetim ürünü · public API/SDK · akıllı otomatik model routing · mobil · on-prem/enterprise güvenlik paketi (Faz 6'ya kadar) · kendi Firecracker filosu · chat-first genel asistan arayüzü.

---

*Bu doküman bir plan olup kod içermez. Sayısal tahminler (maliyet, süre, oranlar) açıkça varsayım olarak işaretlenmiştir ve uygulama sırasında ölçümle güncellenmelidir.*
