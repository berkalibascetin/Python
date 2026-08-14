import { InMemoryEventStore, type MissionEvent } from "@mission-control/core";
import type { ModelGateway } from "@mission-control/gateway";
import type { SandboxProvider } from "@mission-control/sandbox";
import { runMission } from "./missionRunner.js";
import type { GoldenScenario } from "./goldenSet.js";

/**
 * Eval harness (MASTER_PLAN §16).
 *
 * Klasik yazılım testleri agent sistemleri için yetmez: davranış
 * non-deterministik ve model-bağımlıdır, kalite "doğru/yanlış" değil
 * dağılımsaldır. Bu yüzden test piramidinin üstüne dataset tabanlı,
 * sürekli koşan bir ölçüm katmanı gerekir. Bu dosya onun ilk hâli.
 *
 * Sürücü (mock/live) dışarıdan enjekte edilir — canlı ölçüme geçmek için
 * tek satır konfigürasyon değişir, harness'ta hiçbir şey değişmez.
 */

export interface ScenarioResult {
  name: string;
  defectClass: string;
  expect: GoldenScenario["expect"];
  /** Senaryonun kanıtlaması gereken şey gerçekleşti mi. */
  ok: boolean;
  missionStatus: string;
  before: { passed: number; failed: number; inconclusive: boolean };
  after: { passed: number; failed: number; inconclusive: boolean };
  filesChanged: number;
  rounds: number;
  costUsd: number;
  durationMs: number;
  /** ok=false olduğunda insan-okunur açıklama. */
  note?: string;
}

export interface EvalReport {
  /** "mock" veya "live:<model>" — raporun anlamını belirleyen tek alan. */
  driver: string;
  startedAt: string;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    successRate: number;
    totalCostUsd: number;
    meanRounds: number;
    totalDurationMs: number;
  };
}

export interface RunEvalOptions {
  scenarios: GoldenScenario[];
  sandboxes: SandboxProvider;
  /** Senaryo başına gateway — mock sürücüde her senaryonun kendi betiği vardır. */
  makeGateway(scenario: GoldenScenario): ModelGateway;
  driver: string;
  budgetUsd?: number;
  maxRounds?: number;
  onProgress?(result: ScenarioResult): void;
}

export async function runEvalSuite(options: RunEvalOptions): Promise<EvalReport> {
  const { scenarios, sandboxes, makeGateway, driver, budgetUsd = 2, maxRounds = 12 } = options;
  const startedAt = new Date().toISOString();
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const started = Date.now();
    const events = new InMemoryEventStore();
    let result: ScenarioResult;

    try {
      const run = await runMission({
        goal: scenario.goal,
        sourceDir: scenario.dir,
        gateway: makeGateway(scenario),
        sandboxes,
        events,
        budgetUsd,
        maxRounds,
      });

      const timeline = await events.list(run.mission.id);
      const verifications = timeline.filter((e) => e.kind === "verification.run");
      const before = readVerification(verifications[0]);
      const after = {
        passed: run.verification?.passed ?? 0,
        failed: run.verification?.failed ?? 0,
        inconclusive: run.verification?.inconclusive ?? true,
      };
      const filesChanged =
        timeline.find((e) => e.kind === "artifact.created")?.facts?.changes?.files ?? 0;

      const judgement = judge(scenario, {
        missionStatus: run.mission.status,
        after,
        filesChanged,
      });

      result = {
        name: scenario.name,
        defectClass: scenario.defectClass,
        expect: scenario.expect,
        ok: judgement.ok,
        missionStatus: run.mission.status,
        before,
        after,
        filesChanged,
        rounds: run.outcome.rounds,
        costUsd: run.costUsd,
        durationMs: Date.now() - started,
        ...(judgement.note ? { note: judgement.note } : {}),
      };
    } catch (err) {
      // Harness çökmesi de bir sonuçtur; sessizce atlanmaz.
      result = {
        name: scenario.name,
        defectClass: scenario.defectClass,
        expect: scenario.expect,
        ok: false,
        missionStatus: "harness_error",
        before: { passed: 0, failed: 0, inconclusive: true },
        after: { passed: 0, failed: 0, inconclusive: true },
        filesChanged: 0,
        rounds: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        note: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);
    options.onProgress?.(result);
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    driver,
    startedAt,
    results,
    summary: {
      total: results.length,
      passed,
      successRate: results.length === 0 ? 0 : passed / results.length,
      totalCostUsd: Number(results.reduce((sum, r) => sum + r.costUsd, 0).toFixed(6)),
      meanRounds:
        results.length === 0
          ? 0
          : Number((results.reduce((sum, r) => sum + r.rounds, 0) / results.length).toFixed(2)),
      totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    },
  };
}

