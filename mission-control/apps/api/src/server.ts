import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { InMemoryEventStore } from "@mission-control/core";
import { extractZip, IngestRejectedError, DEFAULT_INGEST_LIMITS } from "@mission-control/ingest";
import { runMission } from "@mission-control/runtime";
import {
  buildGateway,
  listProjects,
  modelId,
  resolveProjectDir,
  runMode,
  selectSandbox,
} from "./config.js";
import { startDemoMission } from "./demoMission.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const store = new InMemoryEventStore();
const gateway = buildGateway();
const sandbox = await selectSandbox();
/** Bilinen mission id'leri — event uçları yalnızca bunlara yanıt verir. */
const missions = new Set<string>();

const app = Fastify({
  logger: true,
  // Gövde tavanı ilk savunma hattı: limitin üstündeki yükleme hiç okunmaz.
  bodyLimit: DEFAULT_INGEST_LIMITS.maxArchiveBytes,
});

// ZIP gövdesini ham buffer olarak alıyoruz; ayrıştırma güvenli ingest
// katmanının işi, Fastify'ın değil.
app.addContentTypeParser(
  "application/zip",
  { parseAs: "buffer", bodyLimit: DEFAULT_INGEST_LIMITS.maxArchiveBytes },
  (_req, body, done) => done(null, body),
);

app.get("/", async (_req, reply) => {
  const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
  reply.type("text/html").send(html);
});

/** Arayüzün modu ve izolasyon durumunu dürüstçe gösterebilmesi için. */
app.get("/config", async () => ({
  mode: runMode,
  model: modelId,
  sandbox: sandbox.provider.kind,
  isolated: sandbox.isolated,
  ...(sandbox.reason ? { sandboxReason: sandbox.reason } : {}),
  projects: await listProjects(),
}));

app.post("/missions", async (request, reply) => {
  const body = (request.body ?? {}) as { goal?: string; project?: string; demo?: boolean };

  if (body.demo) {
    const { mission } = startDemoMission(store, body.goal?.trim() || "Demo mission");
    missions.add(mission.id);
    return reply.code(201).send({ missionId: mission.id, mode: "demo" });
  }

  const project = body.project?.trim() || "py-auth-bug";
  const sourceDir = resolveProjectDir(project);
  if (!sourceDir) return reply.code(400).send({ error: "unknown project" });

  const goal = body.goal?.trim() || "Fix the failing tests.";
  // Mission uzun sürer; id hemen döner, ilerleme SSE'den akar (§12 async).
  const missionId = crypto.randomUUID();
  missions.add(missionId);

  void runMission({
    goal,
    sourceDir,
    gateway,
    sandboxes: sandbox.provider,
    // PROJECTS_ROOT altındakiler bizim golden fixture'larımızdır. İzolasyon
    // yoksa yalnızca bunlar çalışabilir; kullanıcıdan gelen bir proje
    // eklendiğinde `untrusted` geçilmeli ve izolasyonsuz sağlayıcı bunu
    // reddetmelidir (Faz 1b sözleşmesi).
    trust: sandbox.isolated ? "untrusted" : "trusted",
    events: withFixedId(store, missionId),
  }).catch((err) => app.log.error({ err }, "mission failed"));

  return reply.code(201).send({ missionId, mode: runMode, project });
});

/**
 * Kullanıcı projesi yükleme (PHASE_1C §1).
 *
 * Yüklenen arşiv tamamen güvenilmez kabul edilir: güvenli çıkarma katmanından
 * geçer, ardından mission `untrusted` olarak koşar — yani izolasyon yoksa
 * sandbox sağlayıcısı bunu reddeder.
 */
app.post("/missions/upload", async (request, reply) => {
  if (!sandbox.isolated) {
    // İzolasyon olmadan kullanıcı kodu çalıştırmayı reddediyoruz.
    return reply.code(503).send({
      error: "no isolated sandbox available",
      detail: sandbox.reason,
      hint: "Start Docker and build the sandbox image (scripts/build-sandbox-image.sh).",
    });
  }

  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return reply.code(400).send({ error: "expected a non-empty application/zip body" });
  }

  const goal = typeof request.query === "object" && request.query
    ? String((request.query as { goal?: string }).goal ?? "").trim()
    : "";

  const stagingDir = await mkdtemp(join(tmpdir(), "mc-upload-"));
  const archivePath = join(stagingDir, "upload.zip");
  let projectRoot: string | undefined;

  try {
    await writeFile(archivePath, body);
    const ingested = await extractZip(archivePath, { baseDir: stagingDir });
    projectRoot = ingested.rootDir;

    const missionId = crypto.randomUUID();
    missions.add(missionId);

    void runMission({
      goal: goal || "Review this project and fix anything that is broken.",
      sourceDir: projectRoot,
      gateway,
      sandboxes: sandbox.provider,
      trust: "untrusted",
      events: withFixedId(store, missionId),
    })
      .catch((err) => app.log.error({ err }, "uploaded mission failed"))
      // Çıkarılmış kaynak kod mission bitince silinir (§9.1 retention).
      .finally(() => void rm(stagingDir, { recursive: true, force: true }));

    return reply.code(201).send({
      missionId,
      mode: runMode,
      ingest: {
        files: ingested.files,
        directories: ingested.directories,
        totalBytes: ingested.totalBytes,
        durationMs: ingested.durationMs,
      },
    });
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true });
    if (err instanceof IngestRejectedError) {
      // Reddedilen yükleme bir mission DEĞİLDİR; başarı gibi görünmemeli.
      return reply.code(422).send({ error: "ingest_rejected", reason: err.reason, detail: err.message });
    }
    app.log.error({ err }, "upload failed");
    return reply.code(500).send({ error: "upload failed" });
  }
});

app.get("/missions/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!missions.has(id)) return reply.code(404).send({ error: "mission not found" });
  return store.list(id);
});

app.get("/missions/:id/stream", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!missions.has(id)) return reply.code(404).send({ error: "mission not found" });

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (data: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  for (const event of await store.list(id)) send(event);
  const unsubscribe = store.subscribe(id, send);

  const heartbeat = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  return reply;
});

/**
 * runMission kendi mission id'sini üretir; API ise id'yi çağrıya hemen
 * döndürmek zorunda. Bu sarmalayıcı event'leri istemcinin bildiği id'ye
 * yazar — store sözleşmesi değişmeden.
 */
function withFixedId(inner: InMemoryEventStore, missionId: string): InMemoryEventStore {
  return {
    append: (input) => inner.append({ ...input, missionId }),
    list: (id) => inner.list(id),
    subscribe: (id, listener) => inner.subscribe(id, listener),
  } as InMemoryEventStore;
}

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(
      { mode: runMode, model: modelId, sandbox: sandbox.provider.kind, isolated: sandbox.isolated },
      "mission-control api ready",
    );
    if (!sandbox.isolated) {
      app.log.warn(
        { reason: sandbox.reason },
        "No isolating sandbox available — only bundled golden fixtures can run. " +
          "Untrusted projects will be refused.",
      );
    }
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
