import { randomUUID } from "node:crypto";
import {
  agentEventInput,
  BudgetTracker,
  FixRoundGuard,
  normalizeFailureSignature,
  transition,
  type EventStore,
  type Mission,
} from "@mission-control/core";

/**
 * Faz 0 "Merhaba dünya mission'ı": MASTER_PLAN §6 referans akışını sahte bir
 * AI ekibiyle oynatır. Model çağrısı yok — amaç event/timeline/limit dikeyinin
 * uçtan uca çalıştığını kanıtlamak. Faz 1a'da Developer adımının içi gerçek
 * agent döngüsüyle değişir; event sözleşmesi aynı kalır.
 *
 * İki katman burada da ayrık: agent adımları `agentEventInput` ile yazılır
 * (facts veremezler); ölçülmüş gerçekleri ayrı system event'leri taşır.
 */

const STEP_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DemoMissionHandle {
  mission: Mission;
  done: Promise<void>;
}

export function startDemoMission(store: EventStore, goal: string): DemoMissionHandle {
  const mission: Mission = {
    id: randomUUID(),
    goal,
    status: "created",
    version: 1,
    createdAt: new Date().toISOString(),
  };
  const done = run(store, mission).catch((err) => {
    // Faz 0: demo sürücüsünde beklenmeyen hata mission.failed olarak görünür kalmalı.
    console.error("demo mission crashed", err);
  });
  return { mission, done };
}

async function run(store: EventStore, mission: Mission): Promise<void> {
  const budget = new BudgetTracker(5.0);
  const fixGuard = new FixRoundGuard(3);
  const missionId = mission.id;

  const spend = (estimate: number, actual: number) => {
    budget.reserve(estimate);
    budget.commit(estimate, actual);
  };

  await store.append({
    missionId,
    parentId: null,
    actor: { type: "user" },
    kind: "mission.created",
    aiSummary: mission.goal,
  });
  mission = transition(mission, "planning");

  await sleep(STEP_DELAY_MS);
  spend(0.05, 0.03);
  await store.append(
    agentEventInput({
      missionId,
      parentId: null,
      actor: { type: "agent", role: "manager", model: "provider-a/planner" },
      kind: "plan.proposed",
      aiSummary:
        "Analyzed the project. Plan: reproduce the auth failure, patch the middleware, re-run verification.",
    }),
  );
  await store.append({
    missionId,
    parentId: null,
    actor: { type: "system" },
    kind: "execution.step",
    facts: { durationMs: 1800, costUsd: 0.03, tokens: { input: 5200, output: 350 } },
  });
  mission = transition(mission, "awaiting_approval");

  await sleep(STEP_DELAY_MS);
  await store.append({
    missionId,
    parentId: null,
    actor: { type: "user" },
    kind: "plan.approved",
  });
  mission = transition(mission, "running");

  const taskId = randomUUID();
  await store.append({
    missionId,
    parentId: null,
    actor: { type: "system" },
    kind: "task.assigned",
    aiSummary: "Task assigned to Developer",
  });

  // 1. deneme: Developer değişiklik yapar, verification kırmızı.
  await sleep(STEP_DELAY_MS);
  spend(0.4, 0.28);
  await store.append(
    agentEventInput({
      missionId,
      parentId: taskId,
      actor: { type: "agent", role: "developer", model: "provider-b/coder" },
      kind: "agent.status",
      aiSummary: "Authentication improved.", // beyan — facts bunun yanına gerçeği koyar
    }),
  );
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "artifact.created",
    facts: {
      changes: { files: 14, added: 327, removed: 81 },
      durationMs: 252_000,
      costUsd: 0.28,
      tokens: { input: 24_000, output: 3_100 },
    },
    detailRef: "artifact://demo/diff-1",
  });
  mission = transition(mission, "verifying");

  await sleep(STEP_DELAY_MS);
  const failureOutput = "AssertionError: middleware received null user at auth_service.py:143";
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "verification.run",
    facts: {
      commands: [{ cmd: "run verification", exitCode: 1 }],
      verification: { passed: 3, failed: 1 },
      durationMs: 41_000,
    },
    detailRef: "artifact://demo/verification-1",
  });
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "failure.detected",
    aiSummary: "Verification failed: 1 of 4 checks red.",
  });

  const round = fixGuard.tryStartRound(normalizeFailureSignature(failureOutput));
  if (!round.allowed) {
    await store.append({
      missionId,
      parentId: null,
      actor: { type: "system" },
      kind: "mission.suspended",
      aiSummary: `Human help needed: ${round.reason}`,
    });
    transition(mission, "suspended");
    return;
  }
  mission = transition(mission, "recovering");

  // Explain: FARKLI sağlayıcıdan Debugger (§8.4 cross-model kolu).
  await sleep(STEP_DELAY_MS);
  spend(0.15, 0.09);
  await store.append(
    agentEventInput({
      missionId,
      parentId: taskId,
      actor: { type: "agent", role: "debugger", model: "provider-a/debugger" },
      kind: "failure.explained",
      aiSummary:
        "Root cause: auth middleware receives an unexpected null user. Suspected location: auth_service.py:143. Confidence: high.",
    }),
  );
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "execution.step",
    facts: { durationMs: 9_000, costUsd: 0.09, tokens: { input: 12_000, output: 900 } },
  });

  // Fix turu + yeniden verification: yeşil.
  await sleep(STEP_DELAY_MS);
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "fix.requested",
    aiSummary: `Fix round ${fixGuard.roundsUsed} of 3 started`,
  });
  mission = transition(mission, "running");
  spend(0.3, 0.17);
  await store.append(
    agentEventInput({
      missionId,
      parentId: taskId,
      actor: { type: "agent", role: "developer", model: "provider-b/coder" },
      kind: "agent.status",
      aiSummary: "Applied null-guard fix based on debugger report.",
    }),
  );
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "artifact.created",
    facts: {
      changes: { files: 1, added: 9, removed: 2 },
      durationMs: 63_000,
      costUsd: 0.17,
      tokens: { input: 15_000, output: 700 },
    },
    detailRef: "artifact://demo/diff-2",
  });
  mission = transition(mission, "verifying");

  await sleep(STEP_DELAY_MS);
  await store.append({
    missionId,
    parentId: taskId,
    actor: { type: "system" },
    kind: "verification.run",
    facts: {
      commands: [{ cmd: "run verification", exitCode: 0 }],
      verification: { passed: 4, failed: 0 },
      durationMs: 39_000,
    },
    detailRef: "artifact://demo/verification-2",
  });

  await sleep(STEP_DELAY_MS);
  spend(0.1, 0.06);
  await store.append(
    agentEventInput({
      missionId,
      parentId: taskId,
      actor: { type: "agent", role: "reviewer", model: "provider-a/reviewer" },
      kind: "review.completed",
      aiSummary: "Diff reviewed: change is small and scoped; no risky patterns found.",
    }),
  );

  const totalSpent = Number(budget.snapshot().committedUsd.toFixed(4));
  await store.append({
    missionId,
    parentId: null,
    actor: { type: "system" },
    kind: "deliverable.published",
    aiSummary: "Deliverable ready for human review",
    facts: { costUsd: totalSpent },
    detailRef: "artifact://demo/deliverable-1",
  });
  await store.append({
    missionId,
    parentId: null,
    actor: { type: "system" },
    kind: "mission.completed",
    aiSummary: "Mission completed after 1 fix round.",
    facts: { costUsd: totalSpent },
  });
  transition(mission, "completed");
}
