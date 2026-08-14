/**
 * Sır redaksiyonu (PHASE_1C §7).
 *
 * Ağ kapalı ve host env container'a girmiyor olsa da, bir anahtar sisteme
 * başka yollardan girebilir: kullanıcı hedef metnine yapıştırır, projede
 * yanlışlıkla commit edilmiştir, ya da model çıktısında tekrarlanır.
 *
 * Bu fonksiyon son savunma hattıdır — anahtarı sisteme sokmamak birinci
 * savunmadır. Yakalayamadığı biçimler olabilir; bu yüzden "artık sızıntı
 * imkânsız" değil, "bilinen biçimler kalıcı kayda geçmez" garantisidir.
 */

const REDACTED = "[redacted]";

/** Bilinen sağlayıcı anahtar biçimleri. */
const PATTERNS: RegExp[] = [
  // Anthropic: sk-ant-… (api key ve oauth token biçimleri)
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  // OpenAI ve benzerleri: sk-… / sk-proj-…
  /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g,
  // Genel bearer token'ları
  /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
  // GitHub: ghp_, gho_, ghs_, github_pat_
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
];

/**
 * Ortamda bulunan gerçek sır değerleri. Biçim tanınmasa bile, o anki
 * anahtarın birebir kendisi metinde geçiyorsa maskelenir.
 */
function environmentSecrets(): string[] {
  const names = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GITHUB_TOKEN",
    "MC_SANDBOX_REGISTRY_TOKEN",
  ];
  const values: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    // Çok kısa değerler yanlış pozitif üretir (ör. "1"); anlamlı uzunluk şartı.
    if (value && value.length >= 12) values.push(value);
  }
  return values;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Metindeki bilinen sır biçimlerini ve ortamdaki gerçek sırları maskeler. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let output = text;
  for (const secret of environmentSecrets()) {
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  for (const pattern of PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/** Metinde maskelenmemiş bir sır kalıp kalmadığını söyler (testler için). */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  if (environmentSecrets().some((secret) => text.includes(secret))) return true;
  return PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
