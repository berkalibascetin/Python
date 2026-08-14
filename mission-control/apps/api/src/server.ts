import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { InMemoryEventStore, type Mission } from "@mission-control/core";
import { startDemoMission } from "./demoMission.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const store = new InMemoryEventStore();
const missions = new Map<string, Mission>();

const app = Fastify({ logger: true });

app.get("/", async (_req, reply) => {
  const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
  reply.type("text/html").send(html);
});

app.post("/missions", async (request, reply) => {
  const body = (request.body ?? {}) as { goal?: string };
  const goal = body.goal?.trim() || "Fix the authentication problem.";
  const { mission } = startDemoMission(store, goal);
  missions.set(mission.id, mission);
  reply.code(201).send({ missionId: mission.id, goal });
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

  // Önce mevcut event'ler (replay), sonra canlı akış — SSE tek yönlü yeterli (§7).
  for (const event of await store.list(id)) send(event);
  const unsubscribe = store.subscribe(id, send);

  const heartbeat = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  // Fastify yanıtı biz yönetiyoruz; bağlantı client kapatana dek açık kalır.
  return reply;
});

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`mission-control api on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
