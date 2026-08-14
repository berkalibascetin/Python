import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import {
  IngestRejectedError,
  resolveIngestLimits,
  type IngestLimits,
  type IngestRejectionReason,
} from "./limits.js";
import { assertInsideRoot, toSafeRelativePath } from "./paths.js";

/**
 * Güvenli ZIP çıkarma (PHASE_1C §1).
 *
 * Temel ilke: **arşiv başlığındaki hiçbir sayıya güvenilmez.** `uncompressedSize`
 * saldırgan tarafından yazılır; bir zip bomb'u küçük boyut beyan edip gigabaytlar
 * akıtabilir. Bu yüzden bütün boyut limitleri veri AKARKEN, gerçek bayt sayımıyla
 * uygulanır ve limit aşılınca akış o anda kesilir.
 *
 * Çıkarma her zaman yeni oluşturulmuş, boş, geçici bir dizine yapılır — hiçbir
 * koşulda kullanıcı arşivi doğrudan host dosya sistemine açılmaz.
 */

export interface IngestResult {
  /** Çıkarılan projenin kökü (geçici dizin). */
  rootDir: string;
  files: number;
  directories: number;
  totalBytes: number;
  durationMs: number;
  /** Çıkarılmayan ama sayılan girdiler hakkında bilgilendirme. */
  notes: string[];
}

export interface ExtractOptions {
  limits?: Partial<IngestLimits>;
  /** Geçici kökün oluşturulacağı dizin. */
  baseDir?: string;
}

/**
 * Ayrıştırıcı kütüphanenin kendi yol doğrulaması ikinci bir savunma katmanıdır
 * ve bizimkinden ÖNCE tetiklenebilir. Bu durumda reddin sebebi kaybolmamalı:
 * "corrupt_archive" demek, kullanıcıya da bize de yanlış bilgi verirdi.
 */
function classifyLibraryError(message: string): IngestRejectionReason {
  const lowered = message.toLowerCase();
  if (lowered.includes("absolute path")) return "absolute_path";
  if (lowered.includes("invalid relative path")) return "path_traversal";
  if (lowered.includes("invalid characters in filename")) return "unsafe_path";
  return "corrupt_archive";
}

const UNIX_MODE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
const UNIX_REGULAR = 0o100000;
const UNIX_DIRECTORY = 0o040000;

/** Girdi türü: yalnızca normal dosya ve dizin kabul edilir. */
function classifyEntry(entry: Entry): "file" | "directory" | "symlink" | "special" {
  const isDirName = entry.fileName.endsWith("/");
  // Üst 16 bit, arşiv Unix'te üretildiyse dosya modunu taşır.
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & UNIX_MODE_MASK;

  if (fileType === UNIX_SYMLINK) return "symlink";
  if (fileType === UNIX_DIRECTORY || isDirName) return "directory";
  if (fileType === 0 || fileType === UNIX_REGULAR) return "file";
  // fifo, soket, karakter/blok aygıtı — hiçbiri proje dosyası değildir.
  return "special";
}

export async function extractZip(
  archivePath: string,
  options: ExtractOptions = {},
): Promise<IngestResult> {
  const limits = resolveIngestLimits(options.limits);
  const startedAt = Date.now();

  const archiveStat = await stat(archivePath);
  if (archiveStat.size > limits.maxArchiveBytes) {
    throw new IngestRejectedError(
      "archive_too_large",
      `archive is ${archiveStat.size} bytes, limit is ${limits.maxArchiveBytes}`,
    );
  }
  if (archiveStat.size === 0) {
    throw new IngestRejectedError("corrupt_archive", "archive is empty");
  }

  const rootDir = await mkdtemp(join(options.baseDir ?? tmpdir(), "mc-ingest-"));
  try {
    const result = await extractInto(archivePath, rootDir, limits, archiveStat.size);
    return { ...result, rootDir, durationMs: Date.now() - startedAt };
  } catch (err) {
    // Reddedilen arşivin yarım çıkmış parçaları diskte kalmamalı.
    await rm(rootDir, { recursive: true, force: true });
    throw err;
  }
}

