import { describe, expect, it } from "vitest";
import {
  buildRunArgs,
  DEFAULT_LIMITS,
  resolveContainerUser,
  UnsupportedNetworkPolicyError,
} from "../src/index.js";

/**
 * Docker gerektirmeyen güvenlik testleri: container'ı hangi bayraklarla
 * başlattığımız saf bir fonksiyondan geliyor, dolayısıyla izolasyon
 * kararları Docker kurulu olmayan makinelerde de doğrulanabiliyor.
 *
 * Bu testlerin değeri: bir gün biri "hata ayıklamak için" --privileged
 * eklerse ya da network bayrağını kaldırırsa, CI bunu yakalar.
 */

const base = {
  containerName: "mc-test",
  missionId: "mission-1",
  image: "mission-control/sandbox:local",
  hostWorkDir: "/tmp/mc-abc/work",
  limits: DEFAULT_LIMITS,
  network: "none" as const,
  user: "65534:65534",
  command: "python3",
  args: ["-m", "pytest"],
};

describe("docker run argümanları — izolasyon sözleşmesi", () => {
  it("ağı kapatır", () => {
    expect(buildRunArgs(base)).toContain("--network=none");
  });

  it("privileged veya capability ekleme ASLA yapmaz", () => {
    const args = buildRunArgs(base);
    expect(args).not.toContain("--privileged");
    expect(args.some((a) => a.startsWith("--cap-add"))).toBe(false);
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges");
  });

  it("yalnızca çalışma ağacını mount eder; başka hiçbir host yolu vermez", () => {
    const args = buildRunArgs(base);
    const mounts = args.filter((_, i) => args[i - 1] === "-v");
    expect(mounts).toEqual(["/tmp/mc-abc/work:/workspace:rw"]);
  });

  it("Docker socket'i mount etmez", () => {
    const args = buildRunArgs(base).join(" ");
    expect(args).not.toContain("docker.sock");
    expect(args).not.toContain("/var/run");
  });

  it("git meta dizinini container'a vermez", () => {
    // Ölçümün kaynağı, ölçülen kodun erişemediği yerde durmalı.
    const args = buildRunArgs(base).join(" ");
    expect(args).not.toContain("/git");
    expect(args).not.toContain(".git");
  });

  it("host ortam değişkenlerini aktarmaz", () => {
    const args = buildRunArgs(base);
    expect(args).not.toContain("-e");
    expect(args).not.toContain("--env");
    expect(args).not.toContain("--env-file");
  });

  it("root dosya sistemini salt-okunur yapar ve /tmp'i sınırlar", () => {
    const args = buildRunArgs(base);
    expect(args).toContain("--read-only");
    const tmpfs = args[args.indexOf("--tmpfs") + 1];
    expect(tmpfs).toContain("noexec");
    expect(tmpfs).toContain(`size=${DEFAULT_LIMITS.tmpfsMb}m`);
  });

  it("kaynak limitlerini geçirir", () => {
    const args = buildRunArgs(base);
    expect(args).toContain(`--pids-limit=${DEFAULT_LIMITS.pids}`);
    expect(args).toContain(`--memory=${DEFAULT_LIMITS.memoryMb}m`);
    // swap = memory: takasa taşarak bellek limitini aşmak mümkün olmamalı.
    expect(args).toContain(`--memory-swap=${DEFAULT_LIMITS.memoryMb}m`);
    expect(args).toContain(`--cpus=${DEFAULT_LIMITS.cpus}`);
  });

  it("container'ı temizlenebilir kılan etiket ve --rm taşır", () => {
    const args = buildRunArgs(base);
    expect(args).toContain("--rm");
    expect(args).toContain("mission-control.sandbox=1");
    expect(args).toContain(`mission-control.mission=${base.missionId}`);
  });

  it("desteklenmeyen ağ politikasında sessizce ağ açmaz, hata verir", () => {
    expect(() => buildRunArgs({ ...base, network: "full" })).toThrow(UnsupportedNetworkPolicyError);
    expect(() => buildRunArgs({ ...base, network: "controlled" })).toThrow(
      UnsupportedNetworkPolicyError,
    );
  });

  it("cwd container yolunun altında kalır", () => {
    const args = buildRunArgs({ ...base, cwd: "sub/dir" });
    expect(args[args.indexOf("-w") + 1]).toBe("/workspace/sub/dir");
  });
});

describe("container kullanıcısı", () => {
  it("host root ise container'da root çalıştırmaz", () => {
    expect(resolveContainerUser(() => 0, () => 0)).toBe("65534:65534");
  });

  it("host non-root ise sahiplik bozulmasın diye host kullanıcısını kullanır", () => {
    expect(resolveContainerUser(() => 1000, () => 1000)).toBe("1000:1000");
  });

  it("uid belirlenemiyorsa (ör. Windows) non-root'a düşer", () => {
    expect(resolveContainerUser(() => undefined, () => undefined)).toBe("65534:65534");
  });
});
