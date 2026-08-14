# Mission Control

AI Agent Workspace / Mission Control. Plan: [`docs/MASTER_PLAN.md`](../docs/MASTER_PLAN.md) · [Faz 1a](../docs/PHASE_1A_PLAN.md) · [Faz 1b](../docs/PHASE_1B_PLAN.md) · [Faz 1c](../docs/PHASE_1C_PLAN.md)

**Durum: Faz 1c tamamlandı.** Kullanıcı bir projeyi ZIP olarak yükleyebiliyor; arşiv güvenli şekilde çıkarılıyor, **izole ve disk kotalı bir container'da** agent bug'ı bulup düzeltiyor, testler koşuluyor ve süreç ölçülmüş gerçeklerle timeline'a akıyor.

> Gerçek model benchmark'ı henüz **koşulmadı** (API anahtarı yok). Tek komutla koşacak durumda: `ANTHROPIC_API_KEY=... npm run eval`

## Yapı

```
packages/core      # alan-bağımsız çekirdek: event şeması v1, mission state machine, bütçe devre kesici
packages/gateway   # Model Gateway: rol alias'ı → adapter, maliyet muhasebesi, Anthropic + mock adapter
packages/ingest    # güvenli ZIP çıkarma (traversal/symlink/bomb korumaları)
packages/sandbox   # SandboxProvider + DockerSandbox (izole, disk kotalı) + LocalProcessSandbox (dev)
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
npm test          # 143 test (unit + integration + E2E + adversarial), gerçek model gerektirmez
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

Container şu kısıtlarla koşar: ağ kapalı, salt-okunur rootfs, tüm capability'ler düşürülmüş, non-root kullanıcı, bellek/CPU/process/süre/çıktı limitleri **ve çekirdek tarafından uygulanan workspace disk kotası**, host env aktarımı yok, Docker socket yok. Workspace host'ta kalır ve git meta dizini container'a **mount edilmez** — böylece çalışan kod, kendi değişikliğinin ölçümünü kurcalayamaz.

> **Docker bir güvenlik sınırı garantisi değildir.** Paylaşılan çekirdek, model üzerinden veri sızıntısı ve diğer kalan riskler `docs/PHASE_1C_PLAN.md` → **SECURITY LIMITATIONS**, **SECURITY ASSUMPTIONS** ve **TRUST BOUNDARY** bölümlerinde dürüstçe listelenmiştir.

## Proje yükleme

```bash
curl -X POST "localhost:3000/missions/upload?goal=Fix%20the%20failing%20tests" \
  -H 'content-type: application/zip' --data-binary @project.zip
```

Arşiv tamamen güvenilmez kabul edilir: yol kaçışı, sembolik bağ, zip bomb, aşırı dosya/derinlik/boyut ve süre limitleri çıkarma sırasında uygulanır. Reddedilen yükleme **422** döner ve mission başlatmaz; izolasyonlu sandbox yoksa uç nokta **503** ile reddeder — izolasyonsuz kullanıcı kodu çalıştırılmaz.

## Sırada ne var

**Gerçek model benchmark'ı** (`ANTHROPIC_API_KEY=... npm run eval`). Sonuç 8–10 ise Faz 2 orkestrasyonuna (Manager + insan plan onay kapısı) geçilir; daha düşükse önce prompt/context/tool iterasyonu yapılır — golden set değiştirilmez.
