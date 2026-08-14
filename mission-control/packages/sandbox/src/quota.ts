import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Workspace disk kotası (PHASE_1C §3).
 *
 * ── Neden `--storage-opt` KULLANILMIYOR ─────────────────────────────────
 * Docker `--storage-opt size=` bayrağını bazı depolama sürücülerinde
 * **sessizce yok sayar**: bayrak hatasız kabul edilir, container başlar ve
 * limitin üstünde yazmaya devam eder. Bu ortamda ölçüldü — `size=64m` ile
 * başlatılan bir container 300 MB yazabildi. Böyle bir mekanizmayı kota diye
 * sunmak, olmayan bir korumayı varmış gibi göstermek olurdu.
 *
 * ── Gerçekten uygulanan kota ────────────────────────────────────────────
 * `loop` modu: workspace, sabit boyutlu bir ext4 imajı üzerine bağlanır.
 * Limit çekirdek tarafından uygulanır; taşan yazma ENOSPC alır. Host diskinde
 * ayrılan yer imaj boyutuyla sınırlıdır. Linux + root + loop aygıtı gerektirir.
 *
 * ── Kota kurulamadığında ────────────────────────────────────────────────
 * `advisory` moduna düşülür: workspace boyutu çalışma sırasında periyodik
 * ölçülür ve aşımda komut öldürülür. Bu bir gecikmeli kontroldür, çekirdek
 * garantisi DEĞİLDİR ve raporlarda böyle etiketlenir.
 */

export type QuotaMode = "loop" | "advisory";

export interface WorkspaceQuota {
  mode: QuotaMode;
  limitBytes: number;
  /** `loop` modunda bağlama noktasını serbest bırakır. */
  release(): Promise<void>;
}

export interface QuotaSetupOptions {
  /** Bağlanacak dizin (workspace kökü). */
  mountPoint: string;
  /** İmaj dosyasının konacağı dizin (bağlama noktasının dışında olmalı). */
  imageDir: string;
  limitBytes: number;
  /** Test edilebilirlik için: `loop` modunu zorla devre dışı bırakır. */
  disableLoop?: boolean;
}

/**
 * Kotayı kurmayı dener. `loop` başarısız olursa sessizce çökmez —
 * `advisory` moduna düşer ve bunu çağırana bildirir.
 */
export async function setupWorkspaceQuota(options: QuotaSetupOptions): Promise<WorkspaceQuota> {
  const { mountPoint, imageDir, limitBytes } = options;
  await mkdir(mountPoint, { recursive: true });

  if (options.disableLoop || process.platform !== "linux") {
    return advisoryQuota(limitBytes);
  }

  await mkdir(imageDir, { recursive: true });
  const imagePath = join(imageDir, "workspace.img");

  const truncated = await run("truncate", ["-s", String(limitBytes), imagePath]);
  if (truncated.exitCode !== 0) return advisoryQuota(limitBytes);

  const formatted = await run("mkfs.ext4", ["-q", "-F", "-m", "0", imagePath]);
  if (formatted.exitCode !== 0) {
    await rm(imagePath, { force: true });
    return advisoryQuota(limitBytes);
  }

  const mounted = await run("mount", ["-o", "loop", imagePath, mountPoint]);
  if (mounted.exitCode !== 0) {
    await rm(imagePath, { force: true });
    return advisoryQuota(limitBytes);
  }

  // Container non-root çalıştığı için bağlanan dosya sistemine yazabilmeli.
  await run("chmod", ["0777", mountPoint]);

  return {
    mode: "loop",
    limitBytes,
    async release() {
      // Bağlama çözülmeden dizin silinirse host'ta imaj sızıntısı kalır.
      await run("umount", ["-l", mountPoint]);
      await rm(imagePath, { force: true });
    },
  };
}

function advisoryQuota(limitBytes: number): WorkspaceQuota {
  return {
    mode: "advisory",
    limitBytes,
    async release() {
      /* bağlama yok; temizlik workspace silinmesiyle olur */
    },
  };
}

/** Workspace'in o anki disk kullanımı — advisory modun ölçüm kaynağı. */
export async function measureDirectorySize(dir: string): Promise<number> {
  const res = await run("du", ["-sb", dir]);
  if (res.exitCode !== 0) {
    const info = await stat(dir).catch(() => null);
    return info?.size ?? 0;
  }
  const parsed = Number.parseInt(res.stdout.trim().split(/\s+/)[0] ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function run(
  command: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => resolvePromise({ exitCode: 127, stdout, stderr: err.message }));
    child.on("close", (code) => resolvePromise({ exitCode: code ?? 1, stdout, stderr }));
  });
}
