import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "@mission-control/core";
import { MockAdapter, ModelGateway } from "@mission-control/gateway";
import { DockerSandboxProvider, LocalSandboxProvider } from "@mission-control/sandbox";
import { GOLDEN_SET, runMission } from "../src/index.js";

/**
 * Faz 1b kabul kriteri: GÜVENİLMEYEN bir proje, izolasyonlu container içinde
 * uçtan uca çalışıyor — create → prepare → execute → verify → collect → destroy.
 *
 * Faz 1a'daki tüm ölçüm garantileri (facts agent tarafından yazılamaz,
 * doğrulanamayan iş başarılı sayılmaz) Docker yolunda da geçerli olmalı.
 */

const provider = new DockerSandboxProvider();
const availability = await provider.isAvailable();
const dockerReady = availability.ok;
if (!dockerReady) {
  console.warn(`[docker-mission] Docker yok, atlanıyor: ${availability.detail}`);
}

function scenario(name: string) {
  const found = GOLDEN_SET.find((s) => s.name === name);
  if (!found) throw new Error(`unknown scenario ${name}`);
  return found;
}

describe.skipIf(!dockerReady)("Docker sandbox ile mission", () => {
  it("güvenilmeyen projeyi izole container'da düzeltir ve ölçer", async () => {
    const s = scenario("py-auth-bug");
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: s.goal,
      sourceDir: s.dir,
      gateway: ModelGateway.fromRecord({
        "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5"),
      }),
      sandboxes: provider,
      // Faz 1b'nin bütün mesele bu: güvenilmeyen olarak işaretlenmiş bir proje.
      trust: "untrusted",
      events,
    });

    expect(result.mission.status).toBe("completed");
    expect(result.verification?.passed).toBe(4);
    expect(result.verification?.failed).toBe(0);
    expect(result.diff).toContain("USERS.get(username)");

    const timeline = await events.list(result.mission.id);
    const verifications = timeline.filter((e) => e.kind === "verification.run");
    expect(verifications[0]?.facts?.verification).toEqual({ passed: 2, failed: 2 });
    expect(verifications[1]?.facts?.verification).toEqual({ passed: 4, failed: 0 });

    // Ölçülmüş değişim git'ten gelir ve container ona erişemez.
    const artifact = timeline.find((e) => e.kind === "artifact.created");
    expect(artifact?.facts?.changes?.files).toBe(1);

    // Faz 0 garantisi Docker yolunda da korunur.
    expect(timeline.filter((e) => e.actor.type === "agent").every((e) => !e.facts)).toBe(true);
  }, 300_000);

  it("npm/node projesini de izole çalıştırır", async () => {
    const s = scenario("js-sum-bug");
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: s.goal,
      sourceDir: s.dir,
      gateway: ModelGateway.fromRecord({
        "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5"),
      }),
      sandboxes: provider,
      trust: "untrusted",
      events,
    });
    expect(result.mission.status).toBe("completed");
    expect(result.verification?.failed).toBe(0);
  }, 300_000);

  it("agent düzeltemezse Docker yolunda da başarılı ilan etmez", async () => {
    const s = scenario("py-auth-bug");
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: s.goal,
      sourceDir: s.dir,
      gateway: ModelGateway.fromRecord({
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
            { text: "All done." },
          ],
          "claude-sonnet-5",
        ),
      }),
      sandboxes: provider,
      trust: "untrusted",
      events,
    });

    expect(result.mission.status).toBe("failed");
    expect(result.verification?.failed).toBe(2);
    const timeline = await events.list(result.mission.id);
    expect(timeline.some((e) => e.kind === "mission.completed")).toBe(false);
  }, 300_000);

  it("doğrulanamayan projede INCONCLUSIVE korunur (0 hata ≠ başarı)", async () => {
    const s = scenario("no-tests");
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: s.goal,
      sourceDir: s.dir,
      gateway: ModelGateway.fromRecord({
        "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5"),
      }),
      sandboxes: provider,
      trust: "untrusted",
      events,
    });

    expect(result.verification?.inconclusive).toBe(true);
    expect(result.mission.status).not.toBe("completed");
    const timeline = await events.list(result.mission.id);
    const failure = timeline.find((e) => e.kind === "failure.detected");
    expect(failure?.aiSummary).toContain("unverified");
  }, 300_000);

  it("mission başarısız olsa da container ve workspace temizlenir", async () => {
    const s = scenario("py-auth-bug");
    const events = new InMemoryEventStore();
    const result = await runMission({
      goal: s.goal,
      sourceDir: s.dir,
      gateway: ModelGateway.fromRecord({
        "developer-default": new MockAdapter([{ text: "I give up." }], "claude-sonnet-5"),
      }),
      sandboxes: provider,
      trust: "untrusted",
      events,
    });
    expect(result.mission.status).toBe("failed");
    // Bu mission'a ait artık container kalmamalı. Sayım mission'a
    // sınırlandırılmalı: eşzamanlı koşan başka testlerin container'larını
    // saymak testi kendi kendine kırardı.
    const reaped = await provider.reapOrphans(result.mission.id);
    expect(reaped).toBe(0);
  }, 300_000);
});

describe("güvenlik: izolasyonsuz sağlayıcı untrusted mission'ı reddeder", () => {
  it("runMission varsayılan olarak untrusted kabul eder ve local sandbox'ı reddettirir", async () => {
    const s = scenario("py-auth-bug");
    await expect(
      runMission({
        goal: s.goal,
        sourceDir: s.dir,
        gateway: ModelGateway.fromRecord({
          "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5"),
        }),
        sandboxes: new LocalSandboxProvider(),
        // trust belirtilmedi → untrusted → izolasyonsuz sağlayıcı reddetmeli
        events: new InMemoryEventStore(),
      }),
    ).rejects.toThrow(/untrusted/i);
  }, 60_000);
});
