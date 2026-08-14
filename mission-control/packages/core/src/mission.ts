/**
 * Mission state machine (MASTER_PLAN §6, §12, §13.3).
 * Geçişler burada merkezi olarak tanımlanır; orchestrator yalnızca
 * `transition()` üzerinden durum değiştirir — geçersiz geçiş hatadır,
 * sessiz düzeltme yoktur (idempotent consumer'lar geçersiz geçişi
 * event olarak kaydedip state'i değiştirmez).
 */

export const MISSION_STATUSES = [
  "created",
  "planning",
  "awaiting_approval",
  "running",
  "verifying",
  "recovering",
  "suspended",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

const TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  created: ["planning", "cancelled"],
  planning: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["running", "cancelled"],
  running: ["verifying", "suspended", "failed", "cancelled"],
  verifying: ["completed", "recovering", "failed", "cancelled"],
  // Fix turu yeni bir çalışma dilimidir: recovering → running → verifying döngüsü.
  recovering: ["running", "suspended", "failed", "cancelled"],
  suspended: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly MissionStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: MissionStatus,
    readonly to: MissionStatus,
  ) {
    super(`Invalid mission transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  /** Optimistic locking için (§13.3); her geçişte artar. */
  version: number;
  createdAt: string;
}

export function transition(mission: Mission, to: MissionStatus): Mission {
  if (!canTransition(mission.status, to)) {
    throw new InvalidTransitionError(mission.status, to);
  }
  return { ...mission, status: to, version: mission.version + 1 };
}
