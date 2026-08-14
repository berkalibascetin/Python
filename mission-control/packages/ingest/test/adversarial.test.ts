import { readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractZip, IngestRejectedError } from "../src/index.js";
import { benignScript, pythonZip } from "./helpers/makeZip.js";

/**
 * Adversarial ingest testleri (PHASE_1C §4).
 *
 * Kural, Faz 1b'deki ile aynı: her test bir SALDIRIYI kurar ve saldırının
 * BAŞARISIZ olduğunu iddia eder. Ayrıca yalnızca "istisna fırlatıldı" demek
 * yetmez — host'un gerçekten korunduğu (dosya yazılmadığı, disk şişmediği,
 * artık bırakılmadığı) ayrıca doğrulanır.
 */

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function expectRejected(zipPath: string, reason: string, limits = {}) {
  let thrown: unknown;
  try {
    const result = await extractZip(zipPath, { limits });
    roots.push(result.rootDir);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, "expected the archive to be rejected").toBeInstanceOf(IngestRejectedError);
  expect((thrown as IngestRejectedError).reason).toBe(reason);
  return thrown as IngestRejectedError;
}

describe("ingest: temel çalışırlık", () => {
  it("zararsız arşiv çıkarılır", async () => {
    const zip = await pythonZip(benignScript());
    const result = await extractZip(zip);
    roots.push(result.rootDir);

    expect(result.files).toBe(2);
    expect(result.totalBytes).toBeGreaterThan(0);
    const content = await readFile(join(result.rootDir, "project", "app.py"), "utf8");
    expect(content).toContain("return a + b");
  }, 60_000);
});

