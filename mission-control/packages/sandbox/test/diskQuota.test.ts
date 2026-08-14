import { statfs } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DockerSandboxProvider, type Sandbox } from "../src/index.js";

/**
 * Disk kotası adversarial testleri (PHASE_1C §4).
 *
 * Ölçtüğümüz şey "hata alındı mı" değil, **host'un gerçekten korunup
 * korunmadığı**: yazma ENOSPC ile durmalı, host disk kullanımı kota kadarıyla
 * sınırlı kalmalı ve mission sonrası normale dönmeli.
 */

const provider = new DockerSandboxProvider();
const availability = await provider.isAvailable();
const dockerReady = availability.ok;
if (!dockerReady) {
  console.warn(`[disk-quota] Docker yok, atlanıyor: ${availability.detail}`);
}

const created: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((s) => s.destroy().catch(() => {})));
});
afterAll(async () => {
  if (dockerReady) await provider.reapOrphans().catch(() => 0);
});

/** Host kök dosya sisteminde kullanılan bayt. */
async function hostUsedBytes(): Promise<number> {
  const fs = await statfs("/tmp");
  return (fs.blocks - fs.bfree) * fs.bsize;
}

describe.skipIf(!dockerReady)("workspace disk kotası", () => {
  it("kota gerçekten çekirdek tarafından uygulanıyor (loop modu)", async () => {
    const sb = await provider.create({
      missionId: "quota-mode",
      trust: "untrusted",
      limits: { workspaceMb: 16 },
    });
    created.push(sb);
    // Bu ortamda loop modu bekleniyor; advisory'ye düşülmüşse bu test
    // "kota var" iddiasının zayıfladığını gösterir ve bunu görmeliyiz.
    expect(sb.quotaMode).toBe("loop");
  }, 180_000);

  it("(11) container workspace'i doldurarak host diskini tüketemez", async () => {
    const sb = await provider.create({
      missionId: "quota-fill",
      trust: "untrusted",
      limits: { workspaceMb: 16, execTimeoutMs: 120_000 },
    });
    created.push(sb);

    const before = await hostUsedBytes();
    const res = await sb.exec("python3", [
      "-c",
      "written = 0\n"
      + "try:\n"
      + "    with open('/workspace/fill.bin','wb') as f:\n"
      + "        for _ in range(400):\n"
      + "            f.write(b'x' * 1024 * 1024)\n"
      + "            f.flush()\n"
      + "            written += 1\n"
      + "    print('WROTE-400MB-BAD')\n"
      + "except OSError as e:\n"
      + "    print('quota-enforced', e.errno, 'after', written, 'MB')",
    ]);

    expect(res.stdout).not.toContain("WROTE-400MB-BAD");
    expect(res.stdout).toContain("quota-enforced");
    // errno 28 = ENOSPC
    expect(res.stdout).toContain("28");

    // Host'ta 400 MB'lık bir artış OLMAMALI: kota imajı 16 MB ile sınırlı.
    const after = await hostUsedBytes();
    const growthMb = (after - before) / (1024 * 1024);
    expect(growthMb).toBeLessThan(100);
  }, 300_000);

  it("kota aşımı sonrası temizlik host diskini geri verir", async () => {
    const before = await hostUsedBytes();
    const sb = await provider.create({
      missionId: "quota-cleanup",
      trust: "untrusted",
      limits: { workspaceMb: 32, execTimeoutMs: 120_000 },
    });
    await sb.exec("python3", [
      "-c",
      "try:\n"
      + "    with open('/workspace/fill.bin','wb') as f:\n"
      + "        for _ in range(200): f.write(b'x' * 1024 * 1024)\n"
      + "except OSError:\n"
      + "    pass\n"
      + "print('done')",
    ]);
    await sb.destroy();

    // Bağlama çözülüp imaj silindiği için host kullanımı başlangıca dönmeli.
    const after = await hostUsedBytes();
    const residualMb = (after - before) / (1024 * 1024);
    expect(residualMb).toBeLessThan(20);
  }, 300_000);

  it("kota içinde kalan normal proje etkilenmez", async () => {
    const sb = await provider.create({
      missionId: "quota-normal",
      trust: "untrusted",
      limits: { workspaceMb: 32 },
    });
    created.push(sb);
    await sb.writeFile("app.py", "print('hello')\n");
    const res = await sb.exec("python3", ["app.py"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("hello");
    expect(res.limitHit).toBeUndefined();
  }, 180_000);

  it("(12) devasa stdout kotadan bağımsız olarak kesilir", async () => {
    // Disk kotası dolmasa bile bellek/çıktı sınırı ayrı çalışmalı.
    const sb = await provider.create({
      missionId: "quota-stdout",
      trust: "untrusted",
      limits: { workspaceMb: 64, maxOutputBytes: 50_000, execTimeoutMs: 60_000 },
    });
    created.push(sb);
    const res = await sb.exec("python3", [
      "-c",
      "import sys\nfor _ in range(200000):\n    sys.stdout.write('A'*100 + '\\n')",
    ]);
    expect(res.limitHit).toBe("output");
  }, 180_000);
});
