import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test arşivlerini Python'un zipfile modülüyle üretiyoruz.
 *
 * Neden bir kütüphane değil: saldırı arşivleri bilerek BOZUK ya da kötücül
 * yollar içerir (mutlak yol, `..`, sembolik bağ, sahte boyut). Çoğu JS zip
 * yazıcısı bunları üretmeyi reddeder — yani test edeceğimiz saldırıyı
 * kuramayız. Python'un zipfile'ı ham girdi yazmaya izin verir.
 */
export async function pythonZip(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mc-zipgen-"));
  const zipPath = join(dir, "archive.zip");
  const scriptPath = join(dir, "gen.py");
  await writeFile(
    scriptPath,
    `import zipfile, os, sys\nZIP_PATH = ${JSON.stringify(zipPath)}\n${script}\n`,
    "utf8",
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn("python3", [scriptPath], { shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`zip generator failed: ${stderr}`)),
    );
  });
  return zipPath;
}

/** Normal, zararsız bir proje arşivi. */
export function benignScript(): string {
  return [
    "with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:",
    "    z.writestr('project/app.py', 'def add(a, b):\\n    return a + b\\n')",
    "    z.writestr('project/test_app.py', 'from app import add\\n\\n\\ndef test():\\n    assert add(1,2) == 3\\n')",
  ].join("\n");
}