describe("ingest adversarial", () => {
  it("(1) ../ ile üst dizine yazma reddedilir", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    z.writestr('../../../../tmp/mc-pwned-traversal', 'owned')",
      ].join("\n"),
    );
    await expectRejected(zip, "path_traversal");
    // Host gerçekten korunmuş olmalı: dosya hiçbir yere yazılmamış.
    expect(existsSync("/tmp/mc-pwned-traversal")).toBe(false);
  }, 60_000);

  it("(2) mutlak yol reddedilir", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    z.writestr('/tmp/mc-pwned-absolute', 'owned')",
      ].join("\n"),
    );
    await expectRejected(zip, "absolute_path");
    expect(existsSync("/tmp/mc-pwned-absolute")).toBe(false);
  }, 60_000);

  it("(3) sembolik bağ girdisi reddedilir", async () => {
    // Unix modunda symlink biti kurulmuş bir girdi: /etc/passwd'a bağ.
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    info = zipfile.ZipInfo('project/link')",
        "    info.create_system = 3",  // unix
        "    info.external_attr = (0o120777 << 16)",
        "    z.writestr(info, '/etc/passwd')",
      ].join("\n"),
    );
    const err = await expectRejected(zip, "symlink_entry");
    expect(err.message).toContain("symlink");
  }, 60_000);

  it("(4) sembolik bağ üzerinden yazma denemesi de reddedilir", async () => {
    // Klasik iki adımlı saldırı: önce dizine bağ, sonra bağın içine dosya.
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    link = zipfile.ZipInfo('escape')",
        "    link.create_system = 3",
        "    link.external_attr = (0o120777 << 16)",
        "    z.writestr(link, '/tmp')",
        "    z.writestr('escape/mc-pwned-symlink-write', 'owned')",
      ].join("\n"),
    );
    await expectRejected(zip, "symlink_entry");
    expect(existsSync("/tmp/mc-pwned-symlink-write")).toBe(false);
  }, 60_000);

  it("(5) özel dosya (fifo/aygıt) girdisi reddedilir", async () => {
    // ZIP'te 'hardlink' diye ayrı bir girdi türü yoktur; temsil edilebilen
    // her düzensiz tür (fifo, soket, aygıt) burada reddedilir.
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    info = zipfile.ZipInfo('project/fifo')",
        "    info.create_system = 3",
        "    info.external_attr = (0o010644 << 16)",  // FIFO
        "    z.writestr(info, '')",
      ].join("\n"),
    );
    await expectRejected(zip, "special_file_entry");
  }, 60_000);

  it("(6) zip bomb toplam boyut sınırında durur", async () => {
    // 200 MB sıfır, birkaç KB'ye sıkışır: beyan edilen boyuta değil, akan
    // baytlara bakıldığı için burada durmalı.
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    z.writestr('bomb.bin', b'\\0' * (200 * 1024 * 1024))",
      ].join("\n"),
    );
    const err = await expectRejected(zip, "file_too_large", { maxFileBytes: 4 * 1024 * 1024 });
    expect(err.message).toBeTruthy();
  }, 180_000);

  it("(7) yalancı başlık boyutu korumayı atlatamaz", async () => {
    // Başlıkta küçük boyut beyan edip gerçekte çok daha fazlasını akıtan
    // arşiv: erken kontrol geçilse bile akış sırasındaki sayaç durdurur.
    const zip = await pythonZip(
      [
        "import struct",
        "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    z.writestr('big.bin', b'A' * (40 * 1024 * 1024))",
        "# başlıktaki uncompressed size alanını 1 bayta düşür",
        "data = bytearray(open(ZIP_PATH, 'rb').read())",
        "idx = data.find(b'big.bin')",
        "if idx > 30:",
        "    struct.pack_into('<I', data, idx - 8, 1)",
        "open(ZIP_PATH, 'wb').write(bytes(data))",
      ].join("\n"),
    );
    // Hangi limite çarptığı arşive göre değişebilir; önemli olan REDDEDİLMESİ.
    let rejected = false;
    try {
      const result = await extractZip(zip, { limits: { maxTotalUncompressedBytes: 8 * 1024 * 1024 } });
      roots.push(result.rootDir);
      // Reddedilmediyse en azından limitin üstüne çıkmamış olmalı.
      expect(result.totalBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    } catch (err) {
      rejected = err instanceof IngestRejectedError;
      expect(rejected).toBe(true);
    }
  }, 180_000);

  it("(8) aşırı dosya sayısı reddedilir", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    for i in range(500):",
        "        z.writestr('project/f%d.txt' % i, 'x')",
      ].join("\n"),
    );
    await expectRejected(zip, "too_many_entries", { maxEntries: 50 });
  }, 120_000);

  it("(9) aşırı dizin derinliği reddedilir", async () => {
    const zip = await pythonZip(
      [
        "deep = '/'.join('d%d' % i for i in range(60))",
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    z.writestr(deep + '/file.txt', 'x')",
      ].join("\n"),
    );
    await expectRejected(zip, "depth_exceeded", { maxDepth: 10 });
  }, 60_000);

  it("(10) sıkıştırma oranı sınırı uygulanır", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    z.writestr('flat.bin', b'\\0' * (20 * 1024 * 1024))",
      ].join("\n"),
    );
    await expectRejected(zip, "compression_ratio_exceeded", {
      maxCompressionRatio: 5,
      maxFileBytes: 64 * 1024 * 1024,
      maxTotalUncompressedBytes: 64 * 1024 * 1024,
    });
  }, 180_000);

  it("(11) çıkarma süre sınırı uygulanır", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    for i in range(400):",
        "        z.writestr('project/f%d.bin' % i, b'\\0' * (256 * 1024))",
      ].join("\n"),
    );
    await expectRejected(zip, "extraction_timeout", { extractionTimeoutMs: 1 });
  }, 180_000);

  it("(12) çok büyük arşiv daha açılmadan reddedilir", async () => {
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    z.writestr('data.bin', b'A' * (2 * 1024 * 1024))",
      ].join("\n"),
    );
    // Sıkıştırılmamış 2MB'lık arşiv, 64KB tavanını aşar.
    await expectRejected(zip, "archive_too_large", { maxArchiveBytes: 64 * 1024 });
  }, 120_000);

  it("(13) reddedilen arşiv diskte artık bırakmaz", async () => {
    const before = await countTempIngestDirs();
    const zip = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
        "    z.writestr('project/ok.txt', 'fine')",
        "    z.writestr('project/huge.bin', b'\\0' * (30 * 1024 * 1024))",
      ].join("\n"),
    );
    await expectRejected(zip, "file_too_large", { maxFileBytes: 1024 * 1024 });
    // Yarım çıkmış dosyalar ve geçici kök temizlenmiş olmalı.
    expect(await countTempIngestDirs()).toBe(before);
  }, 180_000);

  it("(14) ters bölülü kaçış yolu reddedilir", async () => {
    // Ters bölü POSIX'te ayırıcı değildir; bu yüzden Windows tarzı bir kaçış
    // yolunun sessizce normal bir dosya adına dönüşmemesi gerekir.
    const backslash = await pythonZip(
      [
        "with zipfile.ZipFile(ZIP_PATH, 'w') as z:",
        "    z.writestr('..\\\\..\\\\mc-pwned-backslash', 'owned')",
      ].join("\n"),
    );
    await expectRejected(backslash, "path_traversal");
    expect(existsSync("/tmp/mc-pwned-backslash")).toBe(false);
  }, 60_000);

  it("(15) boş arşiv anlamlı hata verir", async () => {
    const zip = await pythonZip("with zipfile.ZipFile(ZIP_PATH, 'w') as z:\n    pass");
    await expectRejected(zip, "empty_archive");
  }, 60_000);
});

/** Geçici ingest dizinlerini sayar — sızıntı kontrolü için. */
async function countTempIngestDirs(): Promise<number> {
  const entries = await readdir(tmpdir()).catch(() => [] as string[]);
  let count = 0;
  for (const name of entries) {
    if (!name.startsWith("mc-ingest-")) continue;
    const info = await stat(join(tmpdir(), name)).catch(() => null);
    if (info?.isDirectory()) count += 1;
  }
  return count;
}
