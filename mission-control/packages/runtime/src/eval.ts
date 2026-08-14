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

/**
 * Başarısızlık taksonomisi (PHASE_1C §11).
 *
 * "FAILED" tek başına işe yaramaz: gerçek modelin NEDEN başarısız olduğunu
 * bilmeden neyin düzeltilmesi gerektiği (prompt mu, tool arayüzü mi, context
 * mi, model mi) anlaşılamaz.
 */
export type FailureClass =
  | "verification_failure" // değişiklik yapıldı ama testler hâlâ kırmızı
  | "no_change_attempted" // agent hiçbir şey değiştirmeden bitirdi
  | "wrong_edit" // dosya değişti, testler bozuldu/düzelmedi
  | "tool_misuse" // tool çağrıları sürekli hata döndü
  | "budget_exhaustion"
  | "round_limit"
  | "thrashing"
  | "timeout"
  | "model_refusal"
  | "provider_error"
  | "sandbox_failure"
  | "unverifiable" // doğrulanamayan proje (beklenen olabilir)
  | "harness_error"
  | "other";

export interface ScenarioMetrics {
  /** Model çağrısı sayısı (= tur). */
  modelCalls: number;
  toolCalls: number;
  /** Hata dönen tool çağrıları — tool arayüzü sorunlarının sinyali. */
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Mission'ın uçtan uca duvar-saat süresi. */
  latencyMs: number;
}

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
  linesAdded: number;
  linesRemoved: number;
  rounds: number;
  costUsd: number;
  durationMs: number;
  metrics: ScenarioMetrics;
  /** ok=false olduğunda sınıflandırılmış sebep. */
  failureClass?: FailureClass;
  /** ok=false olduğunda insan-okunur açıklama. */
  note?: string;
}

export interface EvalReport {
  /** "mock" veya "live:<model>" — raporun anlamını belirleyen tek alan. */
  driver: string;
  /** Hangi sandbox sağlayıcısıyla koşuldu (izolasyonlu mu değil mi). */
  sandboxKind: string;
  startedAt: string;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    successRate: number;
    totalCostUsd: number;
    meanRounds: number;
    totalDurationMs: number;
    /** Başarılı mission başına maliyet — başarısızların maliyeti de dahil. */
    costPerSuccessUsd: number;
    meanLatencyMs: number;
    meanCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    /** Başarısızlık sınıfı → adet. Neyin düzeltileceğini bu tablo söyler. */
    failureBreakdown: Record<string, number>;
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
        // Golden set bizim ürettiğimiz fixture'lardan oluşur; kullanıcı
        // projesi değildir. Bu yüzden izolasyonsuz sağlayıcıyla da
        // koşabilir (Docker'ın olmadığı CI ortamları için).
        trust: "trusted",
      });

      const timeline = await events.list(run.mission.id);
      const verifications = timeline.filter((e) => e.kind === "verification.run");
      const before = readVerification(verifications[0]);
      const after = {
        passed: run.verification?.passed ?? 0,
        failed: run.verification?.failed ?? 0,
        inconclusive: run.verification?.inconclusive ?? true,
      };
      const changes = timeline.find((e) => e.kind === "artifact.created")?.facts?.changes;
      const filesChanged = changes?.files ?? 0;
      const durationMs = Date.now() - started;

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
        linesAdded: changes?.added ?? 0,
        linesRemoved: changes?.removed ?? 0,
        rounds: run.outcome.rounds,
        costUsd: run.costUsd,
        durationMs,
        metrics: collectMetrics(timeline, run.costUsd, durationMs),
        ...(judgement.ok
          ? {}
          : {
              failureClass: classifyFailure(scenario, run.outcome.status, after, filesChanged),
            }),
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
        linesAdded: 0,
        linesRemoved: 0,
        rounds: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        metrics: {
          modelCalls: 0,
          toolCalls: 0,
          toolErrors: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - started,
        },
        failureClass: "harness_error",
        note: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);
    options.onProgress?.(result);
  }

  const passed = results.filter((r) => r.ok).length;
  const n = results.length;
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const failureBreakdown: Record<string, number> = {};
  for (const r of results) {
    if (r.ok || !r.failureClass) continue;
    failureBreakdown[r.failureClass] = (failureBreakdown[r.failureClass] ?? 0) + 1;
  }

  const mean = (pick: (r: ScenarioResult) => number) =>
    n === 0 ? 0 : Number((results.reduce((sum, r) => sum + pick(r), 0) / n).toFixed(4));

  return {
    driver,
    sandboxKind: sandboxes.kind,
    startedAt,
    results,
    summary: {
      total: n,
      passed,
      successRate: n === 0 ? 0 : passed / n,
      totalCostUsd: Number(totalCost.toFixed(6)),
      meanRounds: mean((r) => r.rounds),
      totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
      // Başarısız mission'ların maliyeti de başarılılara yüklenir: gerçek
      // birim maliyet budur (§19.1).
      costPerSuccessUsd: passed === 0 ? 0 : Number((totalCost / passed).toFixed(6)),
      meanLatencyMs: Math.round(mean((r) => r.durationMs)),
      meanCostUsd: mean((r) => r.costUsd),
      totalInputTokens: results.reduce((sum, r) => sum + r.metrics.inputTokens, 0),
      totalOutputTokens: results.reduce((sum, r) => sum + r.metrics.outputTokens, 0),
      failureBreakdown,
    },
  };
}

