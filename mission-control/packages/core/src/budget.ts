/**
 * Bütçe devre kesicisi (MASTER_PLAN §12): her model çağrısı ÖNCESİ tahmini
 * maliyet rezerve edilir, SONRASI gerçek maliyetle mutabakat yapılır.
 * Tavan aşılacaksa çağrı hiç yapılmaz — mission `suspended`a çekilir.
 * MVP'de bu sayaçlar Redis'te atomik yaşar; sözleşme burada tanımlı.
 */

export class BudgetExceededError extends Error {
  constructor(
    readonly capUsd: number,
    readonly attemptedUsd: number,
  ) {
    super(
      `Budget cap exceeded: attempted total $${attemptedUsd.toFixed(4)} > cap $${capUsd.toFixed(4)}`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface BudgetSnapshot {
  capUsd: number;
  committedUsd: number;
  reservedUsd: number;
  remainingUsd: number;
}

export class BudgetTracker {
  private committedUsd = 0;
  private reservedUsd = 0;

  constructor(readonly capUsd: number) {
    if (!(capUsd > 0)) throw new Error("Budget cap must be positive");
  }

  /** Çağrı öncesi rezervasyon. Tavanı aşacaksa fırlatır — çağrı yapılmamalıdır. */
  reserve(estimateUsd: number): void {
    if (estimateUsd < 0) throw new Error("Estimate must be non-negative");
    const attempted = this.committedUsd + this.reservedUsd + estimateUsd;
    if (attempted > this.capUsd) {
      throw new BudgetExceededError(this.capUsd, attempted);
    }
    this.reservedUsd += estimateUsd;
  }

  /** Çağrı sonrası mutabakat: rezervasyon düşer, gerçek maliyet işlenir. */
  commit(estimateUsd: number, actualUsd: number): void {
    if (actualUsd < 0) throw new Error("Actual cost must be non-negative");
    this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd);
    this.committedUsd += actualUsd;
  }

  /** Başarısız çağrıda rezervasyonu geri bırak. */
  release(estimateUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd);
  }

  snapshot(): BudgetSnapshot {
    return {
      capUsd: this.capUsd,
      committedUsd: this.committedUsd,
      reservedUsd: this.reservedUsd,
      remainingUsd: Math.max(0, this.capUsd - this.committedUsd - this.reservedUsd),
    };
  }
}

/**
 * Fix turu limiti + thrashing tespiti (§8.3): aynı normalize hata imzası
 * üst üste 2 kez görülürse döngü kırılır.
 */
export class FixRoundGuard {
  private rounds = 0;
  private lastSignature: string | null = null;
  private repeatCount = 0;

  constructor(
    readonly maxRounds: number,
    readonly maxSignatureRepeats = 2,
  ) {
    if (maxRounds < 1) throw new Error("maxRounds must be >= 1");
  }

  /** Yeni fix turuna izin var mı? Yoksa sebep döner. */
  tryStartRound(failureSignature: string): { allowed: true } | { allowed: false; reason: string } {
    if (this.rounds >= this.maxRounds) {
      return { allowed: false, reason: `max fix rounds (${this.maxRounds}) reached` };
    }
    if (failureSignature === this.lastSignature) {
      this.repeatCount += 1;
    } else {
      this.lastSignature = failureSignature;
      this.repeatCount = 1;
    }
    if (this.repeatCount >= this.maxSignatureRepeats + 1) {
      return {
        allowed: false,
        reason: `same failure signature repeated ${this.repeatCount} times (thrashing)`,
      };
    }
    this.rounds += 1;
    return { allowed: true };
  }

  get roundsUsed(): number {
    return this.rounds;
  }
}

/** Hata çıktısını karşılaştırılabilir imzaya indirger (satır sonu/sayı/whitespace normalizasyonu). */
export function normalizeFailureSignature(rawOutput: string): string {
  return rawOutput
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
