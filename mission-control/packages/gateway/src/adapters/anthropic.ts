import Anthropic, { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";
import { costOf } from "../pricing.js";
import {
  PermanentProviderError,
  TransientProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type ModelAdapter,
  type StopReason,
  type ToolCall,
  type Usage,
} from "../types.js";

/**
 * Anthropic adapter (MASTER_PLAN §15).
 *
 * Sağlayıcıya özgü her şey bu dosyada kalır; dışarı yalnızca ModelAdapter
 * sözleşmesi sızar. Dikkat edilen API kuralları:
 *  - `temperature`/`top_p`/`top_k` GÖNDERİLMEZ (5-ailesinde 400 döner).
 *  - Düşünme derinliği `budget_tokens` ile değil `effort` ile ayarlanır.
 *  - `stop_reason === "refusal"` içerik OKUNMADAN ÖNCE kontrol edilir.
 *  - Tool sonuçları TEK bir user mesajında toplu gönderilir; bölmek modelin
 *    paralel tool kullanımını bozar.
 *  - Asistan turunun ham block'ları olduğu gibi geri oynatılır (raw).
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly providerName = "anthropic";
  private readonly client: Anthropic;

  constructor(
    readonly modelId: string,
    client?: Anthropic,
  ) {
    // Sıfır argümanlı kurucu kimlik bilgisini ortamdan çözer; anahtarı koda gömmeyiz.
    this.client = client ?? new Anthropic();
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.modelId,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: toMessages(request.turns),
      thinking: { type: "adaptive" },
      ...(request.effort ? { output_config: { effort: request.effort } } : {}),
      ...(request.tools.length > 0 ? { tools: toTools(request.tools) } : {}),
    };

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(params, { signal: request.signal });
    } catch (err) {
      throw classifyError(err);
    }

    const usage = readUsage(message.usage);
    // refusal: içeriğe dokunmadan önce. Reddedilen istek (çıktı öncesi) ücretlenmez.
    if (message.stop_reason === "refusal") {
      const category = (message as { stop_details?: { category?: string } }).stop_details?.category;
      return {
        stopReason: "refusal",
        text: "",
        toolCalls: [],
        usage,
        costUsd: costOf(this.modelId, usage),
        modelUsed: message.model,
        ...(category ? { refusalCategory: category } : {}),
      };
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const toolCalls: ToolCall[] = message.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      }));

    return {
      stopReason: mapStopReason(message.stop_reason),
      text,
      toolCalls,
      usage,
      costUsd: costOf(this.modelId, usage),
      modelUsed: message.model,
      raw: message.content,
    };
  }
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      // `pause_turn` yalnızca sunucu-taraflı tool'larla oluşur; onları
      // kullanmıyoruz. Diğer her şey normal tur sonu.
      return "end_turn";
  }
}

function readUsage(usage: Anthropic.Usage): Usage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}

function toTools(tools: CompletionRequest["tools"]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function toMessages(turns: CompletionRequest["turns"]): Anthropic.MessageParam[] {
  return turns.map((turn) => {
    if (turn.role === "user") {
      return { role: "user", content: turn.text };
    }
    if (turn.role === "assistant") {
      // Ham block'lar varsa aynen geri oynat (reasoning block'larını düşürmek
      // sonraki istekte sıra/imza hatasına yol açabilir).
      if (Array.isArray(turn.raw)) {
        return { role: "assistant", content: turn.raw as Anthropic.ContentBlockParam[] };
      }
      const content: Anthropic.ContentBlockParam[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      for (const call of turn.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      return { role: "assistant", content };
    }
    // Tool sonuçları: hepsi TEK user mesajında.
    return {
      role: "user",
      content: turn.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.callId,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
    };
  });
}

/**
 * Geçici ↔ kalıcı hata ayrımı (§12): yalnızca geçici olanlar retry edilir.
 * Tipli SDK sınıflarıyla ayırt edilir — mesaj metnine göre eşleştirme yapılmaz.
 */
function classifyError(err: unknown): Error {
  if (err instanceof RateLimitError) {
    const header = err.headers?.get?.("retry-after");
    const retryAfterMs = header ? Number(header) * 1000 : Number.NaN;
    return new TransientProviderError(
      `rate limited: ${err.message}`,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    );
  }
  if (err instanceof APIConnectionError) {
    return new TransientProviderError(`connection error: ${err.message}`);
  }
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    return status >= 500
      ? new TransientProviderError(`server error ${status}: ${err.message}`)
      : new PermanentProviderError(`api error ${status}: ${err.message}`);
  }
  return err instanceof Error ? err : new PermanentProviderError(String(err));
}
