import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { queueStore, QueuedCall, CallStatus } from "@/lib/queueStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  LogOut,
  CheckCircle2,
  XCircle,
  Pencil,
  Headphones,
  Send,
  Flame,
  Phone,
} from "lucide-react";
import { Link } from "react-router-dom";

const DEPTS = ["Police", "Fire", "Medical", "Disaster Response", "Cyber Crime"];

const priorityClass = (p: string | null | undefined) => {
  if (p === "critical") return "bg-status-critical text-white";
  if (p === "medium") return "bg-status-warn text-black";
  if (p === "low") return "bg-status-ok text-white";
  return "bg-muted text-muted-foreground";
};

const statusClass = (s: CallStatus) =>
  ({
    queued: "bg-muted text-foreground",
    in_progress: "bg-status-warn text-black",
    resolved: "bg-status-ok text-white",
    rejected: "bg-muted text-muted-foreground",
    taken_over: "bg-status-info text-white",
    routed: "bg-status-info text-white",
    critical: "bg-status-critical text-white",
  })[s];

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [calls, setCalls] = useState<QueuedCall[]>(queueStore.list());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    return queueStore.subscribe(() => setCalls(queueStore.list()));
  }, []);

  const selected = useMemo(
    () => calls.find((c) => c.id === selectedId) ?? calls[0] ?? null,
    [calls, selectedId],
  );

  useEffect(() => {
    if (selected && editing) {
      setEditText(JSON.stringify(selected.interpreted, null, 2));
    }
  }, [selected, editing]);

  const update = (patch: Partial<QueuedCall>) => {
    if (!selected) return;
    queueStore.update(selected.id, { ...patch, assignedTo: user });
  };

  const counts = useMemo(() => {
    return {
      queued: calls.filter((c) => c.status === "queued").length,
      active: calls.filter((c) =>
        ["in_progress", "taken_over", "routed", "critical"].includes(c.status),
      ).length,
      resolved: calls.filter((c) => c.status === "resolved").length,
    };
  }, [calls]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-destructive/15 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none">
                SurakshaAI · Agent Console
              </h1>
              <p className="text-xs text-muted-foreground">
                Government Emergency Response System
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="outline" size="sm" className="gap-1">
                <Phone className="h-4 w-4" /> Caller view
              </Button>
            </Link>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Signed in</div>
              <div className="text-sm font-medium">{user}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
        <div className="container flex gap-2 pb-3 text-xs">
          <span className="rounded bg-muted px-2 py-1">
            Queued: <b>{counts.queued}</b>
          </span>
          <span className="rounded bg-status-warn/30 px-2 py-1">
            Active: <b>{counts.active}</b>
          </span>
          <span className="rounded bg-status-ok/30 px-2 py-1">
            Resolved: <b>{counts.resolved}</b>
          </span>
        </div>
      </header>

      <main className="container grid gap-4 py-4 lg:grid-cols-[340px,1fr]">
        {/* Queue */}
        <aside className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live Call Queue
          </div>
          <div className="max-h-[75vh] overflow-y-auto divide-y divide-border">
            {calls.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No active calls. Escalations from the caller view will appear
                here in real time.
              </p>
            )}
            {calls.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-3 hover:bg-muted/40 transition ${
                  selected?.id === c.id ? "bg-muted/60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${priorityClass(c.priority)}`}
                  >
                    {c.priority ?? "n/a"}
                  </span>
                  <span
                    className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${statusClass(c.status)}`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium truncate">
                  {c.interpreted?.summary ||
                    c.interpreted?.intent ||
                    c.reason ||
                    "Emergency call"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.interpreted?.location || "unknown location"} ·{" "}
                  {c.language}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(c.ts).toLocaleTimeString()}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Detail */}
        <section className="space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Select a call from the queue.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={priorityClass(selected.priority)}>
                    {selected.priority?.toUpperCase() ?? "—"}
                  </Badge>
                  <Badge className={statusClass(selected.status)}>
                    {selected.status}
                  </Badge>
                  <Badge variant="outline">
                    Sentiment: {selected.sentiment ?? "—"}
                  </Badge>
                  <Badge variant="outline">
                    Confidence:{" "}
                    {selected.confidence != null
                      ? `${Math.round(selected.confidence)}%`
                      : "—"}
                  </Badge>
                  <Badge variant="outline">Lang: {selected.language}</Badge>
                  {selected.department && (
                    <Badge variant="outline">→ {selected.department}</Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(selected.ts).toLocaleString()}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-1 bg-status-ok text-white hover:bg-status-ok/90"
                    onClick={() => update({ status: "resolved" })}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => update({ status: "rejected" })}
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1"
                    onClick={() => setEditing((e) => !e)}
                  >
                    <Pencil className="h-4 w-4" />
                    {editing ? "Cancel edit" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 bg-status-info text-white hover:bg-status-info/90"
                    onClick={() => update({ status: "taken_over" })}
                  >
                    <Headphones className="h-4 w-4" /> Take Over
                  </Button>
                  <div className="flex items-center gap-1">
                    <Select
                      onValueChange={(v) =>
                        update({ status: "routed", department: v })
                      }
                    >
                      <SelectTrigger className="h-9 w-[170px] gap-1">
                        <Send className="h-4 w-4" />
                        <SelectValue placeholder="Route to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEPTS.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1 bg-status-critical text-white hover:bg-status-critical/90"
                    onClick={() =>
                      update({ status: "critical", priority: "critical" })
                    }
                  >
                    <Flame className="h-4 w-4" /> Escalate
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Transcript
                  </h3>
                  <pre className="text-xs whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto">
                    {selected.transcript || "—"}
                  </pre>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    AI Interpretation
                  </h3>
                  {editing ? (
                    <>
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={12}
                        className="font-mono text-xs"
                      />
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            try {
                              const parsed = JSON.parse(editText);
                              update({ interpreted: parsed });
                              setEditing(false);
                            } catch {
                              alert("Invalid JSON");
                            }
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto">
                      {JSON.stringify(selected.interpreted, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
