import type { Sandbox } from "@mission-control/sandbox";

/**
 * VerificationRunner (MASTER_PLAN §11.4 Coding Pack).
 *
 * Çekirdek yalnızca `verification.run → {passed, failed}` görür; "pytest" veya
 * "npm test" bilgisi bu dosyada kalır. Kod-dışı bir pack eklendiğinde çekirdek
 * değişmez, yalnızca bu arayüzün başka bir implementasyonu yazılır.
 *
 * Sonuçlar AGENT BEYANINDAN DEĞİL, sürecin çıkış kodundan ve çıktısından
 * ölçülür — timeline'ın Katman B'si (§7) buraya dayanır.
 */

export interface VerificationResult {
  passed: number;
  failed: number;
  exitCode: number;
  command: string;
  durationMs: number;
  /** Explain adımının (Faz 3) girdisi olacak kırpılmış çıktı. */
  output: string;
  /** Hiç test bulunamadı/koşulamadıysa true — "0 failed" ile karıştırılmamalı. */
  inconclusive: boolean;
}

const MAX_OUTPUT_CHARS = 8_000;

export interface VerificationPlan {
  command: string;
  args: string[];
}

/** Proje tipini dosyalardan tespit eder; bulamazsa null döner (uydurmaz). */
export async function detectVerification(sandbox: Sandbox): Promise<VerificationPlan | null> {
  const files = await sandbox.listFiles();
  const hasPythonTests = files.some(
    (file) => /(^|\/)test_[^/]+\.py$/.test(file) || /_test\.py$/.test(file),
  );
  if (hasPythonTests) return { command: "python3", args: ["-m", "pytest", "-q"] };

  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(await sandbox.readFile("package.json")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.test) return { command: "npm", args: ["test", "--silent"] };
    } catch {
      // Bozuk package.json bir tespit sinyali değildir; sessizce geçiyoruz.
    }
  }
  return null;
}

export async function runVerification(sandbox: Sandbox): Promise<VerificationResult> {
  const plan = await detectVerification(sandbox);
  if (!plan) {
    return {
      passed: 0,
      failed: 0,
      exitCode: -1,
      command: "(none detected)",
      durationMs: 0,
      output: "No test suite detected in this project.",
      inconclusive: true,
    };
  }

  const res = await sandbox.exec(plan.command, plan.args, { timeoutMs: 180_000 });
  const combined = `${res.stdout}\n${res.stderr}`;
  const counts = parseCounts(combined);
  const command = [plan.command, ...plan.args].join(" ");

  return {
    passed: counts.passed,
    failed: counts.failed,
    exitCode: res.exitCode,
    command,
    durationMs: res.durationMs,
    output: clip(combined.trim()),
    // Çıkış kodu sıfır değil ama hiç test sayısı okunamadıysa, "0 hata" demek
    // yanıltıcı olur: toplama/çökme hatası da olabilir.
    inconclusive: res.timedOut || (counts.passed === 0 && counts.failed === 0),
  };
}

/** pytest ve node test runner'larının özet satırlarını okur. */
export function parseCounts(output: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  // pytest: "2 failed, 2 passed in 0.03s" / "4 passed in 0.02s"
  const pytestPassed = output.match(/(\d+) passed/);
  const pytestFailed = output.match(/(\d+) failed/);
  const pytestErrors = output.match(/(\d+) errors?\b/);
  if (pytestPassed) passed = Number(pytestPassed[1]);
  if (pytestFailed) failed = Number(pytestFailed[1]);
  if (pytestErrors) failed += Number(pytestErrors[1]);
  if (passed || failed) return { passed, failed };

  // node:test / vitest: "# pass 3" / "# fail 1" veya "Tests  3 passed (4)"
  const nodePass = output.match(/^#\s*pass\s+(\d+)/m);
  const nodeFail = output.match(/^#\s*fail\s+(\d+)/m);
  if (nodePass) passed = Number(nodePass[1]);
  if (nodeFail) failed = Number(nodeFail[1]);

  return { passed, failed };
}

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const head = text.slice(0, MAX_OUTPUT_CHARS / 2);
  const tail = text.slice(-MAX_OUTPUT_CHARS / 2);
  return `${head}\n…[truncated]…\n${tail}`;
}
