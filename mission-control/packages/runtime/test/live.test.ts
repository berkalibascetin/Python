import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "@mission-control/core";
import { AnthropicAdapter, ModelGateway } from "@mission-control/gateway";
import { LocalSandboxProvider } from "@mission-control/sandbox";
import { runMission } from "../src/index.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/golden/py-auth-bug",
);

/**
 * Canlı smoke testi — GERÇEK model çağrısı yapar.
 *
 * Neden ayrı ve koşullu: mock testlerin yeşil olması "agent döngüsü doğru"
 * demektir, "gerçek model bu bug'ı bulabiliyor" demek DEĞİLDİR. O iddiayı
 * yalnızca bu test kurabilir. Anahtar yoksa atlanır; sessizce "geçti" saymayız.
 *
 * Çalıştırmak için: ANTHROPIC_API_KEY=... npm test
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const model = process.env.MC_LIVE_MODEL ?? "claude-sonnet-5";

describe.skipIf(!hasKey)("canlı smoke: gerçek model golden fixture'ı düzeltiyor mu", () => {
  it(
    "gerçek model ile mission uçtan uca koşar",
    async () => {
      const events = new InMemoryEventStore();
      const result = await runMission({
        goal: "The authentication tests are failing. Find the bug and fix it.",
        sourceDir: FIXTURE,
        gateway: ModelGateway.fromRecord({
          "developer-default": new AnthropicAdapter(model),
        }),
        sandboxes: new LocalSandboxProvider(),
      trust: "trusted",
        events,
        budgetUsd: 1,
        maxRounds: 12,
      });

      // Bu testin amacı "model her zaman başarır" iddiası DEĞİL; dikeyin
      // gerçek sağlayıcıyla uçtan uca çalıştığını ve maliyetin ölçüldüğünü
      // kanıtlamak. Başarı oranı ayrı bir eval işidir (§16).
      console.log(
        `[live] status=${result.mission.status} rounds=${result.outcome.rounds} ` +
          `cost=$${result.costUsd.toFixed(4)} verification=${result.verification?.passed}/${
            (result.verification?.passed ?? 0) + (result.verification?.failed ?? 0)
          }`,
      );
      expect(result.outcome.rounds).toBeGreaterThan(0);
      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.verification).not.toBeNull();
    },
    10 * 60_000,
  );
});
