import { costOf } from "../pricing.js";
import {
  EMPTY_USAGE,
  type CompletionRequest,
  type CompletionResponse,
  type ModelAdapter,
  type StopReason,
  type ToolCall,
  type Usage,
} from "../types.js";

/**
 * Senaryo güdümlü deterministik adapter.
 *
 * Bu bir test kancası değil, birinci sınıf bileşendir (bkz. PHASE_1A_PLAN §A.3):
 * CI'da API anahtarı yoktur ve agent döngüsünün limit/hata davranışları ancak
 * deterministik bir modelle güvenilir şekilde test edilebilir. Gerçek modelin
 * çalıştığı iddiası yalnızca canlı smoke testinden gelir.
 */

export interface MockStep {
  /** Modelin bu turda ürettiği metin (timeline'da AI özeti olur). */
  text?: string;
  /** Bu turda istenen tool çağrıları; boşsa tur biter. */
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  stopReason?: StopReason;
  refusalCategory?: string;
  usage?: Partial<Usage>;
  /** Bu adımda sağlayıcı hatası fırlat (retry/failure yollarını test etmek için). */
  throws?: Error;
}

const DEFAULT_USAGE: Usage = {
  inputTokens: 1200,
  outputTokens: 180,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

export class MockAdapter implements ModelAdapter {
  readonly providerName = "mock";
  private callIndex = 0;
  /** Adapter'ın gördüğü istekler — testler prompt/tool birikimini doğrular. */
  readonly seenRequests: CompletionRequest[] = [];

  constructor(
    private readonly steps: MockStep[],
    readonly modelId = "claude-sonnet-5",
  ) {}

  get callCount(): number {
    return this.callIndex;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.seenRequests.push(request);
    const step = this.steps[this.callIndex];
    this.callIndex += 1;

    if (!step) {
      // Senaryonun bittiği yerde döngü kendi limitine takılmalı; sessizce
      // sonsuza kadar tool çağırmak yerine turu bitiriyoruz.
      return this.respond({ text: "(mock: no further steps)", stopReason: "end_turn" });
    }
    if (step.throws) throw step.throws;
    return this.respond(step);
  }

  private respond(step: MockStep): CompletionResponse {
    const usage: Usage = { ...DEFAULT_USAGE, ...step.usage };
    const toolCalls: ToolCall[] = (step.toolCalls ?? []).map((call, i) => ({
      id: `mock_call_${this.callIndex}_${i}`,
      name: call.name,
      input: call.input,
    }));
    const stopReason: StopReason =
      step.stopReason ?? (toolCalls.length > 0 ? "tool_use" : "end_turn");
    const response: CompletionResponse = {
      stopReason,
      text: step.text ?? "",
      toolCalls,
      usage: stopReason === "refusal" ? EMPTY_USAGE : usage,
      costUsd: stopReason === "refusal" ? 0 : costOf(this.modelId, usage),
      modelUsed: this.modelId,
    };
    if (step.refusalCategory !== undefined) {
      return { ...response, refusalCategory: step.refusalCategory };
    }
    return response;
  }
}
