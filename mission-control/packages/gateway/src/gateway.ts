import {
  TransientProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type ModelAdapter,
  type ModelRef,
} from "./types.js";

/**
 * ModelGateway (MASTER_PLAN §15).
 *
 * Tek iş yapar: rol alias'ını (`modelRef`) bir adapter'a bağlar, çağrıyı
 * ölçer, geçici hatalarda yeniden dener. Model seçimi konfigürasyondur —
 * bir modeli değiştirmek çekirdek kodun tek satırını değiştirmez.
 */

export interface GatewayOptions {
  /** Geçici hatalarda maksimum yeniden deneme (kalite hataları retry edilmez). */
  maxRetries?: number;
  /** İlk backoff gecikmesi; her denemede iki katına çıkar. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class UnknownModelRefError extends Error {
  constructor(readonly modelRef: string) {
    super(`No adapter registered for model ref "${modelRef}"`);
    this.name = "UnknownModelRefError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ModelGateway {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    /** modelRef → adapter. Rol başına varsayılan model burada bağlanır. */
    private readonly adapters: Map<ModelRef, ModelAdapter>,
    options: GatewayOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
  }

  static fromRecord(record: Record<ModelRef, ModelAdapter>, options?: GatewayOptions): ModelGateway {
    return new ModelGateway(new Map(Object.entries(record)), options);
  }

  /** Bir rolün hangi somut modele bağlı olduğu — timeline'da beyan için. */
  modelIdFor(modelRef: ModelRef): string {
    const adapter = this.adapters.get(modelRef);
    if (!adapter) throw new UnknownModelRefError(modelRef);
    return adapter.modelId;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const adapter = this.adapters.get(request.modelRef);
    if (!adapter) throw new UnknownModelRefError(request.modelRef);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await adapter.complete(request);
      } catch (err) {
        lastError = err;
        // Yalnızca geçici hatalar yeniden denenir. Modelin kötü çıktı üretmesi
        // bir "hata" değildir; o recovery döngüsüne gider (§12).
        if (!(err instanceof TransientProviderError) || attempt === this.maxRetries) throw err;
        const delay = err.retryAfterMs ?? this.baseDelayMs * 2 ** attempt;
        await this.sleep(delay);
      }
    }
    throw lastError;
  }
}
