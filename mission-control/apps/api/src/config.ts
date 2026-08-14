import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicAdapter, MockAdapter, ModelGateway, type MockStep } from "@mission-control/gateway";

/**
 * Çalışma modu konfigürasyonu.
 *
 * Anahtar varsa gerçek model, yoksa senaryolu mock ile çalışır. Mod arayüzde
 * AÇIKÇA gösterilir: mock ile üretilmiş bir timeline'ın gerçek bir model
 * çalışmışçasına sunulması, ürünün tüm güven iddiasını çürütürdü (§7).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Projelerin okunabileceği tek kök — API üzerinden host'ta gezinmeyi engeller. */
export const PROJECTS_ROOT = join(REPO_ROOT, "fixtures", "golden");

export type RunMode = "live" | "mock";

export const runMode: RunMode = process.env.ANTHROPIC_API_KEY ? "live" : "mock";

export const modelId = process.env.MC_MODEL ?? "claude-sonnet-5";

/** Mock modda oynatılan senaryo: golden fixture'daki bug'ı düzeltir. */
const MOCK_SCRIPT: MockStep[] = [
  {
    text: "Let me look at the failing module.",
    toolCalls: [{ name: "repo.read", input: { path: "auth_service.py" } }],
  },
  {
    text: "Unknown usernames hit a KeyError; I'll look them up safely.",
    toolCalls: [
      {
        name: "repo.write",
        input: {
          path: "auth_service.py",
          old_string: "    user = USERS[username]",
          new_string: "    user = USERS.get(username)\n    if user is None:\n        return None",
        },
      },
    ],
  },
  {
    text: "require_role also indexes a possibly-None user; guarding that too.",
    toolCalls: [
      {
        name: "repo.write",
        input: {
          path: "auth_service.py",
          old_string: '    user = authenticate(username, password)\n    return user["role"] == role',
          new_string:
            '    user = authenticate(username, password)\n    if user is None:\n        return False\n    return user["role"] == role',
        },
      },
    ],
  },
  {
    text: "Running the tests to check the fix.",
    toolCalls: [{ name: "shell.run", input: { command: "python3", args: ["-m", "pytest", "-q"] } }],
  },
  { text: "authenticate() raised KeyError for unknown users; it now returns None." },
];

export function buildGateway(): ModelGateway {
  const adapter =
    runMode === "live" ? new AnthropicAdapter(modelId) : new MockAdapter(MOCK_SCRIPT, modelId);
  return ModelGateway.fromRecord({ "developer-default": adapter });
}

/** PROJECTS_ROOT altındaki çalıştırılabilir projeler. */
export async function listProjects(): Promise<string[]> {
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * Proje adını mutlak yola çevirir; kökün dışına çıkan her şeyi reddeder.
 * (API'den gelen değer güvenilmez girdidir — §9 prompt/parametre enjeksiyonu.)
 */
export function resolveProjectDir(name: string): string | null {
  const target = resolve(PROJECTS_ROOT, name);
  const rel = relative(PROJECTS_ROOT, target);
  if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) return null;
  return target;
}
