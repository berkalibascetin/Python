import {
  agentEventInput,
  BudgetExceededError,
  redactSecrets,
  type BudgetTracker,
  type EventStore,
} from "@mission-control/core";
import {
  estimateCost,
  type ConversationTurn,
  type ModelGateway,
  type ToolResult,
} from "@mission-control/gateway";
import type { AgentRole, ToolRuntime } from "@mission-control/tools";

/**
 * Agent Runtime döngüsü (MASTER_PLAN §12).
 *
 * Ürünün çekirdek IP'si burasıdır ve bilinçli olarak framework'süz yazılmıştır:
 * model çağır → tool çağrılarını policy'den geçir → çalıştır → event yaz → tekrar.
 * Her limit (bütçe, tur, süre, thrashing) prompt'a değil KODA gömülüdür; modelin
 * "ikna edilmesi" bir limiti aşmaya yetmez.
 */

export type AgentOutcomeStatus =
  | "completed"
  | "budget_exceeded"
  | "max_rounds"
  | "refused"
  | "thrashing"
  | "provider_error";

export interface AgentOutcome {
  status: AgentOutcomeStatus;
  /** Modelin son metni — timeline'da AI özeti olarak gösterilir. */
  text: string;
  rounds: number;
  costUsd: number;
  /** completed dışındaki durumlar için insan-okunur sebep. */
  reason?: string;
}

export interface AgentLoopOptions {
  missionId: string;
  taskId: string;
  role: AgentRole;
  modelRef: string;
  system: string;
  goal: string;
  gateway: ModelGateway;
  tools: ToolRuntime;
  events: EventStore;
  budget: BudgetTracker;
  /** Model çağrısı üst sınırı (§12 runaway koruması). */
  maxRounds?: number;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Tüm görev için duvar-saat sınırı. */
  timeoutMs?: number;
}

