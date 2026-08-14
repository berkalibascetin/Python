# Mission Control

AI Agent Workspace / Mission Control. Plan: [`docs/MASTER_PLAN.md`](../docs/MASTER_PLAN.md) · [Faz 1a](../docs/PHASE_1A_PLAN.md) · [Faz 1b](../docs/PHASE_1B_PLAN.md)

**Durum: Faz 1b tamamlandı.** Bir agent, **izole bir container'da** çalışan güvenilmeyen bir projede bug'ı bulup düzeltiyor, testleri koşuyor ve tüm süreç ölçülmüş gerçeklerle timeline'a akıyor.

## Yapı

```
packages/core      # alan-bağımsız çekirdek: event şeması v1, mission state machine, bütçe devre kesici
packages/gateway   # Model Gateway: rol alias'ı → adapter, maliyet muhasebesi, Anthropic + mock adapter
packages/sandbox   # SandboxProvider soyutlaması + DockerSandbox (izole) + LocalProcessSandbox (dev)
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
npm test          # 108 test (unit + integration + E2E + adversarial), gerçek model gerektirmez
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

## Sandbox izolasyonu

İki sağlayıcı vardır ve seçim otomatiktir:

| Sağlayıcı | Güvenilmeyen kod | Kullanım |
|---|---|---|
| `DockerSandbox` | ✅ izole eder | Docker varsa **her zaman** tercih edilir |
| `LocalProcessSandbox` | ❌ izole etmez | Yalnızca `fixtures/golden/` altındaki kendi fixture'larımız |

Güvenilmeyen bir proje izolasyonsuz sağlayıcıya verilirse `UntrustedProjectError` fırlatılır — ve `trust` belirtilmezse proje **güvenilmez kabul edilir**, yani unutulan bir parametre izolasyonsuz çalıştırmaya düşmez.

Docker sandbox'ı hazırlamak:

```bash
scripts/build-sandbox-image.sh          # registry tabanlı (normal ortam)
scripts/build-sandbox-image.sh import   # kısıtlı ağ: host rootfs'inden üret
```

Container şu kısıtlarla koşar: ağ kapalı, salt-okunur rootfs, tüm capability'ler düşürülmüş, non-root kullanıcı, bellek/CPU/process/süre/çıktı limitleri, host env aktarımı yok, Docker socket yok. Workspace host'ta kalır ve git meta dizini container'a **mount edilmez** — böylece çalışan kod, kendi değişikliğinin ölçümünü kurcalayamaz.

> **Docker bir güvenlik sınırı garantisi değildir.** Paylaşılan çekirdek, disk kotası eksikliği ve diğer kalan riskler `docs/PHASE_1B_PLAN.md` → **SECURITY LIMITATIONS** bölümünde dürüstçe listelenmiştir.

## Sırada ne var

Kullanıcı yükleme akışı (güvenli zip ingest), workspace disk kotası, ardından Faz 2 orkestrasyonu (Manager rolü + insan plan onay kapısı). Gerçek modelle golden eval ölçümü anahtar sağlandığı anda tek komut.
