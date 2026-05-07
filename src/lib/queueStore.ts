// In-memory + localStorage emergency case store.
// Cross-tab sync via 'storage' events + same-tab via custom EventTarget.

export type CallStatus =
  | "queued"
  | "ai_resolving"
  | "pending_verification"
  | "in_progress"
  | "escalated"
  | "connected"
  | "routed"
  | "resolved"
  | "rejected"
  | "false_alarm"
  | "critical"
  | "taken_over"
  | "pending_response"
  | "unreachable"
  | "retry_scheduled";

export interface CallerInfo {
  name: string;
  phone: string;
  email?: string;
  gps?: { lat: number; lng: number; accuracy?: number } | null;
  language?: string;
}

export interface CaseEvent {
  ts: string;
  kind:
    | "user"
    | "agent_ai"
    | "agent_human"
    | "system"
    | "escalation"
    | "status";
  text: string;
}

export interface QueuedCall {
  id: string;             // case id (also session id)
  ts: string;             // created
  reason: string;
  transcript: string;     // joined human-readable transcript snapshot
  events: CaseEvent[];    // structured event stream
  interpreted: any | null;
  confidence: number | null;
  sentiment: "calm" | "distress" | "panic" | null;
  priority: "low" | "medium" | "critical" | null;
  category: string | null;
  suggestedAction: string | null;
  language: string;
  status: CallStatus;
  caller: CallerInfo | null;
  assignedTo?: string | null;
  department?: string | null;
  notes?: string;
  // Resolution / audit
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  finalAction?: string | null;
  locked?: boolean;
  callbackAttempts?: CallbackAttempt[];
  retryCount?: number;
  nextRetryAt?: string | null;
}

export interface CallbackAttempt {
  ts: string;
  by: string;
  kind: "call" | "schedule_retry" | "follow_up" | "unreachable";
  note?: string;
}

const KEY = "agent_queue";
const bus = new EventTarget();

function read(): QueuedCall[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return arr.map((c: any) => ({
      id: c.id ?? crypto.randomUUID(),
      ts: c.ts ?? new Date().toISOString(),
      reason: c.reason ?? "",
      transcript: c.transcript ?? "",
      events: Array.isArray(c.events) ? c.events : [],
      interpreted: c.interpreted ?? null,
      confidence: c.confidence ?? null,
      sentiment: c.sentiment ?? null,
      priority: c.priority ?? null,
      category: c.category ?? null,
      suggestedAction: c.suggestedAction ?? null,
      language: c.language ?? "en-IN",
      status: c.status ?? "queued",
      caller: c.caller ?? null,
      assignedTo: c.assignedTo ?? null,
      department: c.department ?? null,
      notes: c.notes ?? "",
      resolvedAt: c.resolvedAt ?? null,
      resolvedBy: c.resolvedBy ?? null,
      finalAction: c.finalAction ?? null,
      locked: c.locked ?? false,
      callbackAttempts: Array.isArray(c.callbackAttempts) ? c.callbackAttempts : [],
      retryCount: c.retryCount ?? 0,
      nextRetryAt: c.nextRetryAt ?? null,
    }));
  } catch {
    return [];
  }
}

function write(list: QueuedCall[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  bus.dispatchEvent(new Event("change"));
}

export const queueStore = {
  list(): QueuedCall[] {
    return read();
  },
  get(id: string) {
    return read().find((c) => c.id === id) ?? null;
  },
  upsert(call: QueuedCall) {
    const list = read();
    const i = list.findIndex((c) => c.id === call.id);
    if (i === -1) list.unshift(call);
    else list[i] = call;
    write(list);
  },
  update(id: string, patch: Partial<QueuedCall>) {
    const list = read().map((c) => {
      if (c.id !== id) return c;
      if (c.locked) return c; // immutable after resolution
      return { ...c, ...patch };
    });
    write(list);
  },
  addEvent(id: string, ev: Omit<CaseEvent, "ts"> & { ts?: string }) {
    const list = read().map((c) => {
      if (c.id !== id) return c;
      if (c.locked) return c;
      const e: CaseEvent = { ts: ev.ts ?? new Date().toISOString(), kind: ev.kind, text: ev.text };
      return { ...c, events: [...c.events, e] };
    });
    write(list);
  },
  resolve(id: string, by: string, finalAction: string) {
    const list = read().map((c) => {
      if (c.id !== id) return c;
      const ev: CaseEvent = {
        ts: new Date().toISOString(),
        kind: "status",
        text: `Resolved by ${by} — ${finalAction}`,
      };
      return {
        ...c,
        status: "resolved" as CallStatus,
        resolvedAt: new Date().toISOString(),
        resolvedBy: by,
        finalAction,
        locked: true,
        events: [...c.events, ev],
      };
    });
    write(list);
  },
  remove(id: string) {
    write(read().filter((c) => c.id !== id));
  },
  subscribe(cb: () => void) {
    const local = () => cb();
    const remote = (e: StorageEvent) => {
      if (e.key === KEY) cb();
    };
    bus.addEventListener("change", local);
    window.addEventListener("storage", remote);
    return () => {
      bus.removeEventListener("change", local);
      window.removeEventListener("storage", remote);
    };
  },
};
