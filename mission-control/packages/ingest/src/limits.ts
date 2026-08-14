/**
 * Ingest limitleri (PHASE_1C §2).
 *
 * Değerler kod içine gömülmez; her biri konfigürasyondan gelir ve varsayılanlar
 * güvenli tarafta seçilmiştir. Bir limit aşıldığında sonuç mission başarısı
 * DEĞİL, açık bir ingest hatasıdır.
 */
export interface IngestLimits {
  /** Yüklenen arşivin sıkıştırılmış boyut tavanı. */
  maxArchiveBytes: number;
  /** Çıkarılan toplam bayt tavanı (zip bomb'un ana savunması). */
  maxTotalUncompressedBytes: number;
  /** Tek bir dosyanın çıkarılmış boyut tavanı. */
  maxFileBytes: number;
  /** Girdi (dosya + dizin) sayısı tavanı. */
  maxEntries: number;
  /** Yol derinliği tavanı (a/b/c = 3). */
  maxDepth: number;
  /** Toplam sıkıştırma oranı tavanı: uncompressed / compressed. */
  maxCompressionRatio: number;
  /** Çıkarma işlemi için duvar-saat tavanı. */
  extractionTimeoutMs: number;
  /** Tek bir yol bileşeninin uzunluk tavanı. */
  maxPathLength: number;
}

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxArchiveBytes: 50 * 1024 * 1024, // 50 MB
  maxTotalUncompressedBytes: 200 * 1024 * 1024, // 200 MB
  maxFileBytes: 25 * 1024 * 1024, // 25 MB
  maxEntries: 5_000,
  maxDepth: 24,
  maxCompressionRatio: 120,
  extractionTimeoutMs: 60_000,
  maxPathLength: 255,
};

export function resolveIngestLimits(overrides?: Partial<IngestLimits>): IngestLimits {
  return { ...DEFAULT_INGEST_LIMITS, ...overrides };
}

/** Reddin makine-okunur sebebi; raporlama ve testler bunun üzerinden çalışır. */
export type IngestRejectionReason =
  | "archive_too_large"
  | "total_size_exceeded"
  | "file_too_large"
  | "too_many_entries"
  | "path_traversal"
  | "absolute_path"
  | "unsafe_path"
  | "path_too_long"
  | "depth_exceeded"
  | "symlink_entry"
  | "special_file_entry"
  | "compression_ratio_exceeded"
  | "extraction_timeout"
  | "corrupt_archive"
  | "empty_archive";

export class IngestRejectedError extends Error {
  constructor(
    readonly reason: IngestRejectionReason,
    message: string,
    /** Reddi tetikleyen girdi — loglarda ham arşiv içeriği taşımamak için kısa. */
    readonly entryName?: string,
  ) {
    super(message);
    this.name = "IngestRejectedError";
  }
}
