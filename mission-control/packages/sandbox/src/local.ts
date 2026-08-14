import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  PathEscapeError,
  type DiffStat,
  type ExecOptions,
  type ExecResult,
  type Sandbox,
  type SandboxProvider,
} from "./types.js";

/**
 * ⚠️ GELİŞTİRME/TEST İÇİN — ÜRETİMDE KULLANILAMAZ.
 *
 * LocalProcessSandbox komutları host üzerinde normal bir çocuk süreç olarak
 * çalıştırır. Sağladığı tek koruma workspace dizinine yol hapsi ve süre
 * limitidir; ŞUNLARI SAĞLAMAZ: ağ izolasyonu, dosya sistemi izolasyonu (mutlak
 * yolla çalışan bir komut host'u görür), kullanıcı/kaynak sınırlaması,
 * sandbox kaçış koruması.
 *
 * Bu yüzden Faz 1a'da yalnızca GÜVENİLEN golden fixture'larla kullanılır.
 * Kullanıcı tarafından yüklenen proje çalıştırılmadan önce izolasyonlu bir
 * implementasyon (Docker / E2B / Firecracker) zorunludur — MASTER_PLAN §14.3
 * ve PHASE_1A_PLAN §A.5'teki açık risk beyanı.
 */
export class LocalProcessSandbox implements Sandbox {
  constructor(
    readonly id: string,
    readonly rootPath: string,
  ) {}

  /** Model kaynaklı yolu workspace'e hapseder — traversal ve mutlak yol reddedilir. */
  private resolveInside(relPath: string): string {
    if (isAbsolute(relPath)) throw new PathEscapeError(relPath);
    const target = resolve(this.rootPath, relPath);
    const rel = relative(this.rootPath, target);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }

  async exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const cwd = options.cwd ? this.resolveInside(options.cwd) : this.rootPath;
    const startedAt = Date.now();

    return new Promise<ExecResult>((resolvePromise) => {
      const child = spawn(command, args, { cwd, env: { ...process.env }, shell: false });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: 127,
          stdout,
          stderr: `${stderr}${err.message}`,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
    });
  }

  async readFile(relPath: string): Promise<string> {
    return readFile(this.resolveInside(relPath), "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const target = this.resolveInside(relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async listFiles(relDir = "."): Promise<string[]> {
    // git ls-files, .gitignore'a saygı duyar ve baseline commit sayesinde
    // yeni eklenen dosyaları da (-o) listeler.
    const res = await this.exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      relDir === "." ? {} : { cwd: relDir },
    );
    return res.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  /** Baseline commit'e göre değişim — timeline `facts.changes`'in ölçüm kaynağı. */
  async diffStat(): Promise<DiffStat> {
    await this.exec("git", ["add", "-A"]);
    const res = await this.exec("git", ["diff", "--cached", "--numstat"]);
    let files = 0;
    let added = 0;
    let removed = 0;
    for (const line of res.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      files += 1;
      // Binary dosyalar "-" döndürür; sayı olmayanı 0 sayıyoruz.
      added += Number.parseInt(parts[0] ?? "0", 10) || 0;
      removed += Number.parseInt(parts[1] ?? "0", 10) || 0;
    }
    return { files, added, removed };
  }

  async unifiedDiff(): Promise<string> {
    await this.exec("git", ["add", "-A"]);
    const res = await this.exec("git", ["diff", "--cached"]);
    return res.stdout;
  }

  async destroy(): Promise<void> {
    await rm(this.rootPath, { recursive: true, force: true });
  }
}

/** Agent'ın yazmadığı, araçların ürettiği dosyalar. */
const ARTIFACT_EXCLUDES = [
  "__pycache__/",
  "*.py[cod]",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".coverage",
  "node_modules/",
  ".venv/",
  "venv/",
  "dist/",
  "build/",
  "*.egg-info/",
  "",
].join("\n");

export class LocalSandboxProvider implements SandboxProvider {
  readonly kind = "local-process";

  constructor(private readonly baseDir = tmpdir()) {}

  async create(options: { missionId: string; sourceDir?: string }): Promise<Sandbox> {
    const root = await mkdtemp(join(this.baseDir, `mc-${options.missionId.slice(0, 8)}-`));
    const sandbox = new LocalProcessSandbox(randomUUID(), root);

    if (options.sourceDir) {
      await cp(options.sourceDir, root, { recursive: true });
    }
    // Baseline commit: diffStat/unifiedDiff'in "ne değişti" ölçümü buna dayanır.
    // Mevcut bir .git varsa geçmişi taşımak yerine sıfırlıyoruz — ölçmek
    // istediğimiz şey agent'ın bu mission'da yaptığı değişiklik.
    await rm(join(root, ".git"), { recursive: true, force: true });
    await sandbox.exec("git", ["init", "-q"]);
    await sandbox.exec("git", ["config", "user.email", "agent@mission-control.local"]);
    await sandbox.exec("git", ["config", "user.name", "Mission Control"]);
    // Derleme/test artefaktları değişim sayısını kirletmemeli: "14 dosya
    // değişti" kullanıcıya gösterilen ölçülmüş bir gerçek, __pycache__ değil.
    // .gitignore yerine .git/info/exclude: çalışma ağacına dosya eklemez.
    await sandbox.writeFile(".git/info/exclude", ARTIFACT_EXCLUDES);
    await sandbox.exec("git", ["add", "-A"]);
    await sandbox.exec("git", ["commit", "-q", "-m", "baseline", "--allow-empty"]);
    return sandbox;
  }
}
