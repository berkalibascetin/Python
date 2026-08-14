import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { measureDirectorySize, setupWorkspaceQuota, type WorkspaceQuota } from "./quota.js";
import {
  PathEscapeError,
  resolveLimits,
  SandboxUnavailableError,
  UnsupportedNetworkPolicyError,
  type CreateSandboxOptions,
  type DiffStat,
  type ExecOptions,
  type ExecResult,
  type NetworkPolicy,
  type ResourceLimits,
  type Sandbox,
  type SandboxProvider,
} from "./types.js";

/**
 * İzolasyonlu Docker sandbox (PHASE_1B).
 *
 * ── Tasarım: iş yükü ile ölçüm ayrılır ──────────────────────────────────
 * Workspace host üzerinde durur. Container'a YALNIZCA çalışma ağacı (`work/`)
 * bind-mount edilir. Platform işlemleri host'ta kalır:
 *
 *   read/write/list  → host dosya sistemi (yol hapsi ile)
 *   exec             → tek kullanımlık container (güvenilmeyen kodun
 *                      çalışabildiği TEK yer)
 *   git / diff       → host'ta, mount DIŞINDA tutulan ayrı bir GIT_DIR ile
 *
 * Bunun güvenlik sonucu önemli: container `.git`'i göremez, dolayısıyla
 * güvenilmeyen kod kendi değişikliğini gizlemek için geçmişi yeniden
 * yazamaz. Timeline'da gösterilen "N dosya değişti" ölçümü, ölçtüğü
 * kodun erişemediği bir yerden gelir.
 *
 * ── Docker bir güvenlik sınırı DEĞİLDİR ─────────────────────────────────
 * Container izolasyonu paylaşılan bir çekirdek üzerinde çalışır. Çekirdek
 * açıkları, yanlış yapılandırma ve yan kanallar kaçış imkânı verebilir.
 * Buradaki bayraklar saldırı yüzeyini ciddi biçimde daraltır ama sıfırlamaz;
 * "container olduğu için güvenli" varsayımı yapılmamıştır. Kalan riskler
 * docs/PHASE_1B_PLAN.md → SECURITY LIMITATIONS bölümünde listelenmiştir.
 */

const LABEL_KEY = "mission-control.sandbox";
const CONTAINER_WORKDIR = "/workspace";

export interface DockerSandboxOptions {
  /** Çalıştırılacak image; toolchain'i içermelidir (python3, node, …). */
  image?: string;
  dockerPath?: string;
  baseDir?: string;
}

