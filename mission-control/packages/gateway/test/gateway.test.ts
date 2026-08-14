import { describe, expect, it, vi } from "vitest";
import {
  MockAdapter,
  ModelGateway,
  PermanentProviderError,
  TransientProviderError,
  UnknownModelRefError,
  type CompletionRequest,
} from "../src/index.js";

function request(modelRef: string): CompletionRequest {
  return { modelRef, system: "s", turns: [{ role: "user", text: "hi" }], tools: [], maxTokens: 100 };
}

describe("ModelGateway", () => {
  it("rol alias'ını adapter'a bağlar ve maliyeti ölçer", async () => {
    const gateway = ModelGateway.fromRecord({
      "developer-default": new MockAdapter([{ text: "done" }], "claude-sonnet-5"),
    });
    const res = await gateway.complete(request("developer-default"));
    expect(res.text).toBe("done");
    expect(res.modelUsed).toBe("claude-sonnet-5");
    expect(res.costUsd).toBeGreaterThan(0);
    expect(gateway.modelIdFor("developer-default")).toBe("claude-sonnet-5");
  });

  it("tanımsız model ref'i sessizce yutmaz", async () => {
    const gateway = ModelGateway.fromRecord({});
    await expect(gateway.complete(request("nope"))).rejects.toThrow(UnknownModelRefError);
  });

  it("geçici hatada backoff ile yeniden dener", async () => {
    const adapter = new MockAdapter([
      { throws: new TransientProviderError("429") },
      { throws: new TransientProviderError("503") },
      { text: "recovered" },
    ]);
    const sleep = vi.fn(async (_ms: number) => {});
    const gateway = ModelGateway.fromRecord(
      { dev: adapter },
      { baseDelayMs: 10, sleep },
    );
    const res = await gateway.complete(request("dev"));
    expect(res.text).toBe("recovered");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]); // exponential
  });

  it("kalıcı hatayı yeniden denemez", async () => {
    const adapter = new MockAdapter([{ throws: new PermanentProviderError("bad request") }]);
    const gateway = ModelGateway.fromRecord({ dev: adapter }, { sleep: async () => {} });
    await expect(gateway.complete(request("dev"))).rejects.toThrow(PermanentProviderError);
    expect(adapter.callCount).toBe(1);
  });

  it("retry bütçesi tükenince son hatayı yükseltir", async () => {
    const adapter = new MockAdapter([
      { throws: new TransientProviderError("1") },
      { throws: new TransientProviderError("2") },
    ]);
    const gateway = ModelGateway.fromRecord({ dev: adapter }, { maxRetries: 1, sleep: async () => {} });
    await expect(gateway.complete(request("dev"))).rejects.toThrow(TransientProviderError);
    expect(adapter.callCount).toBe(2);
  });

  it("refusal bir hata değil, yapılandırılmış bir sonuçtur", async () => {
    const gateway = ModelGateway.fromRecord({
      dev: new MockAdapter([{ stopReason: "refusal", refusalCategory: "cyber" }]),
    });
    const res = await gateway.complete(request("dev"));
    expect(res.stopReason).toBe("refusal");
    expect(res.refusalCategory).toBe("cyber");
    expect(res.costUsd).toBe(0);
  });
});
