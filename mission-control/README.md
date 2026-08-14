# Mission Control — Faz 0 iskeleti

AI Agent Workspace / Mission Control ürününün Faz 0 dikeyi. Plan: [`docs/MASTER_PLAN.md`](../docs/MASTER_PLAN.md).

**Faz 0 tamamlanma kriteri (plan §17):** "sahte agent bir event yazar, timeline'da canlı görünür" — bu repo tam olarak bunu yapar: model çağrısı yok, gerçek altyapı (Postgres/Redis) yok; event sözleşmesi, state machine, bütçe devre kesici ve SSE→timeline dikeyi var. Faz 1a'da sahte Developer adımının içi gerçek agent döngüsüyle değişir; event sözleşmesi aynı kalır.

## Yapı

```
packages/core   # alan-bağımsız çekirdek (plan §11.4): event şeması v1, mission
                # state machine, budget devre kesici + fix-round/thrashing guard
apps/api        # Fastify: POST /missions (demo mission başlatır),
                # GET /missions/:id/events, GET /missions/:id/stream (SSE),
                # / (iki katmanlı timeline demo sayfası)
```

Çekirdek sözleşmeler:

- **Event şeması v1** (`packages/core/src/events.ts`): `aiSummary` (agent beyanı, doğrulanmaz) ile `facts` (yalnızca platform kodu yazar: dosya/satır/komut/süre/maliyet/test) ayrıdır. Agent kaynaklı event üretmenin tek yolu `agentEventInput()`tur ve `facts` alanını tip + çalışma anı düzeyinde ayıklar.
- **Mission state machine** (`mission.ts`): `created → planning → awaiting_approval → running → verifying → (recovering → running → verifying)* → completed`; geçersiz geçiş hatadır.
- **Bütçe devre kesici** (`budget.ts`): her harcama öncesi rezervasyon, sonrası mutabakat; tavan aşımı harcamadan önce engellenir. `FixRoundGuard` tur limiti + aynı hata imzasının tekrarında thrashing tespiti yapar.

## Çalıştırma

```bash
cd mission-control
npm install
npm test        # core testleri (vitest)
npm run dev     # http://localhost:3000 — hedef yaz, Start'a bas, timeline'ı izle
```

Demo mission, plan §6 referans akışını oynatır: plan → onay → değişiklik → verification kırmızı → cross-model Explain → fix turu → verification yeşil → teslim. "Advanced view" kutusu §5.4'teki opt-in detay görünümünü açar (model adları, token, maliyet).