/** `docker run` argümanlarını kurar. Saf fonksiyon: Docker olmadan test edilebilir. */
export function buildRunArgs(input: {
  containerName: string;
  missionId: string;
  image: string;
  hostWorkDir: string;
  limits: ResourceLimits;
  network: NetworkPolicy;
  user: string;
  command: string;
  args: string[];
  cwd?: string;
}): string[] {
  if (input.network !== "none") throw new UnsupportedNetworkPolicyError(input.network);

  const workdir = input.cwd ? `${CONTAINER_WORKDIR}/${input.cwd}` : CONTAINER_WORKDIR;
  return [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--label",
    `${LABEL_KEY}=1`,
    "--label",
    `mission-control.mission=${input.missionId}`,
    // Ağ tamamen kapalı: paket indirme, dış API çağrısı ve veri sızdırma yolu yok.
    "--network=none",
    // Root dosya sistemi salt-okunur; yazılabilir tek yer workspace ve /tmp.
    "--read-only",
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,size=${input.limits.tmpfsMb}m,mode=1777`,
    // Tüm capability'ler düşürülür ve yeni ayrıcalık kazanımı engellenir.
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    // Fork bombası ve kaynak tüketimi sınırları.
    `--pids-limit=${input.limits.pids}`,
    `--memory=${input.limits.memoryMb}m`,
    // swap = memory → takas alanına taşarak limiti aşamaz.
    `--memory-swap=${input.limits.memoryMb}m`,
    `--cpus=${input.limits.cpus}`,
    "--user",
    input.user,
    // Yalnızca çalışma ağacı; host'un başka hiçbir yolu görünmez.
    "-v",
    `${input.hostWorkDir}:${CONTAINER_WORKDIR}:rw`,
    "-w",
    workdir,
    input.image,
    input.command,
    ...input.args,
  ];
}

/** Host env'i container'a AKTARMAZ: `-e` ve `--env-file` bilinçli olarak yok. */
function assertNoEnvLeak(args: string[]): void {
  const leaky = args.some((arg) => arg === "-e" || arg === "--env" || arg === "--env-file");
  if (leaky) throw new Error("refusing to forward host environment into the sandbox");
}

export class DockerSandbox implements Sandbox {
  /** Çalışma ağacı: container'a mount edilen tek dizin. */
  private readonly workDir: string;
  /** Git meta dizini: mount EDİLMEZ, container göremez. */
  private readonly gitDir: string;

  constructor(
    readonly id: string,
    readonly rootPath: string,
    readonly limits: ResourceLimits,
    private readonly missionId: string,
    private readonly image: string,
    private readonly dockerPath: string,
    private readonly user: string,
    private readonly network: NetworkPolicy,
    private readonly quota?: WorkspaceQuota,
  ) {
    this.workDir = join(rootPath, "work");
    this.gitDir = join(rootPath, "git");
    this.containerUserIsNonRoot = !user.startsWith("0:");
  }

  private readonly containerUserIsNonRoot: boolean;

  get quotaMode(): "loop" | "advisory" | undefined {
    return this.quota?.mode;
  }

  private resolveInside(relPath: string): string {
    if (isAbsolute(relPath)) throw new PathEscapeError(relPath);
    const target = resolve(this.workDir, relPath);
    const rel = relative(this.workDir, target);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }

  async exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? this.limits.execTimeoutMs;
    const containerName = `mc-${this.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    // cwd, container'a verilmeden önce workspace içinde doğrulanır.
    if (options.cwd) this.resolveInside(options.cwd);

    const runArgs = buildRunArgs({
      containerName,
      missionId: this.missionId,
      image: this.image,
      hostWorkDir: this.workDir,
      limits: this.limits,
      network: this.network,
      user: this.user,
      command,
      args,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    assertNoEnvLeak(runArgs);

    const startedAt = Date.now();
    return new Promise<ExecResult>((resolvePromise) => {
      const child = spawn(this.dockerPath, runArgs, { shell: false });
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let timedOut = false;
      let limitHit: ExecResult["limitHit"];
      let settled = false;

      /** Container'ı host tarafından öldür: CLI'yi öldürmek yetmez. */
      const killContainer = () => {
        spawn(this.dockerPath, ["kill", containerName], { shell: false }).on("error", () => {});
      };

      const timer = setTimeout(() => {
        timedOut = true;
        limitHit = "time";
        killContainer();
      }, timeoutMs);

      // Advisory modda kota çekirdek tarafından uygulanmadığı için workspace
      // boyutunu çalışırken ölçüyoruz. Gecikmeli bir kontroldür; `loop`
      // modunun yerini tutmaz ama sınırsız büyümeyi durdurur.
      const diskWatcher =
        this.quota?.mode === "advisory"
          ? setInterval(() => {
              void measureDirectorySize(this.workDir).then((bytes) => {
                if (bytes > (this.quota?.limitBytes ?? Number.POSITIVE_INFINITY) && !limitHit) {
                  limitHit = "disk";
                  killContainer();
                }
              });
            }, 1_000)
          : undefined;

      const collect = (chunk: Buffer, target: "out" | "err") => {
        bytes += chunk.length;
        if (bytes > this.limits.maxOutputBytes) {
          if (!limitHit) {
            limitHit = "output";
            killContainer();
          }
          return;
        }
        if (target === "out") stdout += chunk.toString();
        else stderr += chunk.toString();
      };

      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "err"));

      const settle = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (diskWatcher) clearInterval(diskWatcher);
        // 137 = SIGKILL. Biz öldürmediysek çekirdek öldürmüştür (OOM).
        if (exitCode === 137 && !limitHit) limitHit = "memory";
        resolvePromise({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          ...(limitHit ? { limitHit } : {}),
        });
      };

      child.on("error", (err) => {
        stderr += `\n${err.message}`;
        settle(127);
      });
      child.on("close", (code) => settle(code ?? (timedOut ? 124 : 1)));
    });
  }

  async readFile(relPath: string): Promise<string> {
    return readFile(this.resolveInside(relPath), "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const target = this.resolveInside(relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    // Container non-root çalışırken, host'un yazdığı dosyalar aksi hâlde
    // salt-okunur kalır ve dosya yazan meşru test setleri (snapshot testleri,
    // üretilen fixture'lar, sqlite) kırılır. Bu geçici, mission'a özel
    // workspace olduğu için izinleri açmak kabul edilebilir.
    if (this.containerUserIsNonRoot) {
      await chmod(target, 0o666).catch(() => {});
      await chmod(dirname(target), 0o777).catch(() => {});
    }
  }

  async listFiles(relDir = "."): Promise<string[]> {
    const res = await this.hostGit([
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      ...(relDir === "." ? [] : [relDir]),
    ]);
    return res.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async diffStat(): Promise<DiffStat> {
    await this.hostGit(["add", "-A"]);
    const out = await this.hostGit(["diff", "--cached", "--numstat"]);
    let files = 0;
    let added = 0;
    let removed = 0;
    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      files += 1;
      added += Number.parseInt(parts[0] ?? "0", 10) || 0;
      removed += Number.parseInt(parts[1] ?? "0", 10) || 0;
    }
    return { files, added, removed };
  }

  async unifiedDiff(): Promise<string> {
    await this.hostGit(["add", "-A"]);
    return this.hostGit(["diff", "--cached"]);
  }

  /**
   * Git HOST'ta çalışır ve meta dizini mount dışındadır: container ne git'i
   * çalıştırabilir ne de geçmişi görebilir.
   */
  private hostGit(args: string[]): Promise<string> {
    return new Promise((resolvePromise) => {
      const child = spawn(
        "git",
        [`--git-dir=${this.gitDir}`, `--work-tree=${this.workDir}`, ...args],
        { shell: false },
      );
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk.toString()));
      child.stderr.on("data", () => {});
      child.on("error", () => resolvePromise(out));
      child.on("close", () => resolvePromise(out));
    });
  }

  /**
   * Mission bitiminde: önce artık container'lar (crash/timeout kalıntısı),
   * sonra workspace. Kaynak kodun kalıcı hâle gelmemesi §9.1 retention
   * kararının gereği.
   */
  async destroy(): Promise<void> {
    await removeContainersByLabel(this.dockerPath, `mission-control.mission=${this.missionId}`);
    // Kota bağlaması çözülmeden dizin silinirse host'ta imaj sızıntısı kalır.
    await this.quota?.release().catch(() => {});
    await rm(this.rootPath, { recursive: true, force: true });
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly kind = "docker";
  readonly isolatesUntrustedCode = true;

  private readonly image: string;
  private readonly dockerPath: string;
  private readonly baseDir: string;

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? process.env.MC_SANDBOX_IMAGE ?? "mission-control/sandbox:local";
    this.dockerPath = options.dockerPath ?? process.env.MC_DOCKER_PATH ?? "docker";
    this.baseDir = options.baseDir ?? tmpdir();
  }

  /** Daemon erişilebilir mi? Kurulum sorunları net hata olarak yüzeye çıkmalı. */
  async isAvailable(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const probe = await runCommand(this.dockerPath, ["info", "--format", "{{.ServerVersion}}"]);
    if (probe.exitCode !== 0) {
      const detail = probe.stderr.trim() || probe.stdout.trim() || "docker info failed";
      return { ok: false, detail: detail.split("\n")[0] ?? detail };
    }
    const images = await runCommand(this.dockerPath, [
      "image",
      "inspect",
      this.image,
      "--format",
      "{{.Id}}",
    ]);
    if (images.exitCode !== 0) {
      return {
        ok: false,
        detail:
          `sandbox image "${this.image}" is missing. Build it with ` +
          `scripts/build-sandbox-image.sh, or set MC_SANDBOX_IMAGE to an image ` +
          `that provides python3 and node.`,
      };
    }
    return { ok: true };
  }

  async create(options: CreateSandboxOptions): Promise<Sandbox> {
    const availability = await this.isAvailable();
    if (!availability.ok) throw new SandboxUnavailableError(this.kind, availability.detail);

    const network = options.network ?? "none";
    if (network !== "none") throw new UnsupportedNetworkPolicyError(network);

    const root = await mkdtemp(join(this.baseDir, `mc-${options.missionId.slice(0, 8)}-`));
    const workDir = join(root, "work");
    const gitDir = join(root, "git");
    const limits = resolveLimits(options.limits);
    await mkdir(gitDir, { recursive: true });

    // Kota, workspace'in ÜZERİNE kurulur: container'ın yazabildiği tek kalıcı
    // alan budur ve host diskini burası doldurabilir. İmaj dosyası bağlama
    // noktasının dışında (root altında) durur ki umount sonrası silinebilsin.
    const quota = await setupWorkspaceQuota({
      mountPoint: workDir,
      imageDir: join(root, "quota"),
      limitBytes: limits.workspaceMb * 1024 * 1024,
    });

    if (options.sourceDir) {
      await cp(options.sourceDir, workDir, { recursive: true });
    }
    // Kaynak projeden gelen bir .git, ölçüm için kullandığımız git dizini
    // DEĞİLDİR ve container'a görünmemelidir.
    await rm(join(workDir, ".git"), { recursive: true, force: true });

    const user = resolveContainerUser();
    // Container non-root çalışıyorsa mount'a yazabilmesi gerekir.
    if (user.startsWith("65534")) await makeGroupWritable(workDir);

    const sandbox = new DockerSandbox(
      randomUUID(),
      root,
      limits,
      options.missionId,
      this.image,
      this.dockerPath,
      user,
      network,
      quota,
    );

    await initHostGit(gitDir, workDir);
    return sandbox;
  }

  /**
   * Süreç çökmesi sonrası kalan container'ları temizler. `--rm` normal akışta
   * yeterlidir; bu, anormal sonlanma için güvenlik ağıdır.
   *
   * `missionId` verilirse yalnızca o mission'ın artıkları toplanır — eşzamanlı
   * çalışan başka mission'ların container'larına dokunulmaz.
   */
  async reapOrphans(missionId?: string): Promise<number> {
    const label = missionId ? `mission-control.mission=${missionId}` : `${LABEL_KEY}=1`;
    return removeContainersByLabel(this.dockerPath, label);
  }
}

