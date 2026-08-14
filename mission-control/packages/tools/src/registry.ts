import type { Sandbox } from "@mission-control/sandbox";
import { PathEscapeError } from "@mission-control/sandbox";
import { checkToolCall, ROLE_PERMISSIONS, type AgentRole } from "./policy.js";

/**
 * Tool Registry (MASTER_PLAN §14.1).
 *
 * MVP seti bilinçli olarak dar: repo.read / repo.write / shell.run. Serbest
 * shell yok, ağ tool'u yok, workspace dışı erişim yok. Her genişletme kendi
 * izin/sandbox incelemesini gerektirir.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(sandbox: Sandbox, input: Record<string, unknown>): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Platform tarafından ölçülen gerçekler; timeline `facts`'ine akar. */
  facts?: { command?: string; exitCode?: number; durationMs?: number };
}

const MAX_OUTPUT_CHARS = 20_000;

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[${text.length - MAX_OUTPUT_CHARS} chars truncated]`;
}

export const repoRead: ToolDefinition = {
  name: "repo.read",
  description:
    "Read a file from the project workspace, or list the project's files. Provide `path` to read one file; omit it to list all files.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path to read." },
    },
    additionalProperties: false,
  },
  async run(sandbox, input) {
    if (typeof input.path !== "string" || input.path.length === 0) {
      const files = await sandbox.listFiles();
      return { content: files.join("\n") || "(empty workspace)" };
    }
    try {
      return { content: clip(await sandbox.readFile(input.path)) };
    } catch (err) {
      return {
        content: `Cannot read "${input.path}": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

export const repoWrite: ToolDefinition = {
  name: "repo.write",
  description:
    "Replace an exact string in a workspace file. `old_string` must appear exactly once in the file. To create a new file, pass an empty `old_string`.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      old_string: { type: "string", description: "Exact text to replace; empty to create a file." },
      new_string: { type: "string", description: "Replacement text." },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async run(sandbox, input) {
    const path = String(input.path ?? "");
    const oldString = String(input.old_string ?? "");
    const newString = String(input.new_string ?? "");
    try {
      // Boş old_string = yeni dosya. Var olan dosyayı bu yolla ezmeye izin
      // vermiyoruz; tam dosya ezme en pahalı geri alınamaz hata türü.
      if (oldString === "") {
        let exists = true;
        try {
          await sandbox.readFile(path);
        } catch {
          exists = false;
        }
        if (exists) {
          return {
            content: `"${path}" already exists — pass the exact text to replace instead of creating it.`,
            isError: true,
          };
        }
        await sandbox.writeFile(path, newString);
        return { content: `Created ${path} (${newString.split("\n").length} lines).` };
      }

      const current = await sandbox.readFile(path);
      const occurrences = current.split(oldString).length - 1;
      if (occurrences === 0) {
        return { content: `old_string not found in ${path}.`, isError: true };
      }
      if (occurrences > 1) {
        return {
          content: `old_string appears ${occurrences} times in ${path}; include more surrounding context so it matches exactly once.`,
          isError: true,
        };
      }
      await sandbox.writeFile(path, current.replace(oldString, newString));
      return { content: `Edited ${path}.` };
    } catch (err) {
      if (err instanceof PathEscapeError) {
        return { content: `Path is outside the workspace: ${path}`, isError: true };
      }
      return {
        content: `Write failed for "${path}": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

export const shellRun: ToolDefinition = {
  name: "shell.run",
  description:
    "Run one allowlisted command (e.g. pytest, npm) in the workspace. Not a shell: no pipes, redirects, or chained commands.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name, e.g. \"pytest\"." },
      args: { type: "array", items: { type: "string" }, description: "Arguments." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async run(sandbox, input) {
    const command = String(input.command ?? "");
    const args = Array.isArray(input.args) ? input.args.map(String) : [];
    const result = await sandbox.exec(command, args, { timeoutMs: 120_000 });
    const body = [
      result.stdout.trim(),
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      result.timedOut ? "(command timed out and was killed)" : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      content: clip(`exit code: ${result.exitCode}\n${body || "(no output)"}`),
      isError: result.exitCode !== 0,
      facts: {
        command: [command, ...args].join(" "),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
    };
  },
};

export const DEFAULT_TOOLS: ToolDefinition[] = [repoRead, repoWrite, shellRun];

/**
 * Tool çalıştırıcı: her çağrı önce policy'den geçer (§9). İzin ihlali bir
 * istisna değil, agent'a geri dönen bir hata sonucudur — döngü kırılmaz,
 * model başka bir yol denemek üzere bilgilendirilir.
 */
export class ToolRuntime {
  private readonly byName: Map<string, ToolDefinition>;

  constructor(
    private readonly sandbox: Sandbox,
    tools: ToolDefinition[] = DEFAULT_TOOLS,
  ) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /**
   * Bir rolün görebileceği tool tanımları — modele yalnızca bunlar gönderilir.
   * Yetkisi olmayan bir tool'u modele hiç göstermemek, sonra reddetmekten iyidir.
   */
  specsFor(role: AgentRole): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [...this.byName.values()]
      .filter((tool) => ROLE_PERMISSIONS[role].allowedTools.includes(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
  }

  async invoke(
    role: AgentRole,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    const decision = checkToolCall(role, toolName, input);
    if (!decision.allowed) {
      return { content: `Permission denied: ${decision.reason}`, isError: true };
    }
    const tool = this.byName.get(toolName);
    if (!tool) return { content: `Unknown tool "${toolName}".`, isError: true };
    return tool.run(this.sandbox, input);
  }
}
