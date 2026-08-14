import { afterEach, describe, expect, it } from "vitest";
import { containsSecret, redactSecrets } from "../src/index.js";

const originalKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe("sır redaksiyonu", () => {
  it("Anthropic anahtar biçimini maskeler", () => {
    const text = "I found this in the config: sk-ant-api03-AbCdEf0123456789XyZ_secret-value";
    const output = redactSecrets(text);
    expect(output).not.toContain("sk-ant-api03");
    expect(output).toContain("[redacted]");
    expect(containsSecret(output)).toBe(false);
  });

  it("ortamdaki gerçek anahtarın birebir kendisini maskeler", () => {
    // Biçim tanınmasa bile o anki anahtar metinde geçiyorsa maskelenmeli.
    process.env.ANTHROPIC_API_KEY = "totally-custom-key-value-123456";
    const output = redactSecrets("the key is totally-custom-key-value-123456 ok");
    expect(output).not.toContain("totally-custom-key-value-123456");
    expect(output).toContain("[redacted]");
  });

  it("GitHub token'larını ve bearer başlıklarını maskeler", () => {
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain("[redacted]");
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain(
      "[redacted]",
    );
  });

  it("normal kod ve metni bozmaz", () => {
    const code = "def add(a, b):\n    return a + b  # sk is short\n";
    expect(redactSecrets(code)).toBe(code);
    expect(containsSecret(code)).toBe(false);
  });

  it("çok kısa ortam değerlerini sır saymaz (yanlış pozitif)", () => {
    process.env.ANTHROPIC_API_KEY = "x";
    const text = "the letter x appears here";
    expect(redactSecrets(text)).toBe(text);
  });
});