/** Aynı tool'un aynı argümanlarla üst üste bu kadar çağrılması = döngü. */
const THRASHING_LIMIT = 3;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentOutcome> {
  const {
    missionId,
    taskId,
    role,
    modelRef,
    system,
    goal,
    gateway,
    tools,
    events,
    budget,
    maxRounds = 12,
    maxTokens = 8192,
    effort = "medium",
    timeoutMs = 30 * 60_000,
  } = options;

  const modelId = gateway.modelIdFor(modelRef);
  const toolSpecs = tools.specsFor(role);
  const turns: ConversationTurn[] = [{ role: "user", text: goal }];

  const deadline = Date.now() + timeoutMs;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  let rounds = 0;
  let spent = 0;
  let lastText = "";
  let lastToolSignature: string | null = null;
  let repeatCount = 0;

  const finish = (
    status: AgentOutcomeStatus,
    reason?: string,
  ): AgentOutcome => {
    clearTimeout(timer);
    return {
      status,
      text: lastText,
      rounds,
      costUsd: Number(spent.toFixed(6)),
      ...(reason ? { reason } : {}),
    };
  };

  try {
    while (true) {
      if (rounds >= maxRounds) {
        return finish("max_rounds", `stopped after ${maxRounds} model calls`);
      }
      if (Date.now() > deadline) {
        return finish("max_rounds", "task wall-clock timeout reached");
      }

      // --- Bütçe: çağrıdan ÖNCE rezervasyon (§12) --------------------------
      const promptTokens = estimatePromptTokens(system, goal, turns);
      const estimate = estimateCost(modelId, promptTokens, maxTokens);
      try {
        budget.reserve(estimate);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          return finish("budget_exceeded", err.message);
        }
        throw err;
      }

      const startedAt = Date.now();
      let response;
      try {
        response = await gateway.complete({
          modelRef,
          system,
          turns,
          tools: toolSpecs,
          maxTokens,
          effort,
          signal: abort.signal,
        });
      } catch (err) {
        budget.release(estimate);
        return finish(
          "provider_error",
          err instanceof Error ? err.message : String(err),
        );
      }

      budget.commit(estimate, response.costUsd);
      spent += response.costUsd;
      rounds += 1;

      // Ölçülmüş gerçekler — yalnızca platform kodu yazar (§7 Katman B).
      await events.append({
        missionId,
        parentId: taskId,
        actor: { type: "system" },
        kind: "execution.step",
        facts: {
          durationMs: Date.now() - startedAt,
          costUsd: Number(response.costUsd.toFixed(6)),
          tokens: {
            input: response.usage.inputTokens + response.usage.cacheReadTokens,
            output: response.usage.outputTokens,
          },
        },
      });

      // refusal: içeriğe güvenmeden önce kontrol edilir.
      if (response.stopReason === "refusal") {
        await events.append({
          missionId,
          parentId: taskId,
          actor: { type: "system" },
          kind: "failure.detected",
          aiSummary: `The model declined this request${
            response.refusalCategory ? ` (${response.refusalCategory})` : ""
          }.`,
        });
        return finish("refused", response.refusalCategory ?? "provider declined the request");
      }

      if (response.text) {
        lastText = response.text;
        // Agent beyanı — facts YAZAMAZ (Faz 0 garantisi, §7 Katman A).
        await events.append(
          agentEventInput({
            missionId,
            parentId: taskId,
            actor: { type: "agent", role, model: modelId },
            kind: "agent.status",
            // Model çıktısı kalıcı kayda girmeden önce sır taraması: anahtar
            // sisteme başka bir yoldan girdiyse timeline'a yazılmasın (§7).
            aiSummary: redactSecrets(response.text).slice(0, 500),
          }),
        );
      }

      if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
        return finish("completed");
      }

      // --- Tool çağrıları -------------------------------------------------
      const signature = JSON.stringify(
        response.toolCalls.map((call) => [call.name, call.input]),
      );
      if (signature === lastToolSignature) {
        repeatCount += 1;
        if (repeatCount >= THRASHING_LIMIT) {
          return finish(
            "thrashing",
            `the same tool call was repeated ${repeatCount} times without progress`,
          );
        }
      } else {
        lastToolSignature = signature;
        repeatCount = 1;
      }

      const results: ToolResult[] = [];
      for (const call of response.toolCalls) {
        const outcome = await tools.invoke(role, call.name, call.input);
        results.push({
          callId: call.id,
          content: outcome.content,
          ...(outcome.isError ? { isError: true } : {}),
        });
        if (outcome.facts) {
          await events.append({
            missionId,
            parentId: taskId,
            actor: { type: "system" },
            kind: "execution.step",
            facts: {
              ...(outcome.facts.command !== undefined && outcome.facts.exitCode !== undefined
                ? { commands: [{ cmd: outcome.facts.command, exitCode: outcome.facts.exitCode }] }
                : {}),
              ...(outcome.facts.durationMs !== undefined
                ? { durationMs: outcome.facts.durationMs }
                : {}),
            },
          });
        }
      }

      turns.push({
        role: "assistant",
        text: response.text,
        toolCalls: response.toolCalls,
        ...(response.raw !== undefined ? { raw: response.raw } : {}),
      });
      // Tüm tool sonuçları TEK turda geri gider (bölmek paralel tool
      // kullanımını bozar).
      turns.push({ role: "tool", results });
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rezervasyon için kaba token tahmini. Amaç doğruluk değil, çağrıdan önce
 * bütçe tavanını koruyabilmek; gerçek maliyet çağrı sonrası mutabakatla girer.
 */
function estimatePromptTokens(system: string, goal: string, turns: ConversationTurn[]): number {
  let chars = system.length + goal.length;
  for (const turn of turns) {
    if (turn.role === "user") chars += turn.text.length;
    else if (turn.role === "assistant") chars += turn.text.length + JSON.stringify(turn.toolCalls).length;
    else chars += turn.results.reduce((sum, r) => sum + r.content.length, 0);
  }
  return Math.ceil(chars / 4);
}
