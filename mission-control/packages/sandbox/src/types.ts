/**
 * Sandbox soyutlaması (MASTER_PLAN §14.3).
 *
 * Bu arayüzün varlık sebebi, çalıştırma ortamını değiştirmenin (yerel süreç →
 * Docker → E2B/Firecracker) çekirdek kodu etkilememesidir. Agent runtime
 * yalnızca bu sözleşmeyi görür; hiçbir yerde "docker" kelimesi geçmez.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Süre sınırına takılıp öldürüldüyse true. */
  timedOut: boolean;
  /**
   * Hangi kaynak sınırının komutu sonlandırdığı. `undefined` = sınır
   * nedeniyle sonlanmadı. Bu alan mission'ın "başarılı" sayılmasını
   * engelleyen ölçülmüş bir gerçektir (§7 Katman B).
   */
  limitHit?: ResourceLimitKind;
}

export type ResourceLimitKind = "time" | "memory" | "output" | "process" | "disk";

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

/**
 * Projenin güven seviyesi. **Varsayılan `untrusted` olmalıdır**: bir çağıran
 * belirtmeyi unutursa katı yola düşmeli, gevşek yola değil.
 *
 * `trusted` yalnızca kaynağını bizim ürettiğimiz kod içindir (golden
 * fixture'lar). Kullanıcıdan gelen her şey `untrusted`'dır.
 */
export type TrustLevel = "trusted" | "untrusted";

/**
 * Ağ politikası. MVP'de yalnızca `none` implemente edilmiştir (§4).
 * Diğer modlar tip düzeyinde tanımlı ama desteklenmiyor — istenirse
 * açık bir hata verilir, sessizce ağ açılmaz.
 */
export type NetworkPolicy = "none" | "controlled" | "full";

export interface ResourceLimits {
  cpus: number;
  memoryMb: number;
  /** Container içindeki maksimum process sayısı (fork bombası koruması). */
  pids: number;
  /** Tek bir komut için duvar-saat sınırı. */
  execTimeoutMs: number;
  /** stdout+stderr için bayt tavanı; aşılırsa komut öldürülür. */
  maxOutputBytes: number;
  /** Yazılabilir /tmp boyutu (root dosya sistemi salt-okunur olduğu için gerekli). */
  tmpfsMb: number;
  /** Workspace disk kotası — güvenilmeyen kodun host diskini doldurmasını engeller. */
  workspaceMb: number;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  cpus: 1,
  memoryMb: 512,
  pids: 128,
  execTimeoutMs: 120_000,
  maxOutputBytes: 2_000_000,
  tmpfsMb: 64,
  workspaceMb: 512,
};

export interface CreateSandboxOptions {
  missionId: string;
  /** Host üzerindeki proje dizini; workspace'e kopyalanır. */
  sourceDir?: string;
  /** Belirtilmezse `untrusted` kabul edilir (fail-safe). */
  trust?: TrustLevel;
  limits?: Partial<ResourceLimits>;
  network?: NetworkPolicy;
}

export interface Sandbox {
  readonly id: string;
  /** Workspace kökünün host üzerindeki mutlak yolu (yalnızca platform kodu kullanır). */
  readonly rootPath: string;
  readonly limits: ResourceLimits;
  /**
   * Disk kotasının gerçekten çekirdek tarafından mı uygulandığı, yoksa
   * gecikmeli bir ölçüm mü olduğu. Raporlarda dürüstçe gösterilir.
   * `undefined` = bu sağlayıcı workspace kotası uygulamıyor.
   */
  readonly quotaMode?: "loop" | "advisory" | undefined;

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
  /** Bu sağlayıcının güvenilmeyen kodu çalıştırmaya yetkili olup olmadığı. */
  readonly isolatesUntrustedCode: boolean;
  create(options: CreateSandboxOptions): Promise<Sandbox>;
}

/** Workspace dışına çıkmaya çalışan yol erişimi. */
export class PathEscapeError extends Error {
  constructor(readonly attempted: string) {
    super(`Path escapes workspace: ${attempted}`);
    this.name = "PathEscapeError";
  }
}

/**
 * İzolasyon sağlamayan bir sağlayıcıya güvenilmeyen proje verilmeye çalışıldı.
 * Bu bir konfigürasyon hatası değil, güvenlik reddidir — sessizce izin verilen
 * bir "geliştirici kolaylığı" moduna düşürülmez.
 */
export class UntrustedProjectError extends Error {
  constructor(readonly providerKind: string) {
    super(
      `Refusing to run an untrusted project in "${providerKind}", which does not isolate code. ` +
        `Use an isolating sandbox provider (e.g. docker) for user-supplied projects.`,
    );
    this.name = "UntrustedProjectError";
  }
}

/** Çalıştırma arka ucu (ör. Docker daemon) kullanılamıyor. */
export class SandboxUnavailableError extends Error {
  constructor(
    readonly providerKind: string,
    detail: string,
  ) {
    super(`Sandbox backend "${providerKind}" is unavailable: ${detail}`);
    this.name = "SandboxUnavailableError";
  }
}

/** Desteklenmeyen ağ politikası — sessizce "none"a düşmek yerine hata. */
export class UnsupportedNetworkPolicyError extends Error {
  constructor(readonly policy: NetworkPolicy) {
    super(`Network policy "${policy}" is not implemented; only "none" is supported.`);
    this.name = "UnsupportedNetworkPolicyError";
  }
}

export function resolveLimits(overrides?: Partial<ResourceLimits>): ResourceLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}
