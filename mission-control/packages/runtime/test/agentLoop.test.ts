import { afterEach, describe, expect, it } from "vitest";
import { BudgetTracker, InMemoryEventStore } from "@mission-control/core";
import { MockAdapter, ModelGateway, TransientProviderError } from "@mission-control/gateway";
import { LocalSandboxProvider, type Sandbox } from "@mission-control/sandbox";
import { ToolRuntime } from "@mission-control/tools";
import { runAgentLoop, type AgentLoopOptions } from "../src/index.js";
import type { MockStep } from "@mission-control/gateway";

const provider = new LocalSandboxProvider();
const created: Sandbox[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((sandbox) => sandbox.destroy()));
});

async function harness(steps: MockStep[], overrides: Partial<AgentLoopOptions> = {}) {
  const sandbox = await provider.create({ missionId: "loop-test" });
  created.push(sandbox);
  await sandbox.writeFile("app.py", "def add(a, b):\n    return a - b\n");

  const events = new InMemoryEventStore();
  const adapter = new MockAdapter(steps, "claude-sonnet-5");
  const options: AgentLoopOptions = {
    missionId: "m1",
    taskId: "t1",
    role: "developer",
    modelRef: "developer-default",
    system: "You fix bugs.",
    goal: "Fix the add() function.",
    gateway: ModelGateway.fromRecord({ "developer-default": adapter }, { sleep: async () => {} }),
    tools: new ToolRuntime(sandbox),
    events,
    budget: new BudgetTracker(5),
    ...overrides,
  };
  const outcome = await runAgentLoop(options);
  return { outcome, events, sandbox, adapter };
}

describe("agent döngüsü", () => {
  it("tool kullanıp görevi tamamlar ve gerçek dosyayı değiştirir", async () => {
    const { outcome, events, sandbox } = await harness([
      {
        text: "Reading the file first.",
        toolCalls: [{ name: "repo.read", input: { path: "app.py" } }],
      },
      {
        text: "Found the bug: subtraction instead of addition.",
        toolCalls: [
          {
            name: "repo.write",
            input: { path: "app.py", old_string: "return a - b", new_string: "return a + b" },
          },
        ],
      },
      { text: "Fixed." },
    ]);

    expect(outcome.status).toBe("completed");
    expect(outcome.rounds).toBe(3);
    expect(outcome.costUsd).toBeGreaterThan(0);
    expect(await sandbox.readFile("app.py")).toContain("return a + b");

    const all = await events.list("m1");
    // Agent event'lerinin hiçbiri facts taşımaz; ölçüm system event'lerinde.
    const agentEvents = all.filter((e) => e.actor.type === "agent");
    expect(agentEvents.length).toBeGreaterThan(0);
    expect(agentEvents.every((e) => e.facts === undefined)).toBe(true);
    expect(all.some((e) => e.kind === "execution.step" && e.facts?.costUsd !== undefined)).toBe(true);
  });

  it("bütçe tavanı çağrı yapılmadan önce durdurur", async () => {
    const { outcome, adapter } = await harness(
      [{ text: "step 1", toolCalls: [{ name: "repo.read", input: {} }] }, { text: "step 2" }],
      { budget: new BudgetTracker(0.0001) },
    );
    expect(outcome.status).toBe("budget_exceeded");
    expect(adapter.callCount).toBe(0); // tavan aşılacaksa çağrı hiç yapılmaz
  });

  it("tur limitine takılır ve sonsuza kadar koşmaz", async () => {
    const looping: MockStep[] = Array.from({ length: 10 }, (_, i) => ({
      text: `round ${i}`,
      // Argümanlar değişiyor: thrashing değil, gerçek ama bitmeyen iş.
      toolCalls: [{ name: "repo.read", input: { path: `file-${i}.py` } }],
    }));
    const { outcome } = await harness(looping, { maxRounds: 4 });
    expect(outcome.status).toBe("max_rounds");
    expect(outcome.rounds).toBe(4);
  });

  it("aynı tool çağrısı tekrarlanınca thrashing tespit eder", async () => {
    const repeated: MockStep[] = Array.from({ length: 6 }, () => ({
      text: "trying again",
      toolCalls: [{ name: "repo.read", input: { path: "app.py" } }],
    }));
    const { outcome } = await harness(repeated, { maxRounds: 20 });
    expect(outcome.status).toBe("thrashing");
    expect(outcome.rounds).toBeLessThan(6);
  });

  it("refusal'ı hata değil, beyan edilen bir sonuç olarak işler", async () => {
    const { outcome, events } = await harness([
      { stopReason: "refusal", refusalCategory: "cyber" },
    ]);
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("cyber");
    const all = await events.list("m1");
    expect(all.some((e) => e.kind === "failure.detected")).toBe(true);
  });

  it("yetkisiz tool çağrısı döngüyü kırmaz, modele hata döner", async () => {
    const { outcome, adapter } = await harness(
      [
        {
          text: "Let me edit that.",
          toolCalls: [
            { name: "repo.write", input: { path: "a.py", old_string: "", new_string: "x" } },
          ],
        },
        { text: "Understood, I only have read access." },
      ],
      { role: "reviewer" },
    );
    expect(outcome.status).toBe("completed");
    expect(adapter.callCount).toBe(2);
    const toolTurn = adapter.seenRequests[1]?.turns.find((t) => t.role === "tool");
    expect(toolTurn && toolTurn.role === "tool" && toolTurn.results[0]?.isError).toBe(true);
    expect(toolTurn && toolTurn.role === "tool" && toolTurn.results[0]?.content).toContain(
      "Permission denied",
    );
  });

  it("retry bütçesi tükenen sağlayıcı hatasında rezervasyonu geri bırakır", async () => {
    const budget = new BudgetTracker(5);
    // Gateway varsayılan olarak 3 kez yeniden dener → 4 deneme de başarısız olmalı.
    const { outcome } = await harness(
      Array.from({ length: 4 }, () => ({ throws: new TransientProviderError("still down") })),
      { budget },
    );
    expect(outcome.status).toBe("provider_error");
    // Rezervasyon serbest bırakıldığı için bütçe hâlâ tam kullanılabilir.
    expect(budget.snapshot().remainingUsd).toBeCloseTo(5, 6);
  });
});
