/**
 * Model Gateway sözleşmesi (MASTER_PLAN §15).
 *
 * Provider bağımsızlığı burada yaşar: çekirdek kod hiçbir yerde model ID'si
 * veya sağlayıcı SDK tipi görmez. Rol alias'ı (`modelRef`) konfigle gerçek
 * modele bağlanır; kod modele değil yeteneğe koşullanır.
 */

/** Rol bazlı soyut model referansı — "developer-default" gibi. */
export type ModelRef = string;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12 alt kümesi). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  /** Sağlayıcının verdiği çağrı kimliği; sonucu eşlerken kullanılır. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export type ConversationTurn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      /**
       * Adapter'a ait opak yük: sağlayıcının döndürdüğü ham content block'ları.
       * Çekirdek bunu ASLA incelemez, yalnızca bir sonraki turda aynen geri verir.
       * Gerekçe: bazı sağlayıcılarda reasoning block'larını düşürmek sonraki
       * istekte sıra/imza hatasına yol açar; yeniden kurmak yerine taşımak
       * hem doğru hem provider-bağımsız.
       */
      raw?: unknown;
    }
  | { role: "tool"; results: ToolResult[] };

export interface CompletionRequest {
  modelRef: ModelRef;
  system: string;
  turns: ConversationTurn[];
  tools: ToolSpec[];
  maxTokens: number;
  /** Düşünme derinliği; sağlayıcıya özgü karşılığı adapter'da kurulur. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

/**
 * `refusal`: sağlayıcının güvenlik sınıflandırıcısı isteği reddetti. HTTP hata
 * değildir — içerik okunmadan ÖNCE kontrol edilmelidir.
 * `max_tokens`: çıktı tavanına çarpıldı, yanıt yarım.
 */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

export interface CompletionResponse {
  stopReason: StopReason;
  /** Modelin insan-okunur metni; timeline'da `aiSummary` olarak kullanılır. */
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  costUsd: number;
  /** Gerçekten hangi model çalıştı (fallback şeffaflığı, §15). */
  modelUsed: string;
  /** refusal durumunda sağlayıcının kategori bilgisi, varsa. */
  refusalCategory?: string;
  /** Bir sonraki tura aynen taşınacak opak sağlayıcı yükü (bkz. ConversationTurn). */
  raw?: unknown;
}

export interface ModelAdapter {
  readonly providerName: string;
  /** Bu adapter'ın hizmet verdiği somut model ID'si. */
  readonly modelId: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/** Geçici (retry edilebilir) sağlayıcı hatası — kalite hatasından ayrıdır (§12). */
export class TransientProviderError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TransientProviderError";
  }
}

/** Kalıcı hata: istek şekli, kimlik doğrulama, bilinmeyen model. Retry edilmez. */
export class PermanentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentProviderError";
  }
}
