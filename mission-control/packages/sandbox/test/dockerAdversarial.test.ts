import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  DockerSandboxProvider,
  LocalSandboxProvider,
  PathEscapeError,
  SandboxUnavailableError,
  UntrustedProjectError,
  type Sandbox,
} from "../src/index.js";

/**
 * Adversarial sandbox testleri (PHASE_1B §10).
 *
 * Kural: her test bir SALDIRIYI dener ve saldırının BAŞARISIZ olduğunu iddia
 * eder. "Container ayağa kalktı" bir güvenlik kanıtı değildir; burada
 * kanıtlanan şey, denenen şeyin yapılamadığıdır.
 *
 * Docker yoksa bu blok atlanır — sessizce "geçti" sayılmaz; koşulduğunda
 * gerçekten container içinde koşar.
 */

const provider = new DockerSandboxProvider();

// Uygunluk MODÜL YÜKLENİRKEN belirlenmeli: `describe.skipIf` toplama anında
// değerlendirilir, `beforeAll` ise ondan sonra çalışır — orada belirlenen bir
// bayrak her şeyi sessizce atlatırdı.
const availability = await provider.isAvailable();
const dockerReady = availability.ok;
if (!dockerReady) {
  console.warn(
    `[adversarial] Docker kullanılamıyor, izolasyon testleri ATLANIYOR: ${availability.detail}`,
  );
}

const created: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((s) => s.destroy().catch(() => {})));
});
afterAll(async () => {
  if (dockerReady) await provider.reapOrphans().catch(() => 0);
});

async function sandbox(): Promise<Sandbox> {
  const sb = await provider.create({ missionId: "adversarial", trust: "untrusted" });
  created.push(sb);
  return sb;
}

