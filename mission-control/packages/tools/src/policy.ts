/**
 * İzin modeli (MASTER_PLAN §9, §14).
 *
 * Kritik ilke: yetki PROMPT'ta değil, TOOL KATMANINDA yaşar. Prompt injection
 * ile ele geçirilen bir agent bile burada tanımlı olmayan bir şey yapamaz;
 * modelin "ikna edilmesi" bir yetki artışına dönüşmez.
 */

export type AgentRole = "manager" | "developer" | "reviewer" | "debugger";

export interface ToolPermission {
  /** Bu rolün çağırabileceği tool adları. */
  allowedTools: readonly string[];
  /** shell.run için izinli komutlar (argümanlar ayrıca doğrulanır). */
  allowedCommands: readonly string[];
}

/** Verification komutları — read-only roller de test koşabilir, kod yazamaz. */
const VERIFICATION_COMMANDS = ["pytest", "python", "python3", "npm", "node", "git"] as const;

export const ROLE_PERMISSIONS: Record<AgentRole, ToolPermission> = {
  manager: { allowedTools: ["repo.read"], allowedCommands: [] },
  developer: {
    allowedTools: ["repo.read", "repo.write", "shell.run"],
    allowedCommands: VERIFICATION_COMMANDS,
  },
  reviewer: { allowedTools: ["repo.read", "shell.run"], allowedCommands: VERIFICATION_COMMANDS },
  debugger: { allowedTools: ["repo.read", "shell.run"], allowedCommands: VERIFICATION_COMMANDS },
};

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

/** Kabuk operatörleri: allowlist'i delip başka komut çalıştırmanın yolu. */
const SHELL_METACHARACTERS = /[;&|`$><\n]|\$\(|&&|\|\|/;

export function checkToolCall(
  role: AgentRole,
  toolName: string,
  input: Record<string, unknown>,
): PolicyDecision {
  const permission = ROLE_PERMISSIONS[role];
  if (!permission) return { allowed: false, reason: `unknown role "${role}"` };
  if (!permission.allowedTools.includes(toolName)) {
    return { allowed: false, reason: `role "${role}" may not call "${toolName}"` };
  }

  if (toolName === "shell.run") {
    const command = typeof input.command === "string" ? input.command : "";
    if (!permission.allowedCommands.includes(command)) {
      return {
        allowed: false,
        reason: `command "${command}" is not in the allowlist (${permission.allowedCommands.join(", ")})`,
      };
    }
    const args = Array.isArray(input.args) ? input.args : [];
    for (const arg of args) {
      if (typeof arg !== "string") {
        return { allowed: false, reason: "shell.run args must be strings" };
      }
      // shell:false ile çalıştırıyoruz, yani metakarakterler zaten yorumlanmaz;
      // yine de reddediyoruz: geçerli bir kullanım değil ve niyeti gösterir.
      if (SHELL_METACHARACTERS.test(arg)) {
        return { allowed: false, reason: `shell metacharacters are not allowed: ${arg}` };
      }
    }
  }

  return { allowed: true };
}
