import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicAdapter, MockAdapter, ModelGateway } from "@mission-control/gateway";
import { LocalSandboxProvider } from "@mission-control/sandbox";
import { formatReport, runEvalSuite } from "./eval.js";
import { GOLDEN_SET } from "./goldenSet.js";

/**
 * `npm run eval` — golden set'i koşar ve raporu yazar.
 *
 * Sürücü seçimi: ANTHROPIC_API_KEY varsa gerçek model, yoksa senaryo
 * betikleri. Rapor hangisiyle koşulduğunu her zaman en üstte yazar.
 */

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../eval-report.md",
);

async function main(): Promise<void> {
  const live = Boolean(process.env.ANTHROPIC_API_KEY);
  const model = process.env.MC_MODEL ?? "claude-sonnet-5";
  const only = process.env.MC_EVAL_ONLY?.split(",").map((s) => s.trim());
  const scenarios = only ? GOLDEN_SET.filter((s) => only.includes(s.name)) : GOLDEN_SET;

  if (scenarios.length === 0) {
    console.error(`No scenarios matched MC_EVAL_ONLY="${process.env.MC_EVAL_ONLY}"`);
    process.exit(1);
  }

  const driver = live ? `live:${model}` : "mock";
  console.log(`Running ${scenarios.length} scenario(s) with driver "${driver}"…\n`);

  const report = await runEvalSuite({
    scenarios,
    sandboxes: new LocalSandboxProvider(),
    driver,
    makeGateway: (scenario) =>
      ModelGateway.fromRecord({
        "developer-default": live
          ? new AnthropicAdapter(model)
          : new MockAdapter(scenario.mockScript, model),
      }),
    onProgress: (result) => {
      const mark = result.ok ? "✅" : "❌";
      const detail = result.ok ? "" : ` — ${result.note ?? ""}`;
      console.log(
        `${mark} ${result.name.padEnd(24)} ${String(result.rounds).padStart(2)} rounds  ` +
          `$${result.costUsd.toFixed(4)}  ${(result.durationMs / 1000).toFixed(1)}s${detail}`,
      );
    },
  });

  const markdown = formatReport(report);
  await writeFile(REPORT_PATH, markdown, "utf8");

  const { summary } = report;
  console.log(
    `\n${summary.passed}/${summary.total} scenarios met their expectation ` +
      `(${(summary.successRate * 100).toFixed(0)}%), total $${summary.totalCostUsd.toFixed(4)}.`,
  );
  console.log(`Report written to ${REPORT_PATH}`);

  // Bir senaryonun beklentisini karşılamaması CI'da görünür olmalı.
  process.exit(summary.passed === summary.total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