function readVerification(event: MissionEvent | undefined) {
  const v = event?.facts?.verification;
  return {
    passed: v?.passed ?? 0,
    failed: v?.failed ?? 0,
    inconclusive: !v || (v.passed === 0 && v.failed === 0),
  };
}

/** Senaryonun beklentisine göre başarı kriteri (§16 cost/behavior eval). */
function judge(
  scenario: GoldenScenario,
  actual: {
    missionStatus: string;
    after: { passed: number; failed: number; inconclusive: boolean };
    filesChanged: number;
  },
): { ok: boolean; note?: string } {
  const { missionStatus, after, filesChanged } = actual;

  switch (scenario.expect) {
    case "fix": {
      if (after.inconclusive) return { ok: false, note: "verification was inconclusive" };
      if (after.failed > 0) return { ok: false, note: `${after.failed} checks still failing` };
      if (filesChanged === 0) return { ok: false, note: "tests pass but nothing was changed" };
      if (missionStatus !== "completed") return { ok: false, note: `mission ended as ${missionStatus}` };
      return { ok: true };
    }
    case "already-green": {
      if (after.failed > 0) return { ok: false, note: "a working project was broken" };
      if (missionStatus !== "completed") return { ok: false, note: `mission ended as ${missionStatus}` };
      return { ok: true };
    }
    case "unverifiable": {
      // Başarı = sistemin doğrulayamadığı bir işi başarılı ilan ETMEMESİ.
      if (missionStatus === "completed") {
        return { ok: false, note: "claimed success without any verification" };
      }
      if (!after.inconclusive) return { ok: false, note: "expected no runnable test suite" };
      return { ok: true };
    }
  }
}

/** Raporun markdown hâli — CI çıktısı ve dokümantasyon için. */
export function formatReport(report: EvalReport): string {
  const { summary } = report;
  const pct = (summary.successRate * 100).toFixed(0);
  const lines = [
    `# Agent eval raporu`,
    ``,
    `- **Sürücü:** \`${report.driver}\``,
    `- **Tarih:** ${report.startedAt}`,
    `- **Başarı:** ${summary.passed}/${summary.total} (%${pct})`,
    `- **Toplam maliyet:** $${summary.totalCostUsd.toFixed(4)}`,
    `- **Ortalama tur:** ${summary.meanRounds}`,
    `- **Süre:** ${(summary.totalDurationMs / 1000).toFixed(1)}s`,
    ``,
  ];

  if (report.driver.startsWith("mock")) {
    lines.push(
      `> ⚠️ Bu koşu **mock sürücüyle** yapıldı. Başarı oranı harness'ın ve agent`,
      `> döngüsünün doğruluğunu gösterir, **model yeteneğini değil**. Gerçek sayı`,
      `> yalnızca canlı sürücüyle oluşur.`,
      ``,
    );
  }

  lines.push(
    `| Senaryo | Kusur sınıfı | Beklenti | Sonuç | Testler (önce → sonra) | Dosya | Tur | Maliyet |`,
    `|---|---|---|---|---|---|---|---|`,
  );
  for (const r of report.results) {
    const before = r.before.inconclusive ? "n/a" : `${r.before.passed}/${r.before.passed + r.before.failed}`;
    const after = r.after.inconclusive ? "n/a" : `${r.after.passed}/${r.after.passed + r.after.failed}`;
    lines.push(
      `| \`${r.name}\` | ${r.defectClass} | ${r.expect} | ${r.ok ? "✅" : `❌ ${r.note ?? ""}`} | ${before} → ${after} | ${r.filesChanged} | ${r.rounds} | $${r.costUsd.toFixed(4)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
