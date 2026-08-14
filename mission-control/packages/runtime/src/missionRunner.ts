import { randomUUID } from "node:crypto";
import {
  BudgetTracker,
  transition,
  type EventStore,
  type Mission,
} from "@mission-control/core";
import type { ModelGateway } from "@mission-control/gateway";
import type { SandboxProvider, TrustLevel } from "@mission-control/sandbox";
import { ToolRuntime } from "@mission-control/tools";
import { runAgentLoop, type AgentOutcome } from "./agentLoop.js";
import { runVerification, type VerificationResult } from "./verification.js";

/**
 * Faz 1a mission akışı (PHASE_1A_PLAN §A.1).
 *
 * Tek dikey dilim: proje → sandbox → Developer agent → verification → diff.
 * Manager/Reviewer, plan onay kapısı ve Explain/Fix döngüsü Faz 2-3'te bu
 * orchestrator'a eklenecek; event sözleşmesi ve limitler aynı kalacak.
 */

const DEVELOPER_SYSTEM = `You are a software developer working inside a sandboxed copy of a project.

Work directly: read the files you need, make the smallest change that fixes the
problem, then run the project's tests to check yourself. Prefer one precise edit
over broad rewrites, and do not restructure code that is unrelated to the task.

You have a limited number of steps, so avoid re-reading files you have already
seen. When the tests pass, state in one sentence what was wrong and what you
changed, and stop.`;

export interface MissionRunOptions {
  goal: string;
  /** Host üzerindeki proje dizini; sandbox'a kopyalanır. */
  sourceDir: string;
  gateway: ModelGateway;
  sandboxes: SandboxProvider;
  events: EventStore;
  modelRef?: string;
  budgetUsd?: number;
  maxRounds?: number;
  /**
   * Projenin güven seviyesi. Belirtilmezse `untrusted` — yani izolasyon
   * sağlamayan bir sandbox sağlayıcısı bu mission'ı reddeder. Yalnızca
   * kaynağını bizim ürettiğimiz kod (golden fixture) `trusted` olabilir.
   */
  trust?: TrustLevel;
}

export interface MissionRunResult {
  mission: Mission;
  outcome: AgentOutcome;
  verification: VerificationResult | null;
  diff: string;
  costUsd: number;
}

export async function runMission(options: MissionRunOptions): Promise<MissionRunResult> {
  const {
    goal,
    sourceDir,
    gateway,
    sandboxes,
    events,
    modelRef = "developer-default",
    budgetUsd = 2,
    maxRounds = 12,
    trust = "untrusted",
  } = options;

  let mission: Mission = {
    id: randomUUID(),
    goal,
    status: "created",
    version: 1,
    createdAt: new Date().toISOString(),
  };
  const missionId = mission.id;
  const taskId = randomUUID();
  const budget = new BudgetTracker(budgetUsd);

  await events.append({
    missionId,
    parentId: null,
    actor: { type: "user" },
    kind: "mission.created",
    aiSummary: goal,
  });

  const sandbox = await sandboxes.create({ missionId, sourceDir, trust });
  try {
    // Faz 1a'da plan adımı yok: görev doğrudan Developer'a gider (Faz 2'de
    // Manager + insan onay kapısı araya girecek).
    mission = transition(mission, "planning");
    mission = transition(mission, "awaiting_approval");
    mission = transition(mission, "running");
    await events.append({
      missionId,
      parentId: null,
      actor: { type: "system" },
      kind: "task.assigned",
      aiSummary: "Task assigned to the developer agent",
    });

    // Başlangıç durumunu ölç: "önce kırmızıydı" iddiası da ölçülmüş olsun.
    const before = await runVerification(sandbox);
    await events.append({
      missionId,
      parentId: taskId,
      actor: { type: "system" },
      kind: "verification.run",
      aiSummary: before.inconclusive
        ? "Could not establish a test baseline for this project."
        : `Baseline: ${before.passed} passing, ${before.failed} failing.`,
      facts: {
        commands: [{ cmd: before.command, exitCode: before.exitCode }],
        verification: { passed: before.passed, failed: before.failed },
        durationMs: before.durationMs,
      },
    });

    const outcome = await runAgentLoop({
      missionId,
      taskId,
      role: "developer",
      modelRef,
      system: DEVELOPER_SYSTEM,
      goal: buildGoalPrompt(goal, before),
      gateway,
      tools: new ToolRuntime(sandbox),
      events,
      budget,
      maxRounds,
    });

    // Değişimi agent'ın beyanından değil, git'ten ölç (§7 Katman B).
    const changes = await sandbox.diffStat();
    const diff = await sandbox.unifiedDiff();
    if (changes.files > 0) {
      await events.append({
        missionId,
        parentId: taskId,
        actor: { type: "system" },
        kind: "artifact.created",
        facts: { changes },
        detailRef: `artifact://${missionId}/diff`,
      });
    }

    mission = transition(mission, "verifying");
    const after = await runVerification(sandbox);
    await events.append({
      missionId,
      parentId: taskId,
      actor: { type: "system" },
      kind: "verification.run",
      aiSummary: after.inconclusive
        ? "Test results were inconclusive."
        : `${after.passed} passing, ${after.failed} failing.`,
      facts: {
        commands: [{ cmd: after.command, exitCode: after.exitCode }],
        verification: { passed: after.passed, failed: after.failed },
        durationMs: after.durationMs,
      },
      detailRef: `artifact://${missionId}/verification`,
    });

    const green = !after.inconclusive && after.failed === 0 && after.exitCode === 0;
    const costUsd = Number(budget.snapshot().committedUsd.toFixed(6));

    if (green && outcome.status === "completed") {
      await events.append({
        missionId,
        parentId: null,
        actor: { type: "system" },
        kind: "mission.completed",
        aiSummary: outcome.text || "Task complete; all checks pass.",
        facts: { costUsd, changes },
      });
      mission = transition(mission, "completed");
    } else {
      // Faz 1a'da Explain/Fix yok: durum dürüstçe raporlanır, "başarılı" denmez.
      // "Hiçbir şey kontrol edilemedi" ile "0 test başarısız" aynı şey değildir;
      // ikisini aynı cümleyle raporlamak kullanıcıyı yanıltır.
      const reason = after.inconclusive
        ? "no test suite could be run, so the change is unverified"
        : after.failed > 0
          ? `checks still failing (${after.failed} failed)`
          : (outcome.reason ?? outcome.status);
      await events.append({
        missionId,
        parentId: null,
        actor: { type: "system" },
        kind: "failure.detected",
        aiSummary: `Needs human attention: ${reason}.`,
        facts: { costUsd, changes },
      });
      mission = transition(mission, "failed");
    }

    return { mission, outcome, verification: after, diff, costUsd };
  } finally {
    // Kaynak kod kalıcı depoya yazılmaz; sandbox mission bitiminde imha edilir
    // (§9.1 retention: "yalnızca mission süresi").
    await sandbox.destroy();
  }
}

function buildGoalPrompt(goal: string, baseline: VerificationResult): string {
  if (baseline.inconclusive) return goal;
  return `${goal}

The project's test suite currently reports ${baseline.passed} passing and ${baseline.failed} failing.
Failing output:

${baseline.output}`;
}
