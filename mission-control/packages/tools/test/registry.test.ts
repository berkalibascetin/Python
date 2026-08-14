import { afterEach, describe, expect, it } from "vitest";
import { LocalSandboxProvider, type Sandbox } from "@mission-control/sandbox";
import { ToolRuntime } from "../src/index.js";

const provider = new LocalSandboxProvider();
const created: Sandbox[] = [];

async function runtime(): Promise<{ rt: ToolRuntime; sandbox: Sandbox }> {
  const sandbox = await provider.create({ missionId: "tools-test" });
  created.push(sandbox);
  return { rt: new ToolRuntime(sandbox), sandbox };
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((sandbox) => sandbox.destroy()));
});

describe("ToolRuntime", () => {
  it("role göre yalnızca yetkili tool'ları modele gösterir", async () => {
    const { rt } = await runtime();
    expect(rt.specsFor("developer").map((t) => t.name).sort()).toEqual([
      "repo.read",
      "repo.write",
      "shell.run",
    ]);
    expect(rt.specsFor("manager").map((t) => t.name)).toEqual(["repo.read"]);
  });

  it("yetkisiz çağrı istisna değil, agent'a dönen hata sonucudur", async () => {
    const { rt } = await runtime();
    const outcome = await rt.invoke("manager", "repo.write", {
      path: "a.py",
      old_string: "",
      new_string: "x",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("Permission denied");
  });

  it("repo.write tek eşleşmeyi düzenler", async () => {
    const { rt, sandbox } = await runtime();
    await sandbox.writeFile("app.py", "def f():\n    return None\n");
    const outcome = await rt.invoke("developer", "repo.write", {
      path: "app.py",
      old_string: "return None",
      new_string: "return 42",
    });
    expect(outcome.isError).toBeFalsy();
    expect(await sandbox.readFile("app.py")).toContain("return 42");
  });

  it("belirsiz eşleşmede yazmayı reddeder ve nedenini söyler", async () => {
    const { rt, sandbox } = await runtime();
    await sandbox.writeFile("app.py", "x = 1\nx = 1\n");
    const outcome = await rt.invoke("developer", "repo.write", {
      path: "app.py",
      old_string: "x = 1",
      new_string: "x = 2",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("appears 2 times");
    expect(await sandbox.readFile("app.py")).toBe("x = 1\nx = 1\n"); // dokunulmadı
  });

  it("var olan dosyayı boş old_string ile ezmeye izin vermez", async () => {
    const { rt, sandbox } = await runtime();
    await sandbox.writeFile("app.py", "important\n");
    const outcome = await rt.invoke("developer", "repo.write", {
      path: "app.py",
      old_string: "",
      new_string: "wiped",
    });
    expect(outcome.isError).toBe(true);
    expect(await sandbox.readFile("app.py")).toBe("important\n");
  });

  it("shell.run ölçülmüş facts döndürür", async () => {
    const { rt } = await runtime();
    const outcome = await rt.invoke("developer", "shell.run", {
      command: "node",
      args: ["-e", "console.log('ran')"],
    });
    expect(outcome.content).toContain("ran");
    expect(outcome.facts?.exitCode).toBe(0);
    expect(outcome.facts?.command).toBe("node -e console.log('ran')");
  });
});
