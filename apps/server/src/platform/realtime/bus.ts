import { EventEmitter } from "node:events";

/**
 * Couple-scoped in-process event bus. The API publishes change events; SSE
 * connections subscribe by coupleId so both partners' UIs update live.
 *
 * NOTE: single-process by design. A multi-instance deployment would swap this
 * for a Postgres LISTEN/NOTIFY or Redis pub/sub adapter behind the same API.
 */
export type ChangeEvent = {
  type:
    | "entries.changed"
    | "result.changed"
    | "collection.changed"
    | "whatsapp.changed"
    | "calendar.changed";
  coupleId: string;
  collectionId?: string;
  at: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export function publish(event: Omit<ChangeEvent, "at">): void {
  const full: ChangeEvent = { ...event, at: new Date().toISOString() };
  emitter.emit(event.coupleId, full);
}

export function subscribe(coupleId: string, handler: (e: ChangeEvent) => void): () => void {
  emitter.on(coupleId, handler);
  return () => emitter.off(coupleId, handler);
}