describe.skipIf(!dockerReady)("adversarial: izolasyonlu Docker sandbox", () => {
  it("(0) çalışabilir bir taban: normal komut çalışır", async () => {
    const sb = await sandbox();
    const res = await sb.exec("python3", ["-c", "print('ok')"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("ok");
  }, 120_000);

  it("(1) workspace dışına path traversal reddedilir", async () => {
    const sb = await sandbox();
    await expect(sb.readFile("../../etc/passwd")).rejects.toThrow(PathEscapeError);
    await expect(sb.writeFile("nested/../../escape.txt", "x")).rejects.toThrow(PathEscapeError);
  }, 60_000);

  it("(2) mutlak yol erişimi reddedilir", async () => {
    const sb = await sandbox();
    await expect(sb.readFile("/etc/passwd")).rejects.toThrow(PathEscapeError);
    await expect(sb.writeFile("/tmp/pwned", "x")).rejects.toThrow(PathEscapeError);
  }, 60_000);

  it("(3) container host dosya sistemini göremez", async () => {
    const sb = await sandbox();
    // Host'ta kesin var olan yollar container içinde bulunmamalı.
    const res = await sb.exec("python3", [
      "-c",
      "import os; print('HOST_VISIBLE' if os.path.exists('/home/user/Python') else 'host-hidden')",
    ]);
    expect(res.stdout).toContain("host-hidden");
    expect(res.stdout).not.toContain("HOST_VISIBLE");
  }, 120_000);

  it("(4) container Docker socket'ine erişemez", async () => {
    const sb = await sandbox();
    const res = await sb.exec("python3", [
      "-c",
      "import os; print('SOCKET_VISIBLE' if os.path.exists('/var/run/docker.sock') else 'socket-absent')",
    ]);
    expect(res.stdout).toContain("socket-absent");
  }, 120_000);

  it("(5) host ortam değişkenleri (API anahtarları) container'a sızmaz", async () => {
    const previous = process.env.MC_TEST_FAKE_SECRET;
    process.env.MC_TEST_FAKE_SECRET = "super-secret-value";
    try {
      const sb = await sandbox();
      const res = await sb.exec("python3", [
        "-c",
        "import os; print('LEAK:' + os.environ.get('MC_TEST_FAKE_SECRET','none')); "
        + "print('ANTHROPIC:' + os.environ.get('ANTHROPIC_API_KEY','none'))",
      ]);
      expect(res.stdout).toContain("LEAK:none");
      expect(res.stdout).toContain("ANTHROPIC:none");
      expect(res.stdout).not.toContain("super-secret-value");
    } finally {
      if (previous === undefined) delete process.env.MC_TEST_FAKE_SECRET;
      else process.env.MC_TEST_FAKE_SECRET = previous;
    }
  }, 120_000);

  it("(6) ağ erişimi engellenir", async () => {
    const sb = await sandbox();
    const res = await sb.exec("python3", [
      "-c",
      "import socket\n"
      + "try:\n"
      + "    socket.create_connection(('1.1.1.1', 53), timeout=5)\n"
      + "    print('NETWORK_REACHABLE')\n"
      + "except OSError as e:\n"
      + "    print('network-blocked')",
    ]);
    expect(res.stdout).toContain("network-blocked");
    expect(res.stdout).not.toContain("NETWORK_REACHABLE");
  }, 120_000);

  it("(7) ayrıcalık yükseltme engellenir (cap-drop + no-new-privileges)", async () => {
    const sb = await sandbox();
    // Salt-okunur rootfs + capability yokluğu: sistem dosyası yazılamaz.
    const res = await sb.exec("python3", [
      "-c",
      "try:\n"
      + "    open('/etc/passwd','a').write('x')\n"
      + "    print('ROOTFS_WRITABLE')\n"
      + "except OSError:\n"
      + "    print('rootfs-readonly')",
    ]);
    expect(res.stdout).toContain("rootfs-readonly");
  }, 120_000);

  it("(8) aşırı bellek kullanımı öldürülür ve limit olarak raporlanır", async () => {
    const sb = await provider.create({
      missionId: "adversarial-mem",
      trust: "untrusted",
      limits: { memoryMb: 128 },
    });
    created.push(sb);
    const res = await sb.exec("python3", [
      "-c",
      "x = bytearray(400*1024*1024); print('ALLOCATED')",
    ]);
    expect(res.stdout).not.toContain("ALLOCATED");
    expect(res.exitCode).not.toBe(0);
    expect(res.limitHit).toBe("memory");
  }, 180_000);

  it("(9) CPU kotası container'ın cgroup'una gerçekten uygulanır", async () => {
    const sb = await provider.create({
      missionId: "adversarial-cpu",
      trust: "untrusted",
      limits: { cpus: 0.5 },
    });
    created.push(sb);
    // Zamanlama ölçmek yerine çekirdeğin uyguladığı kotayı okuyoruz: paralel
    // yük altında güvenilir olmayan bir süre testi, olmayan bir korumayı
    // "kanıtlayabilir" ya da durduk yere kırılabilir.
    // cgroup v2 ve v1 farklı yerlerde tutar; ikisini de destekliyoruz çünkü
    // üretim host'ları her ikisi de olabilir.
    const res = await sb.exec("sh", [
      "-c",
      "cat /sys/fs/cgroup/cpu.max 2>/dev/null || " +
        "echo \"$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us) $(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)\"",
    ]);
    const [quota, period] = res.stdout.trim().split(/\s+/);
    expect(quota).not.toBe("max"); // sınırsız olmamalı
    expect(Number(quota)).toBeGreaterThan(0);
    // cpus=0.5 → kota, periyodun yarısı kadar olmalı.
    expect(Number(quota) / Number(period)).toBeCloseTo(0.5, 2);
  }, 120_000);

  it("(10) fork bombası PID limitiyle durdurulur", async () => {
    const sb = await provider.create({
      missionId: "adversarial-fork",
      trust: "untrusted",
      limits: { pids: 32, execTimeoutMs: 30_000 },
    });
    created.push(sb);
    const res = await sb.exec("python3", [
      "-c",
      "import os\n"
      + "n = 0\n"
      + "try:\n"
      + "    while n < 500:\n"
      + "        if os.fork() == 0: os._exit(0)\n"
      + "        n += 1\n"
      + "except OSError:\n"
      + "    pass\n"
      + "print('forks', n)",
    ]);
    // Limit gerçekten uygulanmalı: 500 process açılamamalı.
    const match = res.stdout.match(/forks (\d+)/);
    const forks = match ? Number(match[1]) : Number.POSITIVE_INFINITY;
    expect(forks).toBeLessThan(500);
  }, 120_000);

  it("(11) süre aşımı container'ı öldürür", async () => {
    const sb = await sandbox();
    const res = await sb.exec("python3", ["-c", "import time; time.sleep(60)"], {
      timeoutMs: 3_000,
    });
    expect(res.timedOut).toBe(true);
    expect(res.limitHit).toBe("time");
    expect(res.durationMs).toBeLessThan(30_000);
  }, 120_000);

  it("(12) devasa stdout belleği doldurmaz, limit olarak kesilir", async () => {
    const sb = await provider.create({
      missionId: "adversarial-output",
      trust: "untrusted",
      limits: { maxOutputBytes: 50_000, execTimeoutMs: 60_000 },
    });
    created.push(sb);
    const res = await sb.exec("python3", [
      "-c",
      "import sys\nfor _ in range(200000):\n    sys.stdout.write('A'*100 + '\\n')",
    ]);
    expect(res.limitHit).toBe("output");
    expect(res.stdout.length).toBeLessThan(1_000_000);
  }, 120_000);

  it("(13) container çökmesi hata olarak raporlanır, mission başarılı sayılmaz", async () => {
    const sb = await sandbox();
    const res = await sb.exec("python3", ["-c", "import os; os.abort()"]);
    expect(res.exitCode).not.toBe(0);
  }, 120_000);

  it("(14) destroy container ve workspace'i temizler, artık bırakmaz", async () => {
    const sb = await provider.create({ missionId: "cleanup-check", trust: "untrusted" });
    await sb.exec("python3", ["-c", "print('work')"]);
    const root = sb.rootPath;
    await sb.destroy();
    await expect(readFile(join(root, "work", "anything"), "utf8")).rejects.toThrow();
    // İkinci destroy çağrısı da patlamamalı (hata yolunda cleanup güvenli olmalı).
    await expect(sb.destroy()).resolves.toBeUndefined();
  }, 120_000);

  it("(15) container içinden yapılan git müdahalesi ölçümü bozamaz", async () => {
    const sb = await sandbox();
    await sb.writeFile("app.py", "value = 1\n");
    // Güvenilmeyen kod izini silmeye çalışıyor: .git container'da görünmediği
    // için değişiklik ölçümü etkilenmemeli.
    const attack = await sb.exec("python3", [
      "-c",
      "import os, shutil\n"
      + "print('GIT_VISIBLE' if os.path.exists('/workspace/.git') else 'git-hidden')\n"
      + "shutil.rmtree('/workspace/.git', ignore_errors=True)\n"
      + "open('/workspace/app.py','w').write('value = 999\\n')\n"
      + "print('wrote')",
    ]);
    expect(attack.stdout).toContain("git-hidden");
    // Saldırının gerçekten gerçekleştiğini doğrula: yazma sessizce
    // başarısız olsaydı test, olmayan bir korumayı kanıtlamış olurdu.
    expect(attack.exitCode).toBe(0);
    expect(attack.stdout).toContain("wrote");

    const stat = await sb.diffStat();
    expect(stat.files).toBeGreaterThan(0);
    expect(await sb.unifiedDiff()).toContain("999");
  }, 120_000);
});

describe("izolasyon sağlamayan sağlayıcıya güvenilmeyen proje verilemez", () => {
  it("LocalProcessSandbox untrusted projeyi reddeder", async () => {
    const local = new LocalSandboxProvider();
    await expect(local.create({ missionId: "m", trust: "untrusted" })).rejects.toThrow(
      UntrustedProjectError,
    );
  });

  it("trust belirtilmezse untrusted kabul edilir (fail-safe)", async () => {
    const local = new LocalSandboxProvider();
    // Parametreyi unutmak, izolasyonsuz çalıştırmaya DÜŞMEMELİ.
    await expect(local.create({ missionId: "m" })).rejects.toThrow(UntrustedProjectError);
  });

  it("sağlayıcı izolasyon yeteneğini beyan eder", () => {
    expect(new LocalSandboxProvider().isolatesUntrustedCode).toBe(false);
    expect(new DockerSandboxProvider().isolatesUntrustedCode).toBe(true);
  });
});

describe("Docker kullanılamadığında", () => {
  it("belirsiz bir hata değil, uygulanabilir bir mesaj verir", async () => {
    const missing = new DockerSandboxProvider({ dockerPath: "/nonexistent/docker-binary" });
    const availability = await missing.isAvailable();
    expect(availability.ok).toBe(false);

    await expect(missing.create({ missionId: "m", trust: "untrusted" })).rejects.toThrow(
      SandboxUnavailableError,
    );
  }, 60_000);

  it("image eksikse ne yapılacağını söyler", async () => {
    const noImage = new DockerSandboxProvider({ image: "mission-control/definitely-missing:0" });
    const availability = await noImage.isAvailable();
    if (availability.ok) return; // image gerçekten varsa test anlamsız
    expect(availability.detail).toMatch(/build-sandbox-image|MC_SANDBOX_IMAGE/);
  }, 60_000);
});

describe.skipIf(!dockerReady)("kaynak projenin git geçmişi taşınmaz", () => {
  it("proje kendi .git'iyle gelse bile workspace'e kopyalanmaz", async () => {
    // Kullanıcı projesi kendi geçmişiyle gelebilir; ölçüm için kullandığımız
    // git dizini onunla karışmamalı ve container o geçmişi görmemeli.
    const source = await mkdtemp(join(tmpdir(), "mc-src-"));
    await writeFile(join(source, "file.txt"), "content", "utf8");
    await mkdir(join(source, ".git"), { recursive: true });
    await writeFile(join(source, ".git", "HEAD"), "ref: refs/heads/attacker", "utf8");

    const sb = await provider.create({
      missionId: "src-git",
      sourceDir: source,
      trust: "untrusted",
    });
    created.push(sb);

    const res = await sb.exec("python3", [
      "-c",
      "import os; print('SOURCE_GIT_PRESENT' if os.path.exists('/workspace/.git') else 'source-git-removed')",
    ]);
    expect(res.stdout).toContain("source-git-removed");
  }, 120_000);
});
