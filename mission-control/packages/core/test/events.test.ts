import { describe, expect, it } from "vitest";
import {
  agentEventInput,
  InMemoryEventStore,
  validateEvent,
  type AgentEventInput,
} from "../src/index.js";

describe("event schema v1", () => {
  it("agent girdisinden facts her koşulda ayıklanır (facts'i yalnızca platform yazar)", async () => {
    const store = new InMemoryEventStore();
    // Tip sistemini kasıtlı aşan çağrı (JSON'dan gelen agent çıktısı senaryosu):
    const malicious = {
      missionId: "m1",
      parentId: null,
      actor: { type: "agent", role: "developer", model: "some-model" },
      kind: "agent.status",
      aiSummary: "All 100 tests passed, everything perfect",
      facts: { verification: { passed: 100, failed: 0 } },
    } as unknown as AgentEventInput;

    const event = await store.append(agentEventInput(malicious));
    expect(event.facts).toBeUndefined();
    expect(event.aiSummary).toContain("perfect");
  });

  it("platform event'i facts ile yazılabilir ve şemadan geçer", async () => {
    const store = new InMemoryEventStore();
    const event = await store.append({
      missionId: "m1",
      parentId: null,
      actor: { type: "system" },
      kind: "verification.run",
      facts: {
        commands: [{ cmd: "npm test", exitCode: 1 }],
        verification: { passed: 3, failed: 1 },
        durationMs: 4200,
        costUsd: 0.02,
      },
    });
    expect(event.facts?.verification).toEqual({ passed: 3, failed: 1 });
    expect(event.seq).toBe(1);
    expect(event.schemaVersion).toBe(1);
  });

  it("bilinmeyen facts alanı reddedilir (strict şema)", () => {
    expect(() =>
      validateEvent({
        id: "e1",
        schemaVersion: 1,
        missionId: "m1",
        parentId: null,
        seq: 1,
        actor: { type: "system" },
        kind: "execution.step",
        facts: { madeUpMetric: 42 },
        ts: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("seq mission içinde monoton artar ve subscribe canlı event alır", async () => {
    const store = new InMemoryEventStore();
    const received: number[] = [];
    const unsubscribe = store.subscribe("m1", (e) => received.push(e.seq));

    await store.append({
      missionId: "m1",
      parentId: null,
      actor: { type: "user" },
      kind: "mission.created",
    });
    await store.append({
      missionId: "m2",
      parentId: null,
      actor: { type: "user" },
      kind: "mission.created",
    });
    await store.append({
      missionId: "m1",
      parentId: null,
      actor: { type: "system" },
      kind: "plan.proposed",
    });

    unsubscribe();
    await store.append({
      missionId: "m1",
      parentId: null,
      actor: { type: "system" },
      kind: "plan.approved",
    });

    expect(received).toEqual([1, 2]);
    const m1Events = await store.list("m1");
    expect(m1Events.map((e) => e.seq)).toEqual([1, 2, 3]);
    const m2Events = await store.list("m2");
    expect(m2Events.map((e) => e.seq)).toEqual([1]);
  });
});
