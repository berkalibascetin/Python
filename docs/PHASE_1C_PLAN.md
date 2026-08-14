# Faz 1c — Güvenli Proje Ingest + Disk Kotası + Canlı Model Doğrulaması

> Üst plan: [`MASTER_PLAN.md`](./MASTER_PLAN.md) · Önceki fazlar: [1a](./PHASE_1A_PLAN.md) · [1b](./PHASE_1B_PLAN.md)

# PHASE 1C RESULT

## 1. Ne yapıldı?

Faz 1b izole yürütmeyi getirdi ama sisteme yalnızca *bizim* fixture'larımız girebiliyordu ve workspace disk kotası açık bir eksikti. Faz 1c bu ikisini kapattı ve gerçek model ölçümünün önündeki tüm teknik engelleri kaldırdı:

1. **Güvenli ZIP ingest** — kullanıcı arşivi tamamen güvenilmez girdi olarak işlenir.
2. **Workspace disk kotası** — çekirdek tarafından uygulanan gerçek kota.
3. **Benchmark altyapısı** — metrikler, failure taksonomisi, mock/live ayrı raporlar.
4. **Sır redaksiyonu** — anahtarların timeline'a kalıcı yazılmaması.

**Canlı Anthropic benchmark'ı KOŞULMADI** — ortamda `ANTHROPIC_API_KEY` yok (§8). Anahtarsız yapılabilecek her iş tamamlandı; canlı ölçüm tek komutla koşacak durumda.

## 2. Hangi dosyalar değişti?

| Dosya | Değişiklik |
|---|---|
| `packages/ingest/src/limits.ts` | **yeni** — konfigüre edilebilir limitler + red sebepleri taksonomisi |
| `packages/ingest/src/paths.ts` | **yeni** — yol güvenliği (traversal, mutlak, ters bölü, derinlik, uzunluk) |
| `packages/ingest/src/extractZip.ts` | **yeni** — akış sırasında sayan güvenli çıkarma |
| `packages/ingest/test/adversarial.test.ts` | **yeni** — 16 saldırı testi |
| `packages/sandbox/src/quota.ts` | **yeni** — loopback ext4 kota + advisory fallback |
| `packages/sandbox/src/docker.ts` | kota entegrasyonu, advisory disk izleyici, `quotaMode` |
| `packages/sandbox/src/types.ts` | `workspaceMb` limiti, `disk` limit türü, `quotaMode` |
| `packages/sandbox/test/diskQuota.test.ts` | **yeni** — 5 kota testi (host koruması ölçülüyor) |
| `packages/core/src/redact.ts` | **yeni** — sır redaksiyonu |
| `packages/core/test/redact.test.ts` | **yeni** — 5 test |
| `packages/runtime/src/agentLoop.ts` | model çıktısı timeline'a yazılmadan önce redaksiyon |
| `packages/runtime/src/eval.ts` | metrikler, failure sınıflandırma, eşik yorumu, genişletilmiş rapor |
| `packages/runtime/src/evalCli.ts` | mock/live **ayrı rapor dosyaları** |
| `packages/runtime/test/evalMetrics.test.ts` | **yeni** — 9 metrik/sınıflandırma testi |
| `apps/api/src/server.ts` | `POST /missions/upload` — güvenli ingest + untrusted mission |

Değiştirilmeyenler (bilinçli): `SandboxProvider` sözleşmesi, Model Gateway, verification, timeline facts modeli, negatif kontroller, golden set içeriği.

## 3. ZIP güvenliği nasıl sağlandı?

**Temel ilke: arşiv başlığındaki hiçbir sayıya güvenilmez.** `uncompressedSize` saldırgan tarafından yazılır; küçük boyut beyan edip gigabaytlar akıtan bir bomba başlık kontrolünü geçer. Bu yüzden bütün boyut limitleri **veri akarken, gerçek bayt sayımıyla** uygulanır ve limit aşılınca akış o anda kesilir.

