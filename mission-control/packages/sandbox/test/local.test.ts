import { afterEach, describe, expect, it } from "vitest";
import { LocalSandboxProvider, PathEscapeError, type Sandbox } from "../src/index.js";

const provider = new LocalSandboxProvider();
const created: Sandbox[] = [];

async function makeSandbox(): Promise<Sandbox> {
  const sandbox = await provider.create({ missionId: "test-mission", trust: "trusted" });
  created.push(sandbox);
  return sandbox;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((sandbox) => sandbox.destroy()));
});

describe("LocalProcessSandbox", () => {
  it("workspace içinde dosya yazıp okur", async () => {
    const sandbox = await makeSandbox();
    await sandbox.writeFile("src/app.py", "print('hi')\n");
    expect(await sandbox.readFile("src/app.py")).toBe("print('hi')\n");
    expect(await sandbox.listFiles()).toContain("src/app.py");
  });

  it("workspace dışına çıkan yolları reddeder", async () => {
    const sandbox = await makeSandbox();
    await expect(sandbox.readFile("../../etc/passwd")).rejects.toThrow(PathEscapeError);
    await expect(sandbox.writeFile("/etc/evil", "x")).rejects.toThrow(PathEscapeError);
    await expect(sandbox.writeFile("nested/../../escape.txt", "x")).rejects.toThrow(PathEscapeError);
  });

  it("komut çalıştırır ve çıkış kodunu döndürür", async () => {
    const sandbox = await makeSandbox();
    const ok = await sandbox.exec("node", ["-e", "console.log('out')"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.trim()).toBe("out");

    const fail = await sandbox.exec("node", ["-e", "process.exit(3)"]);
    expect(fail.exitCode).toBe(3);
  });

  it("süre limitini aşan komutu öldürür", async () => {
    const sandbox = await makeSandbox();
    const res = await sandbox.exec("node", ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 300 });
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
  });

  it("diffStat gerçek değişimi sayar (agent beyanını değil)", async () => {
    const sandbox = await makeSandbox();
    await sandbox.writeFile("a.txt", "one\ntwo\nthree\n");
    await sandbox.exec("git", ["add", "-A"]);
    await sandbox.exec("git", ["commit", "-q", "-m", "seed"]);

    await sandbox.writeFile("a.txt", "one\nCHANGED\nthree\n");
    await sandbox.writeFile("b.txt", "new file\n");

    const stat = await sandbox.diffStat();
    expect(stat.files).toBe(2);
    expect(stat.added).toBe(2); // a.txt'te 1 değişen satır + b.txt'te 1 yeni satır
    expect(stat.removed).toBe(1);
    expect(await sandbox.unifiedDiff()).toContain("CHANGED");
  });
});
