# Mission Control

AI Agent Workspace / Mission Control. Plan: [`docs/MASTER_PLAN.md`](../docs/MASTER_PLAN.md) · Faz 1a: [`docs/PHASE_1A_PLAN.md`](../docs/PHASE_1A_PLAN.md)

**Durum: Faz 1a tamamlandı.** Bir agent, sandbox'a alınmış gerçek bir projede bug'ı bulup düzeltiyor, testleri koşuyor ve tüm süreç ölçülmüş gerçeklerle timeline'a akıyor.

## Yapı

```
packages/core      # alan-bağımsız çekirdek: event şeması v1, mission state machine, bütçe devre kesici
packages/gateway   # Model Gateway: rol alias'ı → adapter, maliyet muhasebesi, Anthropic + mock adapter
packages/sandbox   # SandboxProvider soyutlaması + LocalProcessSandbox (yalnızca geliştirme)
packages/tools     # tool registry + rol izin matrisi (repo.read / repo.write / shell.run)
packages/runtime   # agent tool-use döngüsü, verification runner, mission orchestrator, eval harness
apps/api           # Fastify + SSE + iki katmanlı timeline arayüzü
fixtures/golden/   # 10 senaryoluk golden set (bilinen kusur sınıfları)
```

### Taşıyıcı sözleşmeler

- **Event şeması v1** (`packages/core/src/events.ts`): `aiSummary` (agent beyanı, doğrulanmaz) ile `facts` (yalnızca platform kodu yazar: dosya/satır/komut/süre/maliyet/test) ayrıdır. Agent kaynaklı event üretmenin tek yolu `agentEventInput()`tur ve `facts`'i tip + çalışma anı düzeyinde ayıklar.
- **Provider bağımsızlığı** (`packages/gateway`): çekirdek kod hiçbir yerde model ID'si görmez; roller `"developer-default"` gibi alias'lara bağlanır.
- **İzinler tool katmanında** (`packages/tools/src/policy.ts`): prompt'ta değil. Yetkisiz tool modele hiç gösterilmez.
- **Limitler kodda** (`packages/runtime/src/agentLoop.ts`): bütçe çağrıdan önce rezerve edilir, tur/süre/thrashing sınırları modelden bağımsız uygulanır.

## Çalıştırma

```bash
cd mission-control
npm install
npm run typecheck
npm test          # 66 test (unit + integration + E2E), gerçek model gerektirmez
npm run eval      # golden set'i koşar, eval-report.md üretir
npm run dev       # http://localhost:3000
```

`npm run eval` 10 senaryoluk golden set'i çalıştırır ve başarı oranı, tur sayısı,
maliyet ve süreyi raporlar. Rapor sürücüyü (`mock` / `live:<model>`) en üstte
belirtir — **mock sürücüyle çıkan oran harness'ın doğruluğunu gösterir, model
yeteneğini değil.** Senaryo listesi: [`fixtures/golden/README.md`](fixtures/golden/README.md).

Arayüzde bir proje ve hedef seçip Start'a basın. Sağ üstteki rozet hangi modda olduğunuzu gösterir:

| Rozet | Anlamı |
|---|---|
| `mock model` | `ANTHROPIC_API_KEY` yok — agent döngüsünü senaryolu bir vekil model sürüyor |
| `live · <model>` | Gerçek model çağrıları yapılıyor ve ücretlendiriliyor |

Gerçek modelle çalıştırmak için:

```bash
ANTHROPIC_API_KEY=... npm run dev     # arayüz
ANTHROPIC_API_KEY=... npm test        # canlı smoke testi de koşar (yoksa atlanır)
```

## ⚠️ Sandbox izolasyonu

`LocalProcessSandbox` komutları host üzerinde normal bir çocuk süreç olarak çalıştırır. **Ağ izolasyonu, dosya sistemi izolasyonu ve kaynak sınırı yoktur**; tek koruma workspace'e yol hapsi ve süre limitidir. Bu yüzden yalnızca `fixtures/golden/` altındaki güvenilen projeler çalıştırılabilir ve arayüz keyfi proje yüklemesine izin vermez. Kullanıcı projesi kabul edilmeden önce izolasyonlu bir sandbox (Docker / E2B) zorunludur — bkz. `docs/PHASE_1A_PLAN.md` §5 ve §9.

## Sırada ne var (Faz 1b)

Golden set'in 10 senaryoya çıkarılması ve gerçek modelle başarı oranı ölçümü, izolasyonlu sandbox, ardından GitHub App + server-side git + PR açma.