| Saldırı | Savunma |
|---|---|
| `../` traversal | Yol bileşenlerinde `..` reddi + normalize sonrası kontrol + ayrıştırıcının kendi doğrulaması |
| Mutlak yol | POSIX `/` ve Windows `C:\`, `\\sunucu` biçimleri reddi |
| Ters bölü kaçışı | `\` içeren girdi adı reddi (POSIX'te ayırıcı değil, sessizce dosya adına dönüşmemeli) |
| Sembolik bağ | Unix mode bitlerinden tür tespiti; symlink girdisi **hiç oluşturulmaz** |
| Özel dosya (fifo/aygıt/soket) | Yalnızca normal dosya ve dizin kabul edilir |
| Zip bomb | Akış sırasında toplam bayt + dosya başı bayt + sıkıştırma oranı tavanı |
| Aşırı dosya sayısı | `maxEntries` |
| Aşırı derinlik | `maxDepth` |
| Uzun yol | Bileşen ve toplam uzunluk tavanı |
| Çıkarma süresi | Girdi başına ve akış içinde deadline kontrolü |
| Yarım çıkmış artık | Red hâlinde geçici kök tamamen silinir |

**Hardlink hakkında dürüst not:** ZIP formatında hardlink diye ayrı bir girdi türü **yoktur**; bazı araçlar hardlink'i normal dosya olarak saklar. Bu yüzden "hardlink saldırısını engelliyoruz" demek yanıltıcı olurdu. Bunun yerine temsil edilebilen her düzensiz tür (symlink, fifo, aygıt, soket) reddedilir.

**İç içe arşivler** özyinelemeli olarak **açılmaz**; içerideki bir arşiv sıradan bir dosyadır ve aynı boyut limitlerine tabidir. Agent'ın onu açması da mümkün değildir (`unzip` komut allowlist'inde yok).

## 4. Disk kotası nasıl sağlandı?

### Önce ölçtük: `--storage-opt` bu ortamda SAHTE kota

Docker `--storage-opt size=` bayrağını overlayfs sürücüsünde **sessizce yok sayıyor**. Ölçüm: `--storage-opt size=64m` ile başlatılan container **300 MB yazdı**, hiçbir hata almadı. Bu mekanizmayı kota diye sunmak, olmayan bir korumayı varmış gibi göstermek olurdu — bu yüzden kullanılmadı.

### Gerçekten uygulanan: loopback ext4

Workspace, sabit boyutlu bir ext4 imajı üzerine bağlanır. Limit çekirdek tarafından uygulanır; taşan yazma **ENOSPC** alır ve host diskinde ayrılan yer imaj boyutuyla sınırlı kalır.

Ölçülen sonuç (test `(11)`): 16 MB kotalı workspace'e 400 MB yazmayı deneyen container `errno 28` aldı, **host disk büyümesi 100 MB'ın altında** kaldı; `destroy()` sonrası host kullanımı başlangıç seviyesine döndü (artık < 20 MB).

### Neyi sınırlayabildiğimiz — kapsam tablosu

| Yüzey | Durum |
|---|---|
| Workspace (bind mount) | ✅ Çekirdek kotası (loop modu) |
| `/tmp` (container içi) | ✅ tmpfs `size=` ile sınırlı, `noexec` |
| Container yazılabilir katmanı | ✅ Gerek yok — rootfs `--read-only` |
| stdout/stderr | ✅ Akışta bayt sayımı + kill |
| Bellek / CPU / PID | ✅ Faz 1b'den |
| **Loop cihazı yoksa (macOS, root olmayan host)** | ⚠️ `advisory` moda düşer: 1 sn'de bir ölçüm + kill. **Çekirdek garantisi değildir** ve `quotaMode` alanında açıkça bildirilir |

## 5. Hangi adversarial testler eklendi?

**Ingest (16):** zararsız arşiv temel kontrolü · `../` traversal · mutlak yol · symlink girdisi · symlink üzerinden yazma · özel dosya · zip bomb · yalancı başlık boyutu · aşırı dosya sayısı · aşırı derinlik · sıkıştırma oranı · çıkarma süresi · aşırı arşiv boyutu · red sonrası artık bırakmama · ters bölü kaçışı · boş arşiv.

**Disk kotası (5):** kota modunun gerçekten `loop` olması · container'ın host diskini tüketememesi (host büyümesi ölçülüyor) · temizlik sonrası diskin geri gelmesi · normal projenin etkilenmemesi · stdout tükenmesinin ayrı çalışması.

**Sır redaksiyonu (5):** anahtar biçimleri · ortamdaki gerçek anahtar · GitHub/bearer · normal kodu bozmama · kısa değerlerde yanlış pozitif olmaması.

Her testte iddia "istisna fırlatıldı" değil, **saldırının sonuç üretmediği**: host'ta dosya oluşmadığı, disk şişmediği, artık kalmadığı.

## 6. Regression sonucu

Üç ardışık tam koşu, hepsi aynı:

```
TOPLAM                       143/143  ✅  (+1 canlı model testi atlandı)
├── Faz 1a mevcut             66/66   ✅  değişmedi
├── Faz 1b docker (arg+adv+E2E) 42/42 ✅  değişmedi
├── Faz 1c ingest             16/16   ✅  yeni
├── Faz 1c disk kotası         5/5    ✅  yeni
├── Faz 1c redaksiyon          5/5    ✅  yeni
└── Faz 1c metrik/sınıflandırma 9/9    ✅  yeni