function extractInto(
  archivePath: string,
  rootDir: string,
  limits: IngestLimits,
  archiveBytes: number,
): Promise<Omit<IngestResult, "rootDir" | "durationMs">> {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = Date.now() + limits.extractionTimeoutMs;
    const notes: string[] = [];
    let files = 0;
    let directories = 0;
    let totalBytes = 0;
    let entries = 0;
    let finished = false;
    let zipfile: ZipFile | undefined;

    const fail = (reason: IngestRejectionReason, message: string, entryName?: string) => {
      if (finished) return;
      finished = true;
      zipfile?.close();
      rejectPromise(new IngestRejectedError(reason, message, entryName));
    };

    const succeed = () => {
      if (finished) return;
      finished = true;
      resolvePromise({ files, directories, totalBytes, notes });
    };

    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err || !zf) {
        fail("corrupt_archive", err?.message ?? "cannot open archive");
        return;
      }
      zipfile = zf;

      zf.on("error", (zipErr: Error) => {
        const mapped = classifyLibraryError(zipErr.message);
        fail(mapped, zipErr.message);
      });
      zf.on("end", () => {
        if (files === 0) {
          fail("empty_archive", "archive contains no regular files");
          return;
        }
        succeed();
      });

      zf.on("entry", (entry: Entry) => {
        void (async () => {
          if (finished) return;
          try {
            if (Date.now() > deadline) {
              fail("extraction_timeout", `extraction exceeded ${limits.extractionTimeoutMs}ms`);
              return;
            }

            entries += 1;
            if (entries > limits.maxEntries) {
              fail(
                "too_many_entries",
                `archive has more than ${limits.maxEntries} entries`,
                entry.fileName,
              );
              return;
            }

            const kind = classifyEntry(entry);
            if (kind === "symlink") {
              // Sembolik bağ, çıkarma kökünün dışına yazmanın klasik yoludur.
              fail("symlink_entry", "symlinks are not allowed in project archives", entry.fileName);
              return;
            }
            if (kind === "special") {
              fail(
                "special_file_entry",
                "only regular files and directories are allowed",
                entry.fileName,
              );
              return;
            }

            const safe = toSafeRelativePath(entry.fileName, limits);
            const target = join(rootDir, safe.relativePath);
            assertInsideRoot(rootDir, target);

            if (kind === "directory") {
              await mkdir(target, { recursive: true });
              directories += 1;
              zf.readEntry();
              return;
            }

            // Başlıkta beyan edilen boyut yalnızca ERKEN reddetmek için
            // kullanılır; asıl uygulama akış sırasında yapılır.
            if (entry.uncompressedSize > limits.maxFileBytes) {
              fail(
                "file_too_large",
                `declared size ${entry.uncompressedSize} exceeds ${limits.maxFileBytes}`,
                entry.fileName,
              );
              return;
            }

            await mkdir(dirname(target), { recursive: true });
            zf.openReadStream(entry, async (streamErr, readStream) => {
              if (streamErr || !readStream) {
                fail("corrupt_archive", streamErr?.message ?? "cannot read entry", entry.fileName);
                return;
              }

              let fileBytes = 0;
              let limitBreach: { reason: IngestRejectionReason; message: string } | undefined;

              // Akış sırasında sayan kapı: bomba burada durur.
              const meter = new Transform({
                transform(chunk: Buffer, _enc, callback) {
                  fileBytes += chunk.length;
                  totalBytes += chunk.length;
                  if (fileBytes > limits.maxFileBytes) {
                    limitBreach = {
                      reason: "file_too_large",
                      message: `file exceeds ${limits.maxFileBytes} bytes while streaming`,
                    };
                    callback(new Error("limit"));
                    return;
                  }
                  if (totalBytes > limits.maxTotalUncompressedBytes) {
                    limitBreach = {
                      reason: "total_size_exceeded",
                      message: `archive expands beyond ${limits.maxTotalUncompressedBytes} bytes`,
                    };
                    callback(new Error("limit"));
                    return;
                  }
                  if (totalBytes / archiveBytes > limits.maxCompressionRatio) {
                    limitBreach = {
                      reason: "compression_ratio_exceeded",
                      message: `compression ratio exceeds ${limits.maxCompressionRatio}:1`,
                    };
                    callback(new Error("limit"));
                    return;
                  }
                  if (Date.now() > deadline) {
                    limitBreach = {
                      reason: "extraction_timeout",
                      message: `extraction exceeded ${limits.extractionTimeoutMs}ms`,
                    };
                    callback(new Error("limit"));
                    return;
                  }
                  callback(null, chunk);
                },
              });

              try {
                await pipeline(readStream, meter, createWriteStream(target, { mode: 0o644 }));
              } catch (pipeErr) {
                if (limitBreach) {
                  fail(limitBreach.reason, limitBreach.message, entry.fileName);
                } else {
                  fail(
                    "corrupt_archive",
                    pipeErr instanceof Error ? pipeErr.message : String(pipeErr),
                    entry.fileName,
                  );
                }
                return;
              }

              files += 1;
              zf.readEntry();
            });
          } catch (entryErr) {
            if (entryErr instanceof IngestRejectedError) {
              fail(entryErr.reason, entryErr.message, entryErr.entryName);
            } else {
              fail(
                "corrupt_archive",
                entryErr instanceof Error ? entryErr.message : String(entryErr),
                entry.fileName,
              );
            }
          }
        })();
      });

      zf.readEntry();
    });
  });
}
