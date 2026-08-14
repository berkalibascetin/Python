import { describe, expect, it } from "vitest";
import { containsSecret } from "@mission-control/core";
import { MockAdapter, ModelGateway } from "@mission-control/gateway";
import { LocalSandboxProvider } from "@mission-control/sandbox";
import {
  formatReport,
  GOLDEN_SET,
  interpretScore,
  runEvalSuite,
  type GoldenScenario,
} from "../src/index.js";

/**
 * Benchmark metrikleri ve failure sınıflandırması (PHASE_1C §9, §10, §11).
 *
 * Bunlar canlı model gerektirmez: ölçülen şey harness'ın doğru metrik
 * topladığı ve başarısızlıkları doğru sınıflandırdığıdır.
 */

const sandboxes = new LocalSandboxProvider();

function scenario(name: string): GoldenScenario {
  const found = GOLDEN_SET.find((s) => s.name === name);
  if (!found) throw new Error(`unknown scenario ${name}`);
  return found;
}

const gatewayFor = (s: GoldenScenario) =>
  ModelGateway.fromRecord({ "developer-default": new MockAdapter(s.mockScript, "claude-sonnet-5") });

describe("eval metrikleri", () => {
  it("model çağrısı, tool çağrısı, token ve gecikmeyi toplar", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("py-auth-bug")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });

    const r = report.results[0]!;
    expect(r.metrics.modelCalls).toBeGreaterThan(0);
    expect(r.metrics.toolCalls).toBeGreaterThan(0); // shell.run sayılmalı
    expect(r.metrics.inputTokens).toBeGreaterThan(0);
    expect(r.metrics.outputTokens).toBeGreaterThan(0);
    expect(r.metrics.latencyMs).toBeGreaterThan(0);
    expect(r.linesAdded).toBeGreaterThan(0);

    expect(report.summary.meanLatencyMs).toBeGreaterThan(0);
    expect(report.summary.totalInputTokens).toBe(r.metrics.inputTokens);
    // Hepsi başarılıysa başarı başına maliyet = toplam maliyet.
    expect(report.summary.costPerSuccessUsd).toBeCloseTo(report.summary.totalCostUsd, 6);
  }, 120_000);

  it("başarılı mission başına maliyet, başarısızların maliyetini de içerir", async () => {
    const lazy: GoldenScenario = {
      ...scenario("py-off-by-one"),
      mockScript: [{ text: "Looks fine to me." }],
    };
    const report = await runEvalSuite({
      scenarios: [scenario("py-auth-bug"), lazy],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });

    expect(report.summary.passed).toBe(1);
    // İki mission'ın toplam maliyeti tek başarıya yüklenir.
    expect(report.summary.costPerSuccessUsd).toBeGreaterThan(report.summary.meanCostUsd);
  }, 180_000);
});

describe("failure sınıflandırma", () => {
  it("hiç değişiklik yapmayan agent 'no_change_attempted' olarak sınıflanır", async () => {
    const lazy: GoldenScenario = {
      ...scenario("py-off-by-one"),
      mockScript: [{ text: "Nothing to do here." }],
    };
    const report = await runEvalSuite({
      scenarios: [lazy],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(report.results[0]?.failureClass).toBe("no_change_attempted");
    expect(report.summary.failureBreakdown["no_change_attempted"]).toBe(1);
  }, 120_000);

  it("yanlış düzeltme 'verification_failure' olarak sınıflanır", async () => {
    const wrong: GoldenScenario = {
      ...scenario("py-off-by-one"),
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
        { text: "Done." },
      ],
    };
    const report = await runEvalSuite({
      scenarios: [wrong],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(report.results[0]?.failureClass).toBe("verification_failure");
  }, 120_000);

  it("çalışan projeyi bozan agent 'wrong_edit' olarak sınıflanır", async () => {
    const vandal: GoldenScenario = {
      ...scenario("py-already-green"),
      mockScript: [
        {
          text: "Simplifying.",
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
    expect(report.results[0]?.failureClass).toBe("wrong_edit");
  }, 120_000);

  it("bütçe tükenmesi ayrı sınıflanır", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("py-auth-bug")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
      budgetUsd: 0.0001,
    });
    expect(report.results[0]?.failureClass).toBe("budget_exhaustion");
  }, 120_000);
});

describe("eşik yorumu", () => {
  it("üç bandı doğru ayırır", () => {
    expect(interpretScore(10, 10)).toBe("Strong signal");
    expect(interpretScore(8, 10)).toBe("Strong signal");
    expect(interpretScore(7, 10)).toBe("Promising but needs improvement");
    expect(interpretScore(6, 10)).toBe("Promising but needs improvement");
    expect(interpretScore(5, 10)).toContain("Do not proceed to multi-agent");
    expect(interpretScore(0, 10)).toContain("Do not proceed to multi-agent");
  });
});

describe("rapor ayrımı", () => {
  it("mock raporu model yeteneği iddiasından açıkça ayrılır", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("no-tests")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    const md = formatReport(report);
    expect(md).toContain("DRIVER: mock");
    expect(md).toContain("Mock score ≠ model capability");
  }, 120_000);

  it("rapor metninde sır sızıntısı olmaz", async () => {
    const report = await runEvalSuite({
      scenarios: [scenario("py-auth-bug")],
      sandboxes,
      driver: "mock",
      makeGateway: gatewayFor,
    });
    expect(containsSecret(formatReport(report))).toBe(false);
  }, 120_000);
});
