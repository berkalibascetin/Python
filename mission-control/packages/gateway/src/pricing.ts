import type { Usage } from "./types.js";

/**
 * Fiyat tablosu — birim ekonominin tek doğruluk kaynağı (MASTER_PLAN §19).
 *
 * Fiyatlar sağlayıcı tarafından değiştirilebilir; burası veri, kod değil.
 * Değerler $/milyon token. Kaynak: Anthropic model/fiyat referansı (2026-06).
 *
 * Not: Claude Sonnet 5 için 2026-08-31'e kadar geçerli bir tanıtım fiyatı
 * ($2/$10) mevcut; tabloda bilerek STANDART fiyat tutuluyor. Bütçe devre
 * kesicisi maliyeti asla olduğundan düşük tahmin etmemeli — fazla tahmin
 * güvenli yön, eksik tahmin kullanıcıya sürpriz fatura demek.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
};

/** Prompt cache çarpanları: yazma primli, okuma çok ucuz. */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export class UnknownModelPriceError extends Error {
  constructor(readonly modelId: string) {
    super(`No price entry for model "${modelId}" — refusing to run uncosted`);
    this.name = "UnknownModelPriceError";
  }
}

/**
 * Bir çağrının maliyeti. Fiyatı bilinmeyen model için fırlatır: maliyeti
 * ölçülemeyen bir çağrıyı sessizce $0 saymak bütçe kontrolünü delerdi.
 */
export function costOf(modelId: string, usage: Usage): number {
  const price = PRICES[modelId];
  if (!price) throw new UnknownModelPriceError(modelId);
  const input =
    usage.inputTokens +
    usage.cacheWriteTokens * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * CACHE_READ_MULTIPLIER;
  const usd = (input * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
  // Alt-cent gürültüsünü kırp; toplamlar yine de $0.0001 çözünürlükte kalır.
  return Number(usd.toFixed(6));
}

/**
 * Çağrı öncesi rezervasyon için kaba tahmin (§12): gerçek çıktı bilinmeden
 * bütçe rezerve edilmeli. Kasıtlı olarak cömert — rezervasyon eksik kalırsa
 * devre kesici geç tetiklenir.
 */
export function estimateCost(modelId: string, promptTokens: number, maxTokens: number): number {
  return costOf(modelId, {
    inputTokens: promptTokens,
    outputTokens: maxTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  });
}
