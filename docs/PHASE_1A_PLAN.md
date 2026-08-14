# Faz 1a — Çekirdek Agent Dikeyi (uygulama planı ve sonuç)

> Üst plan: [`MASTER_PLAN.md`](./MASTER_PLAN.md) §17 (roadmap) ve §21 (development order).
> **Faz 1a'nın tek sorusu:** *"Agent bir görevi baştan sona gerçekten tamamlayabiliyor mu, hangi maliyetle?"* — GitHub auth/izin karmaşıklığı bu cevabı maskelemeden.

## 1. Kapsam

**Girer:** proje ingest → sandbox workspace → Model Gateway (Anthropic adapter + deterministik mock) → Tool Runtime (izin kontrollü) → Developer agent tool-use döngüsü → verification (test koşumu) → diff artifact → timeline'da gerçek `facts`.

**Girmez (Faz 1b+):** GitHub App, server-side git, PR açma, Manager/Reviewer rolleri, plan onay kapısı, Explain/Fix döngüsü, ikinci sağlayıcı, kalıcı Postgres/Redis.

## 2. Paket düzeni

```
packages/core       # Faz 0 — alan-bağımsız çekirdek (event şeması, state machine, budget)
packages/gateway    # Model Gateway (§15): types, pricing, gateway, adapters/{anthropic,mock}
packages/sandbox    # SandboxProvider soyutlaması + LocalProcessSandbox (dev-only)
packages/tools      # Tool registry + rol izin matrisi (repo.read / repo.write / shell.run)
packages/runtime    # agentLoop + verification + missionRunner
apps/api            # Fastify + SSE + timeline; config.ts mod seçimi
fixtures/golden/    # py-auth-bug — ölçüm zemini
```

## 3. Model Gateway sözleşmesi

```
complete({ modelRef, system, turns, tools, maxTokens, effort })
  → { stopReason, text, toolCalls[], usage, costUsd, modelUsed, raw? }
```

- `modelRef` **rol alias'ıdır** (`"developer-default"`); somut model ID'si yalnızca konfigürasyonda geçer.
- Maliyet cache'i de sayar: `input·p_in + cache_write·p_in·1.25 + cache_read·p_in·0.10 + output·p_out`. Fiyatı bilinmeyen model **sessizce $0 sayılmaz**, hata fırlatır — aksi hâlde bütçe kontrolü delinirdi.
- `stop_reason === "refusal"` içerik okunmadan önce kontrol edilir; hata değil, beyan edilen bir sonuçtur.
- `temperature`/`top_p`/`top_k` gönderilmez, `budget_tokens` kullanılmaz (5-ailesinde 400 döner); derinlik `effort` ile.
- Asistan turunun ham block'ları opak `raw` alanında taşınır — çekirdek incelemez, adapter aynen geri oynatır (reasoning block'larını düşürmek sonraki istekte sıra/imza hatası doğurabilir).
- Geçici hata (429/5xx/bağlantı) exponential backoff ile yeniden denenir; **kalite hatası retry edilmez** — o recovery döngüsünün konusudur.

**MockProvider birinci sınıf bileşendir**, sonradan eklenmiş bir test kancası değil: CI'da API anahtarı yoktur ve limit/hata davranışları ancak deterministik bir modelle güvenilir test edilir. "Gerçek model çalıştı" iddiası yalnızca `live.test.ts`'ten gelir.

## 4. İzin modeli

Yetki **prompt'ta değil tool katmanında** yaşar: prompt injection ile ele geçirilen agent bile burada tanımsız bir şey yapamaz.

| Rol | Tool'lar | Komutlar |
|---|---|---|
| manager | repo.read | — |
| developer | repo.read, repo.write, shell.run | pytest, python(3), npm, node, git |
| reviewer / debugger | repo.read, shell.run | aynı allowlist (kod yazamaz) |

Yetkisiz tool modele **hiç gösterilmez**; yine de çağrılırsa istisna değil, `is_error` tool sonucu döner — döngü kırılmaz, model başka yol dener. Kabuk metakarakterleri (`;`, `&&`, `|`, `$()`, backtick, yönlendirme) reddedilir.

## 5. Sandbox — açık risk beyanı

`LocalProcessSandbox` **izolasyon sağlamaz**: ağ kapalı değil, dosya sistemi kısıtı OS düzeyinde değil, kaynak sınırı yok. Sağladığı tek koruma workspace'e yol hapsi (traversal + mutlak yol reddi) ve süre limitidir.

Bu yüzden Faz 1a yalnızca **güvenilen** golden fixture'ları çalıştırır. Kullanıcı yüklü projesi çalıştırılmadan önce izolasyonlu implementasyon (Docker / E2B / Firecracker) **zorunludur**. Arayüz de bu kısıtı yansıtır (§9'daki sapma notu).

