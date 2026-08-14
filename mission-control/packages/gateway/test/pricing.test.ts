import { describe, expect, it } from "vitest";
import { costOf, estimateCost, UnknownModelPriceError } from "../src/index.js";

describe("cost accounting", () => {
  it("input ve output token'ları model fiyatıyla çarpar", () => {
    // 1M input @ $5 + 100k output @ $25 = 5 + 2.5
    const cost = costOf("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(cost).toBeCloseTo(7.5, 6);
  });

  it("cache okuma ucuz, cache yazma primli fiyatlanır", () => {
    const base = costOf("claude-opus-5", {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const cached = costOf("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 100_000,
    });
    const written = costOf("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 100_000,
      cacheReadTokens: 0,
    });
    expect(cached).toBeCloseTo(base * 0.1, 6);
    expect(written).toBeCloseTo(base * 1.25, 6);
  });

  it("fiyatı bilinmeyen model sessizce $0 sayılmaz, fırlatır", () => {
    expect(() =>
      costOf("some-unpriced-model", {
        inputTokens: 10,
        outputTokens: 10,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toThrow(UnknownModelPriceError);
  });

  it("rezervasyon tahmini gerçek maliyetten düşük olmaz (cömert tahmin)", () => {
    const estimate = estimateCost("claude-sonnet-5", 20_000, 4_000);
    const actual = costOf("claude-sonnet-5", {
      inputTokens: 20_000,
      outputTokens: 900, // gerçek çıktı tavanın altında kaldı
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(estimate).toBeGreaterThan(actual);
  });
});
