import { z } from "zod";

/**
 * Event Schema v1 — MASTER_PLAN §7 / §11.4 sözleşmesi.
 *
 * İki katman:
 *  - `aiSummary`: agent'ın beyanı. Sistem doğrulamaz, UI "AI özeti" olarak etiketler.
 *  - `facts`: yalnızca platform kodunun yazabildiği ölçülmüş gerçekler.
 *    Agent girdisinden event üreten tek yol `agentEventInput()` olduğundan
 *    (facts alanı tip düzeyinde yok, çalışma anında da ayıklanır) bu kural
 *    şema + API yüzeyi düzeyinde zorlanır.
 *
 * Core alan-bağımsızdır (§11.4): "repo/PR/build" burada geçmez; coding'e özgü
 * kavramlar pack değerleri olarak taşınır (örn. artifact kind = "diff").
 */

export const EVENT_SCHEMA_VERSION = 1;

export const actorSchema = z.object({
  type: z.enum(["agent", "system", "user"]),
  /** Rol alias'ı (örn. "manager", "developer", "debugger"); §15 model_ref gibi soyut. */
  role: z.string().min(1).optional(),
  /** Adımı yürüten modelin görünen adı; provider-bağımsız serbest metin. */
  model: z.string().min(1).optional(),
});
export type Actor = z.infer<typeof actorSchema>;

export const eventKindSchema = z.enum([
  "mission.created",
  "plan.proposed",
  "plan.approved",
  "task.assigned",
  "agent.status",
  "execution.step",
  "artifact.created",
  "verification.run",
  "failure.detected",
  "failure.explained",
  "fix.requested",
  "review.completed",
  "deliverable.published",
  "mission.suspended",
  "mission.resumed",
  "mission.cancelled",
  "mission.failed",
  "mission.completed",
]);
export type EventKind = z.infer<typeof eventKindSchema>;

/** Sistem tarafından ölçülen gerçekler. Tüm alanlar opsiyonel; olan neyse o yazılır. */
export const factsSchema = z
  .object({
    changes: z
      .object({
        files: z.number().int().nonnegative(),
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
      })
      .optional(),
    commands: z
      .array(
        z.object({
          cmd: z.string().min(1),
          exitCode: z.number().int(),
        }),
      )
      .optional(),
    durationMs: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    tokens: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .optional(),
    verification: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();
export type Facts = z.infer<typeof factsSchema>;

export const missionEventSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
    missionId: z.string().min(1),
    /** Hiyerarşi: mission → task → step. Kök event'lerde null. */
    parentId: z.string().min(1).nullable(),
    /** Mission içinde monoton artan sıra; store atar. */
    seq: z.number().int().positive(),
    actor: actorSchema,
    kind: eventKindSchema,
    /** Katman A — agent beyanı. Doğrulanmamış metin. */
    aiSummary: z.string().max(500).optional(),
    /** Katman B — yalnızca platform kodu yazar. */
    facts: factsSchema.optional(),
    /** Büyük içerik (diff, log, rapor) event'te değil; object storage referansı. */
    detailRef: z.string().min(1).optional(),
    ts: z.string().datetime(),
  })
  .strict();
export type MissionEvent = z.infer<typeof missionEventSchema>;

/** Store'un atadığı alanlar dışında kalan, event üretirken verilen kısım. */
export type EventInput = Omit<MissionEvent, "id" | "seq" | "ts" | "schemaVersion">;

/**
 * Agent kaynaklı event girdisi: `facts` tip düzeyinde yoktur.
 * Prompt injection / beyan şişirme yüzeyini daraltır: agent yalnızca
 * kind + aiSummary + hiyerarşi verebilir, ölçüm alanlarına dokunamaz.
 */
export type AgentEventInput = Omit<EventInput, "facts" | "actor"> & {
  actor: Actor & { type: "agent" };
};

/** Agent girdisini normalize eder: facts ne gelirse gelsin ayıklanır. */
export function agentEventInput(input: AgentEventInput): EventInput {
  // Çalışma anı koruması: tip sistemini aşan çağrılar (any, JSON) için.
  const rest: EventInput = { ...input };
  delete (rest as { facts?: unknown }).facts;
  return rest;
}

export function validateEvent(event: unknown): MissionEvent {
  return missionEventSchema.parse(event);
}
