import { randomUUID } from "node:crypto";
import {
  EVENT_SCHEMA_VERSION,
  type EventInput,
  type MissionEvent,
  missionEventSchema,
} from "./events.js";

/**
 * Append-only event store sözleşmesi (MASTER_PLAN §11.2 Event System).
 * MVP'de Postgres `events` tablosu + LISTEN/NOTIFY bu arayüzün arkasına girer;
 * Faz 0'da in-memory implementasyon SSE dikeyini ayağa kaldırmak için yeterli.
 */
export interface EventStore {
  append(input: EventInput): Promise<MissionEvent>;
  list(missionId: string): Promise<MissionEvent[]>;
  /** Yeni event'leri dinle; dönen fonksiyon aboneliği iptal eder. */
  subscribe(missionId: string, listener: (event: MissionEvent) => void): () => void;
}

export class InMemoryEventStore implements EventStore {
  private readonly byMission = new Map<string, MissionEvent[]>();
  private readonly listeners = new Map<string, Set<(event: MissionEvent) => void>>();

  async append(input: EventInput): Promise<MissionEvent> {
    const existing = this.byMission.get(input.missionId) ?? [];
    const event = missionEventSchema.parse({
      ...input,
      id: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      seq: existing.length + 1,
      ts: new Date().toISOString(),
    });
    existing.push(event);
    this.byMission.set(input.missionId, existing);
    for (const listener of this.listeners.get(input.missionId) ?? []) {
      listener(event);
    }
    return event;
  }

  async list(missionId: string): Promise<MissionEvent[]> {
    return [...(this.byMission.get(missionId) ?? [])];
  }

  subscribe(missionId: string, listener: (event: MissionEvent) => void): () => void {
    const set = this.listeners.get(missionId) ?? new Set();
    set.add(listener);
    this.listeners.set(missionId, set);
    return () => {
      set.delete(listener);
    };
  }
}