Golden eval (docker sandbox): 10/10  ✅
Golden eval (local sandbox):  10/10  ✅
```

**Negatif kontroller korundu:** no-op agent, testleri düzeltmeyen agent ve çalışan projeyi bozan agent hâlâ SUCCESS sayılmıyor — üstelik artık `no_change_attempted`, `verification_failure`, `wrong_edit` olarak **sınıflandırılıyorlar**. `INCONCLUSIVE ≠ 0 failed` ayrımı hem local hem Docker yolunda test ediliyor.

## 7. Mock benchmark sonucu

```
DRIVER: mock
Sandbox: docker
Result: 10/10 (%100)
Assessment: Strong signal
Average rounds: 3.9
Average cost: $0.0246
Total cost: $0.2457
Cost per successful mission: $0.0246
```

> ⚠️ **Mock score ≠ model capability.** Bu sayı harness'ın ve agent döngüsünün doğruluğunu gösterir; modelin bu bug'ları bulabildiğini **göstermez**.

## 8. Live Anthropic benchmark sonucu

**KOŞULMADI — `ANTHROPIC_API_KEY` ortamda yok.**

Talimat gereği implementasyon veya testler bunun için bloke edilmedi; anahtarsız yapılabilecek her iş tamamlandı. Canlı ölçüm için gereken tek şey:

```bash
ANTHROPIC_API_KEY=... npm run eval      # → eval-report-live.md
```

Sürücü enjeksiyonu değişmedi (`makeGateway(mock)` ↔ `makeGateway(anthropic)`), aynı golden set, aynı Docker sandbox, tüm limitler aktif. Rapor **ayrı dosyaya** yazılır ki mock sonucunun üzerine yazıp onu model yeteneği gibi göstermesin.

Canlı koşuda aktif kalan korumalar: mission bütçesi, tur limiti, süre limiti, tool izinleri, sandbox kısıtları, cleanup, sır redaksiyonu.

## 9. Failure analysis

Canlı koşu olmadığı için gerçek başarısızlık verisi **yok**. Ancak taksonomi ve sınıflandırma mantığı kuruldu ve test edildi:

`verification_failure` · `no_change_attempted` · `wrong_edit` · `tool_misuse` · `budget_exhaustion` · `round_limit` · `thrashing` · `timeout` · `model_refusal` · `provider_error` · `sandbox_failure` · `unverifiable` · `harness_error` · `other`

Rapor, başarısızlıkları sınıf bazında gruplayıp senaryo bazında ayrıntı tablosu üretir. Canlı koşuda hangi katmanın (prompt, tool arayüzü, context yönetimi, model seçimi) iyileştirileceği bu tablodan okunacak.

## 10. Toplam API maliyeti

**$0.00** — hiçbir gerçek model çağrısı yapılmadı. Mock koşusundaki $0.2457 rakamı, mock adapter'ın ürettiği sentetik token sayılarının fiyat tablosuyla çarpımıdır; gerçek harcama değildir.

## 11. SECURITY ASSUMPTIONS

Sistemin doğru çalışması için **doğru kabul ettiğimiz** önermeler. Biri yanlışsa güvenlik modeli zayıflar:

1. Host çekirdeği ve Docker daemon'ı güvenilirdir ve yamalıdır.
2. Sandbox image'ı güvenilir bir kaynaktan gelir ve kurcalanmamıştır (imza doğrulaması **yok**).
3. Platform sürecini çalıştıran kullanıcı güvenilirdir; Docker daemon erişimi olan herkes host'u ele geçirebilir.
4. Model sağlayıcısı, gönderilen içeriği sözleşmesine uygun işler.
5. `mission-control` sürecinin kendi belleği güvenlidir (API anahtarı orada tutulur).
6. Loop modunda çekirdek dosya sistemi kotası doğru uygular.

## 12. TRUST BOUNDARY

```
┌─ GÜVENİLİR ────────────────────────────────────────────────┐
│  Platform süreci (Node)                                     │
│   ├── API anahtarı (bellek; container'a asla girmez)        │
│   ├── Tool policy · bütçe · limitler                        │
│   ├── git ölçümü (GIT_DIR, mount DIŞINDA)                   │
│   └── Ingest doğrulaması                                    │
└─────────────────────────────────────────────────────────────┘
              │ yalnızca: workspace bind mount + komut satırı
              ▼
┌─ GÜVENİLMEZ ───────────────────────────────────────────────┐
│  Container (ağsız, salt-okunur rootfs, non-root, kotalı)    │
│   └── Kullanıcı projesi kodu + test setleri                 │
└─────────────────────────────────────────────────────────────┘

┌─ GÜVENİLMEZ GİRDİ ─────────────────────────────────────────┐
│  Yüklenen ZIP · proje dosya içerikleri · test çıktıları     │
│  · model yanıtları (prompt injection taşıyabilir)           │
└─────────────────────────────────────────────────────────────┘
```

Sınırı geçen tek şeyler: workspace dosyaları (platform yazar/okur), komut satırı (allowlist'ten geçer), çıktı (bayt sınırlı, redaksiyondan geçer).

## 13. SECURITY LIMITATIONS

Faz 1b'den devam eden ve Faz 1c'de **çözülmeyen** riskler:

1. **Paylaşılan çekirdek.** Docker VM seviyesi izolasyon vermez; çekirdek açığı bu katmanı geçersiz kılar. Gelecek seçenek: **E2B / Firecracker / gVisor** ile VM-seviyesi sandbox.
2. **User namespace remapping yapılandırılmadı.** Non-root çalışıyoruz ama `userns-remap` kurulmadı.
3. **Özel seccomp/AppArmor profili yok.** Docker'ın varsayılanına güveniliyor.
4. **Workspace `noexec` değil** — proje kendi çalıştırılabilirini koşabilsin diye; bilinçli işlevsellik ödünü.
5. **Global kabul kontrolü yok.** Container başına limit var, eşzamanlı mission sayısı için host düzeyinde kota yok.
6. **Yan kanallar** (zamanlama, önbellek) ele alınmadı.
7. **Image provenance doğrulanmıyor.**
8. **Model üzerinden veri sızıntısı.** Ağ kapalı olsa da agent, okuduğu dosya içeriğini model çağrısına koyar. Prompt injection ile hassas içerik model sağlayıcısına ya da üretilen diff'e taşınabilir. Redaksiyon bilinen anahtar biçimlerini yakalar; **genel veri sızıntısını çözmez.**
9. **Advisory kota modu** (loop yoksa) çekirdek garantisi değildir; 1 saniyelik ölçüm penceresi içinde taşma mümkündür.
10. **Registry tabanlı image yolu bu ortamda test edilemedi** (proxy Docker Hub CDN'ini engelliyor); image host rootfs'inden üretildi ve geniş bir yüzey içeriyor.

## 14. Manager'a geçmek için hazır mıyız?

**HAYIR — bir kriter eksik.** Faz 1c'nin §13 kontrol listesi:

| Kriter | Durum |
|---|---|
| 1. Secure ingest çalışıyor | ✅ |
| 2. Disk quota çalışıyor | ✅ |
| 3. Existing tests yeşil | ✅ 143/143 |
| 4. Security tests yeşil | ✅ |
| 5. Golden eval çalışıyor | ✅ |
| 6. **Gerçek model benchmark'ı tamamlandı** | ❌ **anahtar yok** |
| 7. Failure modes anlaşılmış | ❌ (6'ya bağlı) |

Manager/Reviewer eklemek **önerilmiyor**. Gerekçe kendi planımızda yazılı: Manager, Developer Agent'ın tek başına yeterince güvenilir olmadığını *örtmek* için kullanılmamalı. Developer'ın gerçek modelle başarı oranını bilmeden ikinci bir agent eklemek, ölçemediğimiz bir sorunun üstüne karmaşıklık koymak olur.

**Tek eksik adım:** `ANTHROPIC_API_KEY=... npm run eval`. Sonuç bandına göre:

- **8–10 (Strong signal):** Faz 2 orkestrasyonuna geçilebilir.
- **6–7 (Promising):** Önce prompt/context/tool arayüzü iterasyonu; golden set **değiştirilmez**.
- **0–5:** Manager'a geçilmez; failure sınıflarına göre kök neden çalışması yapılır.

Golden set sabit kalacaktır — sonucu güzelleştirmek için senaryo değiştirilmez.
