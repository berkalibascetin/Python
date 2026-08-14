import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  BudgetTracker,
  FixRoundGuard,
  normalizeFailureSignature,
} from "../src/index.js";

describe("budget circuit breaker", () => {
  it("tavanı aşacak rezervasyon çağrıdan ÖNCE engellenir", () => {
    const budget = new BudgetTracker(1.0);
    budget.reserve(0.6);
    budget.commit(0.6, 0.55);
    expect(() => budget.reserve(0.5)).toThrow(BudgetExceededError);
    expect(budget.snapshot().committedUsd).toBeCloseTo(0.55);
  });

  it("rezervasyon + commit mutabakatı remaining'i doğru hesaplar", () => {
    const budget = new BudgetTracker(2.0);
    budget.reserve(0.5);
    expect(budget.snapshot().remainingUsd).toBeCloseTo(1.5);
    budget.commit(0.5, 0.3); // gerçek maliyet tahminden düşük çıktı
    const snap = budget.snapshot();
    expect(snap.committedUsd).toBeCloseTo(0.3);
    expect(snap.reservedUsd).toBeCloseTo(0);
    expect(snap.remainingUsd).toBeCloseTo(1.7);
  });

  it("başarısız çağrıda release rezervasyonu geri bırakır", () => {
    const budget = new BudgetTracker(1.0);
    budget.reserve(0.9);
    budget.release(0.9);
    expect(() => budget.reserve(0.9)).not.toThrow();
  });
});

describe("fix round guard (thrashing tespiti)", () => {
  it("max tur sınırı uygulanır", () => {
    const guard = new FixRoundGuard(2);
    expect(guard.tryStartRound("sig-a").allowed).toBe(true);
    expect(guard.tryStartRound("sig-b").allowed).toBe(true);
    const third = guard.tryStartRound("sig-c");
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toContain("max fix rounds");
  });

  it("aynı hata imzası tekrarlanınca döngü kırılır", () => {
    const guard = new FixRoundGuard(5);
    expect(guard.tryStartRound("same").allowed).toBe(true);
    expect(guard.tryStartRound("same").allowed).toBe(true);
    const third = guard.tryStartRound("same");
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toContain("thrashing");
  });

  it("hata imzası normalizasyonu adres/sayı/whitespace gürültüsünü eler", () => {
    const a = normalizeFailureSignature(
      "AssertionError at auth_service.py:143\n  expected 200 got 500 (0xDEADBEEF)",
    );
    const b = normalizeFailureSignature(
      "AssertionError at auth_service.py:157   expected 201 got 503 (0xCAFEBABE)",
    );
    expect(a).toBe(b);
  });
});
