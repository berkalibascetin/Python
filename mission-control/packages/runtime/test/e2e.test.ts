import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "@mission-control/core";
import { MockAdapter, ModelGateway, type MockStep } from "@mission-control/gateway";
import { LocalSandboxProvider } from "@mission-control/sandbox";
import { runMission } from "../src/index.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/golden/py-auth-bug",
);

/**
 * Faz 1a'nın tamamlanma kriteri (PHASE_1A_PLAN §A.10):
 * golden fixture'daki bug, upload→sandbox→agent→verification→diff akışıyla
 * düzeliyor ve timeline gerçek ölçülmüş facts gösteriyor.
 *
 * Model deterministik mock'tur — bu test agent DÖNGÜSÜNÜN doğruluğunu kanıtlar,
 * gerçek bir modelin bu bug'ı bulabildiğini DEĞİL. O iddia yalnızca canlı
 * smoke testinden (live.test.ts) gelebilir.
 */
const FIXING_STEPS: MockStep[] = [
  {
    text: "Let me look at the failing module.",
    toolCalls: [{ name: "repo.read", input: { path: "auth_service.py" } }],
  },
  {
    text: "Unknown usernames hit a KeyError; I'll look them up safely.",
    toolCalls: [
      {
        name: "repo.write",
        input: {
          path: "auth_service.py",
          old_string: "    user = USERS[username]",
          new_string: "    user = USERS.get(username)\n    if user is None:\n        return None",
        },
      },
    ],
  },
  {
    text: "require_role also indexes a possibly-None user; guarding that too.",
    toolCalls: [
      {
        name: "repo.write",
        input: {
          path: "auth_service.py",
          old_string: "    user = authenticate(username, password)\n    return user[\"role\"] == role",
          new_string:
            "    user = authenticate(username, password)\n    if user is None:\n        return False\n    return user[\"role\"] == role",
        },
      },
    ],
  },
  {
    text: "Running the tests.",
    toolCalls: [{ name: "shell.run", input: { command: "python3", args: ["-m", "pytest", "-q"] } }],
  },
  { text: "authenticate() raised KeyError for unknown users; it now returns None." },
];

describe("E2E: golden fixture mission", () => {
  it("bug'ı düzeltir, testleri yeşile çevirir ve ölçülmüş facts üretir", async () => {
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: "Fix the failing authentication tests.",
      sourceDir: FIXTURE,
      gateway: ModelGateway.fromRecord({
        "developer-default": new MockAdapter(FIXING_STEPS, "claude-sonnet-5"),
      }),
      sandboxes: new LocalSandboxProvider(),
      events,
    });

    expect(result.mission.status).toBe("completed");
    expect(result.verification?.failed).toBe(0);
    expect(result.verification?.passed).toBe(4);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.diff).toContain("USERS.get(username)");

    const timeline = await events.list(result.mission.id);

    // Baseline gerçekten kırmızı ölçülmüş olmalı (önce/sonra iddiası ölçüme dayanıyor).
    const verifications = timeline.filter((e) => e.kind === "verification.run");
    expect(verifications).toHaveLength(2);
    expect(verifications[0]?.facts?.verification).toEqual({ passed: 2, failed: 2 });
    expect(verifications[1]?.facts?.verification).toEqual({ passed: 4, failed: 0 });

    // Değişim sayıları git'ten ölçülmüş olmalı, agent beyanından değil.
    const artifact = timeline.find((e) => e.kind === "artifact.created");
    expect(artifact?.facts?.changes?.files).toBe(1);
    expect(artifact?.facts?.changes?.added).toBeGreaterThan(0);

    // Faz 0 garantisi hâlâ geçerli: hiçbir agent event'i facts taşımaz.
    expect(timeline.filter((e) => e.actor.type === "agent").every((e) => !e.facts)).toBe(true);

    const completed = timeline.find((e) => e.kind === "mission.completed");
    expect(completed?.facts?.costUsd).toBeGreaterThan(0);
  }, 60_000);

  it("agent testleri düzeltemezse mission'ı başarılı ilan etmez", async () => {
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: "Fix the failing authentication tests.",
      sourceDir: FIXTURE,
      gateway: ModelGateway.fromRecord({
        // Yüzeysel bir düzenleme yapıp "tamamdır" diyen agent.
        "developer-default": new MockAdapter(
          [
            {
              text: "Adding a comment should do it.",
              toolCalls: [
                {
                  name: "repo.write",
                  input: {
                    path: "auth_service.py",
                    old_string: "USERS = {",
                    new_string: "# users\nUSERS = {",
                  },
                },
              ],
            },
            { text: "All done, everything works now." },
          ],
          "claude-sonnet-5",
        ),
      }),
      sandboxes: new LocalSandboxProvider(),
      events,
    });

    expect(result.mission.status).toBe("failed");
    expect(result.verification?.failed).toBe(2);

    const timeline = await events.list(result.mission.id);
    const failure = timeline.find((e) => e.kind === "failure.detected");
    expect(failure?.aiSummary).toContain("checks still failing");
    // Agent "her şey çalışıyor" dese de sistem gerçeği raporlar.
    expect(timeline.some((e) => e.kind === "mission.completed")).toBe(false);
  }, 60_000);
});