/** Metrikler timeline'daki ÖLÇÜLMÜŞ facts'ten toplanır, agent beyanından değil. */
function collectMetrics(
  timeline: MissionEvent[],
  costUsd: number,
  latencyMs: number,
): ScenarioMetrics {
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of timeline) {
    if (event.kind !== "execution.step" || !event.facts) continue;
    if (event.facts.tokens) {
      modelCalls += 1;
      inputTokens += event.facts.tokens.input;
      outputTokens += event.facts.tokens.output;
    }
    if (event.facts.commands) toolCalls += event.facts.commands.length;
  }

  return {
    modelCalls,
    toolCalls,
    // Tool hatası ayrı bir event taşımıyor; komut çıkış kodlarından sayılır.
    toolErrors: timeline
      .filter((e) => e.kind === "execution.step")
      .flatMap((e) => e.facts?.commands ?? [])
      .filter((c) => c.exitCode !== 0).length,
    inputTokens,
    outputTokens,
    costUsd,
    latencyMs,
  };
}

/**
 * Başarısızlığı sınıflandırır. Amaç suçlu bulmak değil, hangi katmanın
 * (prompt, tool arayüzü, context, model, sandbox) iyileştirilmesi
 * gerektiğini gösterebilmek.
 */
function classifyFailure(
  scenario: GoldenScenario,
  outcomeStatus: string,
  after: { failed: number; inconclusive: boolean },
  filesChanged: number,
): FailureClass {
  switch (outcomeStatus) {
    case "budget_exceeded":
      return "budget_exhaustion";
    case "max_rounds":
      return "round_limit";
    case "thrashing":
      return "thrashing";
    case "refused":
      return "model_refusal";
    case "provider_error":
      return "provider_error";
    default:
      break;
  }
  if (after.inconclusive) return "unverifiable";
  if (scenario.expect === "fix" && filesChanged === 0) return "no_change_attempted";
  if (scenario.expect === "already-green" && after.failed > 0) return "wrong_edit";
  if (after.failed > 0) return "verification_failure";
  return "other";
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

/**
 * Başarı eşiği yorumu (PHASE_1C §10). Otomatik "ürün başarılı" kararı
 * VERMEZ — yalnızca sonucu üç bantta konumlandırır.
 */
export function interpretScore(passed: number, total: number): string {
  if (total === 0) return "no scenarios ran";
  const ratio = passed / total;
  if (ratio >= 0.8) return "Strong signal";
  if (ratio >= 0.6) return "Promising but needs improvement";
  return "Do not proceed to multi-agent yet; diagnose failure modes";
}

/** Raporun markdown hâli — CI çıktısı ve dokümantasyon için. */
export function formatReport(report: EvalReport): string {
  const { summary } = report;
  const isMock = report.driver.startsWith("mock");
  const pct = (summary.successRate * 100).toFixed(0);
  const lines = [
    `# Agent eval raporu`,
    ``,
    `## DRIVER: ${report.driver}`,
    ``,
    `| Metrik | Değer |`,
    `|---|---|`,
    `| Sonuç | **${summary.passed}/${summary.total}** (%${pct}) |`,
    `| Değerlendirme | ${interpretScore(summary.passed, summary.total)} |`,
    `| Sandbox | \`${report.sandboxKind}\` |`,
    `| Ortalama tur | ${summary.meanRounds} |`,
    `| Ortalama maliyet | $${summary.meanCostUsd.toFixed(4)} |`,
    `| Ortalama gecikme | ${(summary.meanLatencyMs / 1000).toFixed(1)}s |`,
    `| Toplam maliyet | $${summary.totalCostUsd.toFixed(4)} |`,
    `| Başarılı mission başına maliyet | $${summary.costPerSuccessUsd.toFixed(4)} |`,
    `| Token (in/out) | ${summary.totalInputTokens.toLocaleString()} / ${summary.totalOutputTokens.toLocaleString()} |`,
    `| Tarih | ${report.startedAt} |`,
    ``,
  ];

  if (isMock) {
    lines.push(
      `> ⚠️ **Mock score ≠ model capability.** Bu koşu senaryo betikleriyle`,
      `> yapıldı; başarı oranı harness'ın ve agent döngüsünün doğruluğunu`,
      `> gösterir, modelin bu bug'ları bulabildiğini DEĞİL. Model yeteneği`,
      `> yalnızca \`live:*\` sürücüsüyle ölçülür.`,
      ``,
    );
  }

  lines.push(
    `| Senaryo | Kusur sınıfı | Beklenti | Sonuç | Testler | Dosya | +/− | Tur | Tool | Maliyet | Süre |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const r of report.results) {
    const before = r.before.inconclusive ? "n/a" : `${r.before.passed}/${r.before.passed + r.before.failed}`;
    const after = r.after.inconclusive ? "n/a" : `${r.after.passed}/${r.after.passed + r.after.failed}`;
    const verdict = r.ok ? "✅" : `❌ ${r.failureClass ?? ""}`;
    lines.push(
      `| \`${r.name}\` | ${r.defectClass} | ${r.expect} | ${verdict} | ${before} → ${after} | ` +
        `${r.filesChanged} | +${r.linesAdded}/−${r.linesRemoved} | ${r.rounds} | ` +
        `${r.metrics.toolCalls} | $${r.costUsd.toFixed(4)} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }

  const failed = report.results.filter((r) => !r.ok);
  if (failed.length > 0) {
    lines.push(``, `## Failure analysis`, ``);
    for (const [cls, count] of Object.entries(summary.failureBreakdown).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${cls}**: ${count}`);
    }
    lines.push(``, `| Senaryo | Sınıf | Ayrıntı |`, `|---|---|---|`);
    for (const r of failed) {
      lines.push(`| \`${r.name}\` | ${r.failureClass ?? "?"} | ${r.note ?? ""} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}
