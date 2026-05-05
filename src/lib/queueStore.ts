// Simple in-memory + localStorage queue for emergency calls.
// Cross-tab sync via 'storage' events + same-tab via custom EventTarget.

export type CallStatus =
  | "queued"
  | "in_progress"
  | "resolved"
  | "rejected"
  | "taken_over"
  | "routed"
  | "critical";

export interface QueuedCall {
  id: string;
  ts: string;
  reason: string;
  transcript: string;
  interpreted: any | null;
  confidence: number | null;
  sentiment: "calm" | "distress" | "panic" | null;
  priority: "low" | "medium" | "critical" | null;
  language: string;
  status: CallStatus;
  assignedTo?: string | null;
  department?: string | null;
  notes?: string;
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
      interpreted: c.interpreted ?? null,
      confidence: c.confidence ?? null,
      sentiment: c.sentiment ?? null,
      priority: c.priority ?? null,
      language: c.language ?? "en-IN",
      status: c.status ?? "queued",
      assignedTo: c.assignedTo ?? null,
      department: c.department ?? null,
      notes: c.notes ?? "",
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
  enqueue(call: Omit<QueuedCall, "id" | "status"> & { id?: string }) {
    const list = read();
    list.unshift({
      ...call,
      id: call.id ?? crypto.randomUUID(),
      status: "queued",
    });
    write(list);
  },
  update(id: string, patch: Partial<QueuedCall>) {
    const list = read().map((c) => (c.id === id ? { ...c, ...patch } : c));
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
