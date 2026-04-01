import type { SyncEvent } from "./events.js";

export interface SyncEventPayload {
  event: SyncEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Notifier {
  name: string;
  shouldHandle(event: SyncEvent): boolean;
  send(payload: SyncEventPayload): Promise<void>;
}
