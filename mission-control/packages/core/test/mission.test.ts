import { describe, expect, it } from "vitest";
import {
  canTransition,
  InvalidTransitionError,
  isTerminal,
  MISSION_STATUSES,
  transition,
  type Mission,
} from "../src/index.js";

function mission(status: Mission["status"]): Mission {
  return { id: "m1", goal: "fix auth", status, version: 1, createdAt: new Date().toISOString() };
}

describe("mission state machine", () => {
  it("referans akış (§6) baştan sona geçerli: recovery döngüsü dahil", () => {
    let m = mission("created");
    for (const next of [
      "planning",
      "awaiting_approval",
      "running",
      "verifying",
      "recovering",
      "running",
      "verifying",
      "completed",
    ] as const) {
      m = transition(m, next);
    }
    expect(m.status).toBe("completed");
    expect(m.version).toBe(9);
  });

  it("geçersiz geçiş fırlatır ve mission'ı değiştirmez", () => {
    const m = mission("created");
    expect(() => transition(m, "completed")).toThrow(InvalidTransitionError);
    expect(m.status).toBe("created");
    expect(m.version).toBe(1);
  });

  it("terminal durumlardan hiçbir geçiş yoktur", () => {
    for (const terminal of ["completed", "failed", "cancelled"] as const) {
      expect(isTerminal(terminal)).toBe(true);
      for (const target of MISSION_STATUSES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("suspended'dan devam ve iptal mümkün, tamamlanma mümkün değil", () => {
    expect(canTransition("suspended", "running")).toBe(true);
    expect(canTransition("suspended", "cancelled")).toBe(true);
    expect(canTransition("suspended", "completed")).toBe(false);
  });
});
