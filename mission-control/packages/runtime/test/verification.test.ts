import { afterEach, describe, expect, it } from "vitest";
import { LocalSandboxProvider, type Sandbox } from "@mission-control/sandbox";
import { detectVerification, parseCounts, runVerification } from "../src/index.js";

const provider = new LocalSandboxProvider();
const created: Sandbox[] = [];

async function sandbox(): Promise<Sandbox> {
  const sb = await provider.create({ missionId: "verify-test", trust: "trusted" });
  created.push(sb);
  return sb;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((sb) => sb.destroy()));
});

describe("parseCounts", () => {
  it("pytest özetini okur", () => {
    expect(parseCounts("2 failed, 3 passed in 0.04s")).toEqual({ passed: 3, failed: 2 });
    expect(parseCounts("4 passed in 0.02s")).toEqual({ passed: 4, failed: 0 });
  });

  it("pytest toplama hatalarını başarısızlığa ekler", () => {
    // Toplanamayan bir modül "0 hata" değildir.
    expect(parseCounts("1 error in 0.10s")).toEqual({ passed: 0, failed: 1 });
    expect(parseCounts("1 failed, 2 errors in 0.10s")).toEqual({ passed: 0, failed: 3 });
  });

  it("node test runner TAP özetini okur", () => {
    expect(parseCounts("# tests 3\n# pass 2\n# fail 1\n")).toEqual({ passed: 2, failed: 1 });
  });

  it("tanımadığı çıktıda sayı uydurmaz", () => {
    expect(parseCounts("some unrelated output")).toEqual({ passed: 0, failed: 0 });
  });
});

describe("detectVerification", () => {
  it("Python test dosyalarını tanır", async () => {
    const sb = await sandbox();
    await sb.writeFile("test_thing.py", "def test_x():\n    assert True\n");
    expect(await detectVerification(sb)).toEqual({
      command: "python3",
      args: ["-m", "pytest", "-q"],
    });
  });

  it("package.json test script'ini tanır", async () => {
    const sb = await sandbox();
    await sb.writeFile("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    expect(await detectVerification(sb)).toEqual({ command: "npm", args: ["test", "--silent"] });
  });

  it("test script'i olmayan package.json'ı test seti sanmaz", async () => {
    const sb = await sandbox();
    await sb.writeFile("package.json", JSON.stringify({ scripts: { build: "tsc" } }));
    expect(await detectVerification(sb)).toBeNull();
  });

  it("bozuk package.json'ı tespit sinyali saymaz", async () => {
    const sb = await sandbox();
    await sb.writeFile("package.json", "{ not json");
    expect(await detectVerification(sb)).toBeNull();
  });

  it("test seti yoksa null döner", async () => {
    const sb = await sandbox();
    await sb.writeFile("main.py", "print('hi')\n");
    expect(await detectVerification(sb)).toBeNull();
  });
});

describe("runVerification", () => {
  it("test seti yokken 'inconclusive' der, '0 hata' demez", async () => {
    const sb = await sandbox();
    await sb.writeFile("main.py", "print('hi')\n");
    const result = await runVerification(sb);
    expect(result.inconclusive).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.output).toContain("No test suite detected");
  });

  it("gerçek pytest koşusunu ölçer", async () => {
    const sb = await sandbox();
    await sb.writeFile("thing.py", "def double(x):\n    return x * 2\n");
    await sb.writeFile(
      "test_thing.py",
      "from thing import double\n\n\ndef test_ok():\n    assert double(2) == 4\n\n\ndef test_broken():\n    assert double(2) == 5\n",
    );
    const result = await runVerification(sb);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.exitCode).not.toBe(0);
    expect(result.inconclusive).toBe(false);
    expect(result.command).toBe("python3 -m pytest -q");
  }, 60_000);
});
