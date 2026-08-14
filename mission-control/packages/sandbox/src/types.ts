/**
 * Sandbox soyutlaması (MASTER_PLAN §14.3).
 *
 * Bu arayüzün varlık sebebi, çalıştırma ortamını değiştirmenin (yerel süreç →
 * Docker → E2B/Modal) çekirdek kodu etkilememesidir. Agent runtime yalnızca
 * bu sözleşmeyi görür.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Süre sınırına takılıp öldürüldüyse true. */
  timedOut: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Workspace köküne göreli çalışma dizini. */
  cwd?: string;
}

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export interface Sandbox {
  readonly id: string;
  /** Workspace kökünün host üzerindeki mutlak yolu (yalnızca platform kodu kullanır). */
  readonly rootPath: string;

  /** Allowlist kontrolü ÇAĞIRANIN sorumluluğudur; sandbox verileni çalıştırır. */
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  listFiles(relDir?: string): Promise<string[]>;
  /** Workspace açıldığından beri değişenlerin özeti — timeline `facts`'inin kaynağı. */
  diffStat(): Promise<DiffStat>;
  unifiedDiff(): Promise<string>;
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  readonly kind: string;
  /** Ağ erişimi, kaynak limiti ve izolasyon garantisi implementasyona bağlıdır. */
  create(options: { missionId: string; sourceDir?: string }): Promise<Sandbox>;
}

/** Workspace dışına çıkmaya çalışan yol erişimi. */
export class PathEscapeError extends Error {
  constructor(readonly attempted: string) {
    super(`Path escapes workspace: ${attempted}`);
    this.name = "PathEscapeError";
  }
}