/**
 * Container kullanıcısı. Host root ise (CI/konteyner ortamları) container'da
 * root çalıştırmak yerine `nobody`ye düşeriz; aksi hâlde host kullanıcısını
 * kullanırız ki mount'a yazılan dosyaların sahipliği doğru kalsın.
 */
export function resolveContainerUser(
  getuid: () => number | undefined = process.getuid?.bind(process) ?? (() => undefined),
  getgid: () => number | undefined = process.getgid?.bind(process) ?? (() => undefined),
): string {
  const override = process.env.MC_SANDBOX_USER;
  if (override) return override;
  const uid = getuid();
  const gid = getgid();
  if (uid === undefined || gid === undefined || uid === 0) return "65534:65534";
  return `${uid}:${gid}`;
}

async function makeGroupWritable(dir: string): Promise<void> {
  // Dizin ağacını container kullanıcısının yazabilmesi için açıyoruz. Bu
  // dizin zaten mission'a özel, geçici ve mission sonunda siliniyor.
  await chmod(dir, 0o777).catch(() => {});
  const entries = await runCommand("find", [dir, "-type", "d"]);
  for (const path of entries.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    await chmod(path, 0o777).catch(() => {});
  }
  const files = await runCommand("find", [dir, "-type", "f"]);
  for (const path of files.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    await chmod(path, 0o666).catch(() => {});
  }
}

/** Derleme/test artefaktları ölçülen değişim sayısını kirletmemeli. */
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

async function initHostGit(gitDir: string, workDir: string): Promise<void> {
  const git = (args: string[]) =>
    runCommand("git", [`--git-dir=${gitDir}`, `--work-tree=${workDir}`, ...args]);
  await git(["init", "-q"]);
  await git(["config", "user.email", "agent@mission-control.local"]);
  await git(["config", "user.name", "Mission Control"]);
  await mkdir(join(gitDir, "info"), { recursive: true });
  await writeFile(join(gitDir, "info", "exclude"), ARTIFACT_EXCLUDES, "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "baseline", "--allow-empty"]);
}

async function removeContainersByLabel(dockerPath: string, label: string): Promise<number> {
  const listed = await runCommand(dockerPath, ["ps", "-aq", "--filter", `label=${label}`]);
  const ids = listed.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return 0;
  await runCommand(dockerPath, ["rm", "-f", ...ids]);
  return ids.length;
}

function runCommand(
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
