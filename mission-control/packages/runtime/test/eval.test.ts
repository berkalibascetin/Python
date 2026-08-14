import { describe, expect, it } from "vitest";
import { MockAdapter, ModelGateway } from "@mission-control/gateway";
import { LocalSandboxProvider } from "@mission-control/sandbox";
import { formatReport, GOLDEN_SET, runEvalSuite, type GoldenScenario } from "../src/index.js";

/**
 * Harness'ın kendisinin testi: doğru senaryoyu geçirdiği kadar, YANLIŞ
 * sonucu da yakaladığını kanıtlamalı. Her şeye "✅" diyen bir eval, hiç
 * eval olmamasından beterdir.
 */

const sandboxes = new LocalSandboxProvider();

function scenario(name: string): GoldenScenario {
  const found = GOLDEN_SET.find((s) => s.name === name);
  if (!found) throw new Error(`unknown scenario ${name}`);
  return found;
}

function gatewayFor(s: GoldenScenario) {
  return ModelGateway.fromRecord({
    "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5"),
  });
}

describe("eval harness", () => {
  it("düzelten senaryoyu geçirir ve metrikleri toplar", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("py-off-by-one")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });

    expect(report.summary.passed).toBe(1);
    expect(report.summary.successRate).toBe(1);
    expect(report.summary.totalCostUsd).toBeGreaterThan(0);
    const result = report.results[0]!;
    expect(result.before.failed).toBe(2);
    expect(result.after.failed).toBe(0);
    expect(result.filesChanged).toBe(1);
  }, 60_000);

  it("testleri düzeltmeyen bir agent'ı geçirmez", async () => {
    const broken: GoldenScenario = {
      ...scenario("py-off-by-one"),
      // Dosyaya dokunur ama kusuru düzeltmez.
      mockScript: [
        {
          text: "Adding a comment.",
          toolCalls: [
            {
              name: "repo.write",
              input: {
                path: "slicing.py",
                old_string: "def last_n(items, n):",
                new_string: "# helper\ndef last_n(items, n):",
              },
            },
          ],
        },
        { text: "All fixed!" },
      ],
    };

    const report = await runEvalSuite({
      scenarios: [broken],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });

    expect(report.summary.passed).toBe(0);
    expect(report.results[0]?.note).toContain("still failing");
  }, 60_000);

  it("hiçbir şey değiştirmeden 'tamam' diyen agent'ı geçirmez", async () => {
    const lazy: GoldenScenario = {
      ...scenario("py-off-by-one"),
      mockScript: [{ text: "Looks fine to me." }],
    };
    const report = await runEvalSuite({
      scenarios: [lazy],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(report.summary.passed).toBe(0);
  }, 60_000);

  it("doğrulanamayan projede başarı iddiasını başarısızlık sayar", async () => {
    // no-tests senaryosu: sistem "başardım" DEMEMELİ.
    const report = await runEvalSuite({
      scenarios: [scenario("no-tests")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(report.summary.passed).toBe(1);
    expect(report.results[0]?.missionStatus).not.toBe("completed");
  }, 60_000);

  it("çalışan projeyi bozan agent'ı yakalar", async () => {
    const vandal: GoldenScenario = {
      ...scenario("py-already-green"),
      mockScript: [
        {
          text: "I'll simplify this.",
          toolCalls: [
            {
              name: "repo.write",
              input: {
                path: "inventory.py",
                old_string: "    updated = dict(counts)",
                new_string: "    updated = counts",
              },
            },
          ],
        },
        { text: "Done." },
      ],
    };
    const report = await runEvalSuite({
      scenarios: [vandal],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(report.summary.passed).toBe(0);
    expect(report.results[0]?.note).toContain("broken");
  }, 60_000);

  it("mock sürücüyle üretilen raporu açıkça etiketler", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("no-tests")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    const markdown = formatReport(report);
    expect(markdown).toContain("mock sürücüyle");
    expect(markdown).toContain("model yeteneğini değil");
  }, 60_000);
});
