import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { IngestRejectedError } from "./limits.js";

/**
 * Arşiv girdisi yolunun güvenliği (PHASE_1C §1).
 *
 * ZIP içindeki yol tamamen saldırgan kontrolündedir. Buradaki kontroller
 * dosya SİSTEME YAZILMADAN ÖNCE çalışır; çıkarma sonrası doğrulama ikinci
 * savunma hattıdır, birincisi değil.
 */

/** Windows sürücü öneki (C:\ , \\sunucu\pay) — POSIX host'ta da reddedilir. */
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]|^\\\\/;
/** Yol bileşeninde kabul edilmeyen karakterler (NUL ve kontrol karakterleri). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

export interface SafePath {
  /** Hedefe göreli, normalize edilmiş yol. */
  relativePath: string;
  depth: number;
}

/**
 * Arşiv girdisi adını güvenli göreli yola çevirir; güvenli değilse fırlatır.
 * Hiçbir koşulda hedef dizinin dışına çıkan bir yol döndürmez.
 */
export function toSafeRelativePath(
  entryName: string,
  limits: { maxDepth: number; maxPathLength: number },
): SafePath {
  if (entryName.length === 0) {
    throw new IngestRejectedError("unsafe_path", "empty entry name", entryName);
  }
  if (entryName.length > limits.maxPathLength * limits.maxDepth) {
    throw new IngestRejectedError("path_too_long", `entry name too long`, entryName);
  }
  if (CONTROL_CHARS.test(entryName)) {
    throw new IngestRejectedError("unsafe_path", "control characters in entry name", entryName);
  }
  if (WINDOWS_ABSOLUTE.test(entryName)) {
    throw new IngestRejectedError("absolute_path", "windows absolute path", entryName);
  }
  // Ters bölü, POSIX'te normal karakterdir; ayırıcı sanıp geçmek yerine
  // reddediyoruz — "a\..\..\etc" gibi yolların hedef sistemde nasıl
  // yorumlanacağı platforma göre değişir.
  if (entryName.includes("\\")) {
    throw new IngestRejectedError("unsafe_path", "backslash in entry name", entryName);
  }
  if (entryName.startsWith("/")) {
    throw new IngestRejectedError("absolute_path", "absolute path", entryName);
  }

  const parts = entryName.split("/").filter((part) => part.length > 0 && part !== ".");
  for (const part of parts) {
    if (part === "..") {
      throw new IngestRejectedError("path_traversal", "path traversal segment", entryName);
    }
    if (part.length > limits.maxPathLength) {
      throw new IngestRejectedError("path_too_long", "path component too long", entryName);
    }
  }
  if (parts.length === 0) {
    throw new IngestRejectedError("unsafe_path", "entry resolves to nothing", entryName);
  }
  if (parts.length > limits.maxDepth) {
    throw new IngestRejectedError(
      "depth_exceeded",
      `depth ${parts.length} exceeds ${limits.maxDepth}`,
      entryName,
    );
  }

  const relativePath = parts.join("/");
  // Normalize sonrası hâlâ yukarı çıkan bir şey kalmamalı (kemer + askı).
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || isAbsolute(normalized)) {
    throw new IngestRejectedError("path_traversal", "path escapes after normalize", entryName);
  }
  return { relativePath, depth: parts.length };
}

/**
 * Çıkarma SONRASI doğrulama: yazılan yolun gerçekten hedefin altında olması.
 * Sembolik bağ zincirlerini de çözer (`realpath` semantiği).
 */
export function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) {
    return;
  }
  throw new IngestRejectedError("path_traversal", `path escapes extraction root: ${candidate}`);
}