## 6. Agent döngüsü ve limitler

```
bütçe rezerve (çağrı ÖNCESİ) → model çağrısı → gerçek maliyetle mutabakat
→ execution.step (ölçülmüş facts) → refusal? → tool_use değilse bitir
→ tool çağrıları policy'den geçer → sonuçlar TEK turda geri → tekrar
```

| Limit | Değer | Davranış |
|---|---|---|
| Bütçe | mission başına $ tavanı | Tavanı aşacak çağrı **hiç yapılmaz** |
| Tur | varsayılan 12 model çağrısı | `max_rounds` ile durur |
| Duvar-saat | görev başına 30 dk | `AbortController` ile iptal |
| Thrashing | aynı tool + aynı argüman ×3 | Döngü kırılır |

## 7. Verification ve ölçüm

`detectVerification` proje tipini dosyalardan tespit eder (uydurmaz; bulamazsa `inconclusive`). Sonuç çıkış kodundan ve özet satırından **ölçülür**, agent beyanından değil. Değişim sayıları `git diff --numstat`'tan gelir; derleme/test artefaktları (`__pycache__`, `node_modules`, …) `.git/info/exclude` ile dışarıda tutulur — "14 dosya değişti" kullanıcıya gösterilen bir gerçek, çöp sayımı değil.

## 8. Test durumu (49 test, tümü yeşil)

| Katman | Kapsam |
|---|---|
| Unit | maliyet (cache dahil), bilinmeyen fiyat reddi, izin matrisi, metakarakter reddi, yol hapsi, süre limiti, diffStat |
| Integration | tool kullanıp tamamlama, bütçe tavanı (çağrı yapılmadan), tur limiti, thrashing, refusal, yetkisiz çağrı, retry tükenmesi |
| E2E | golden fixture: baseline 2/2 kırmızı → agent → 4/0 yeşil, diff ölçülmüş; **ve** agent düzeltemezse mission'ın "başarılı" ilan edilmediği senaryo |
| Canlı smoke | `ANTHROPIC_API_KEY` varsa gerçek model; yoksa **atlanır** (sessizce "geçti" sayılmaz) |

## 9. Uygulamada plandan sapmalar (ve gerekçeleri)

1. **Zip upload yerine proje seçimi.** Plan zip ingest öngörüyordu. Uygulamada `PROJECTS_ROOT` altındaki güvenilen projelerin seçimi yapıldı. Gerekçe: `LocalProcessSandbox` izolasyon sağlamıyor; keyfi kullanıcı zip'ini kabul etmek, izolasyonsuz ortamda güvenilmeyen kod çalıştırmaya davet olurdu — kendi risk beyanımızla çelişirdi. **Zip upload, izolasyonlu sandbox ile birlikte Faz 1b'de gelir.** API tarafında yol çözümü kök dışına çıkışı reddeder.
2. **Mod rozeti eklendi (planda yoktu).** Arayüz `live · <model>` veya `mock model` rozetiyle hangi modun çalıştığını açıkça gösterir. Gerekçe: mock ile üretilmiş bir timeline'ın gerçek model çalışmışçasına sunulması, ürünün tüm güven iddiasını (§7) çürütürdü.
3. **Anthropic SDK sürümü.** İlk kurulumda `^0.68` (0.x semantiği minor'ı kilitliyor) adaptive thinking/effort tiplerini içermiyordu; `^0.117` ile güncellendi.
4. **pytest sistem bağımlılığı.** Golden fixture'ın koşması için `pytest` gerekir. CI'da kurulum adımı olarak eklenmeli; `detectVerification` bulunamayan test setini `inconclusive` işaretler, sessizce "0 hata" demez.

## 10. Faz 1a'nın kapanış durumu ve devam kriteri

Tamamlanma kriteri **karşılandı**: golden fixture'daki bug, proje seçimi → sandbox → agent → verification → diff akışıyla düzeliyor; timeline gerçek ölçülmüş facts gösteriyor; maliyet kaydı doğru (mock koşusunda $0.0315).

**Henüz cevaplanmayan asıl soru:** gerçek modelin bu görevleri hangi başarı oranıyla tamamladığı. Mock koşusu döngünün doğruluğunu kanıtlar, model yeteneğini değil. Faz 1b'ye geçmeden önce:

1. Golden set 10 senaryoya çıkarılmalı (§21'in açık maddesi).
2. `ANTHROPIC_API_KEY` ile canlı ölçüm yapılmalı; öneri eşiği: **10 senaryonun ≥6'sı** gerçek modelle yeşile dönüyorsa devam.
3. İzolasyonlu sandbox (Docker adapter) — kullanıcı projesi kabul edilmeden önce.
