import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { queueStore, QueuedCall, CallStatus } from "@/lib/queueStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert, LogOut, CheckCircle2, XCircle, Pencil, Headphones,
  Send, Flame, Phone, Lock, Activity, Users, Timer, AlertOctagon,
  CheckCheck, PhoneCall, CalendarClock, MailCheck, PhoneOff,
} from "lucide-react";
import { Link } from "react-router-dom";

const DEPTS = ["Police", "Fire", "Medical", "Women Safety", "Cyber Crime", "Disaster Response"];

const priorityClass = (p: string | null | undefined) => {
  if (p === "critical") return "bg-status-critical text-white";
  if (p === "medium") return "bg-status-warn text-black";
  if (p === "low") return "bg-status-ok text-white";
  return "bg-muted text-muted-foreground";
};

const statusClass = (s: CallStatus) => ({
  queued: "bg-muted text-foreground",
  ai_resolving: "bg-status-info/30 text-foreground",
  pending_verification: "bg-status-warn text-black",
  in_progress: "bg-status-warn text-black",
  escalated: "bg-status-critical text-white",
  connected: "bg-status-info text-white",
  routed: "bg-status-info text-white",
  resolved: "bg-status-ok text-white",
  rejected: "bg-muted text-muted-foreground",
  false_alarm: "bg-muted text-muted-foreground",
  critical: "bg-status-critical text-white",
  taken_over: "bg-status-info text-white",
  pending_response: "bg-status-warn text-black",
  unreachable: "bg-muted text-muted-foreground",
  retry_scheduled: "bg-status-info/40 text-foreground",
}[s] || "bg-muted text-muted-foreground");

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [calls, setCalls] = useState<QueuedCall[]>(queueStore.list());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [resolveAction, setResolveAction] = useState("");

  useEffect(() => {
    return queueStore.subscribe(() => setCalls(queueStore.list()));
  }, []);

  const selected = useMemo(
    () => calls.find((c) => c.id === selectedId) ?? calls[0] ?? null,
    [calls, selectedId],
  );

  useEffect(() => {
    if (selected && editing) setEditText(JSON.stringify(selected.interpreted, null, 2));
  }, [selected, editing]);

  const update = (patch: Partial<QueuedCall>) => {
    if (!selected || selected.locked) return;
    queueStore.update(selected.id, { ...patch, assignedTo: user });
  };

  const metrics = useMemo(() => {
    const active = calls.filter((c) => ["queued","in_progress","ai_resolving","escalated","connected","routed","critical","taken_over","pending_verification"].includes(c.status));
    const resolved = calls.filter((c) => c.status === "resolved");
    const aiResolved = resolved.filter((c) => !c.assignedTo);
    const human = calls.filter((c) => ["escalated","connected","routed","taken_over"].includes(c.status));
    const critical = calls.filter((c) => c.priority === "critical" || c.status === "critical");
    // Avg response time = case start → first human action (assignedTo set on resolve etc.)
    const responded = resolved.filter((c) => c.resolvedAt);
    const avgMs = responded.length
      ? responded.reduce((acc, c) => acc + (new Date(c.resolvedAt!).getTime() - new Date(c.ts).getTime()), 0) / responded.length
      : 0;
    return {
      active: active.length,
      aiResolved: aiResolved.length,
      escalations: human.length,
      critical: critical.length,
      avgSec: Math.round(avgMs / 1000),
    };
  }, [calls]);

  const allEvents = selected?.events ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-destructive/15 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none">SurakshaAI · Agent Console</h1>
              <p className="text-xs text-muted-foreground">Government Emergency Response System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="outline" size="sm" className="gap-1">
                <Phone className="h-4 w-4" /> Caller view
              </Button>
            </Link>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Signed in · <span className="text-status-ok">● Active</span></div>
              <div className="text-sm font-medium">{user}</div>
              <div className="text-[10px] text-muted-foreground">
                Assigned: {calls.filter((c) => c.assignedTo === user && c.status !== "resolved").length}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
        <div className="container grid grid-cols-2 md:grid-cols-5 gap-2 pb-3 text-xs">
          <Metric icon={<Activity className="h-3 w-3" />} label="Active emergencies" value={metrics.active} />
          <Metric icon={<CheckCheck className="h-3 w-3" />} label="AI resolved" value={metrics.aiResolved} tone="ok" />
          <Metric icon={<Users className="h-3 w-3" />} label="Human escalations" value={metrics.escalations} tone="info" />
          <Metric icon={<AlertOctagon className="h-3 w-3" />} label="Critical alerts" value={metrics.critical} tone="critical" />
          <Metric icon={<Timer className="h-3 w-3" />} label="Avg response" value={`${metrics.avgSec}s`} />
        </div>
      </header>

      <main className="container grid gap-4 py-4 lg:grid-cols-[340px,1fr]">
        <aside className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live Call Queue
          </div>
          <div className="max-h-[75vh] overflow-y-auto divide-y divide-border">
            {calls.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No active calls. Escalations from the caller view will appear here in real time.
              </p>
            )}
            {calls.map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-3 hover:bg-muted/40 transition ${selected?.id === c.id ? "bg-muted/60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${priorityClass(c.priority)}`}>
                    {c.priority ?? "n/a"}
                  </span>
                  <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${statusClass(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium truncate">
                  {c.caller?.name ? `${c.caller.name} — ` : ""}
                  {c.interpreted?.summary || c.interpreted?.intent || c.reason || "Emergency call"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.category ?? "uncategorized"} · {c.interpreted?.location || "unknown"} · {c.language}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(c.ts).toLocaleTimeString()}
                  {c.locked && <span className="ml-2 inline-flex items-center gap-1"><Lock className="h-3 w-3" /> locked</span>}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Select a call from the queue.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={priorityClass(selected.priority)}>{selected.priority?.toUpperCase() ?? "—"}</Badge>
                  <Badge className={statusClass(selected.status)}>{selected.status}</Badge>
                  <Badge variant="outline">Cat: {selected.category ?? "—"}</Badge>
                  <Badge variant="outline">Sent: {selected.sentiment ?? "—"}</Badge>
                  <Badge variant="outline">
                    Conf: {selected.confidence != null ? `${Math.round(selected.confidence)}%` : "—"}
                  </Badge>
                  <Badge variant="outline">Lang: {selected.language}</Badge>
                  {selected.department && <Badge variant="outline">→ {selected.department}</Badge>}
                  {selected.locked && (
                    <Badge className="bg-status-ok text-white gap-1">
                      <Lock className="h-3 w-3" /> Resolved · locked
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(selected.ts).toLocaleString()}
                  </span>
                </div>

                {/* Caller info */}
                {selected.caller && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs rounded border border-border p-2 bg-background/40">
                    <Field k="Name" v={selected.caller.name} />
                    <Field k="Phone" v={selected.caller.phone} />
                    <Field k="Email" v={selected.caller.email || "—"} />
                    <Field k="GPS" v={selected.caller.gps ? `${selected.caller.gps.lat.toFixed(4)}, ${selected.caller.gps.lng.toFixed(4)}` : "—"} />
                  </div>
                )}

                {selected.suggestedAction && (
                  <div className="mt-3 rounded border border-status-info/40 bg-status-info/10 px-3 py-2 text-xs">
                    <b>Suggested action:</b> {selected.suggestedAction}
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={selected.locked}
                    className="gap-1 bg-status-info text-white hover:bg-status-info/90"
                    onClick={() => update({ status: "connected" })}>
                    <Headphones className="h-4 w-4" /> Connect to Caller
                  </Button>
                  <Select disabled={selected.locked}
                    onValueChange={(v) => update({ status: "routed", department: v })}>
                    <SelectTrigger className="h-9 w-[180px] gap-1">
                      <Send className="h-4 w-4" /> <SelectValue placeholder="Route department…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={selected.locked}
                    className="gap-1 bg-status-critical text-white hover:bg-status-critical/90"
                    onClick={() => update({ status: "critical", priority: "critical" })}>
                    <Flame className="h-4 w-4" /> Escalate
                  </Button>
                  <Button size="sm" variant="outline" disabled={selected.locked}
                    onClick={() => update({ status: "in_progress" })}>
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={selected.locked}
                    className="gap-1" onClick={() => update({ status: "rejected" })}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" disabled={selected.locked}
                    className="gap-1" onClick={() => update({ status: "false_alarm" })}>
                    False alarm
                  </Button>
                  <Button size="sm" variant="secondary" disabled={selected.locked}
                    className="gap-1" onClick={() => setEditing((e) => !e)}>
                    <Pencil className="h-4 w-4" /> {editing ? "Cancel edit" : "Edit"}
                  </Button>
                </div>

                {/* Resolve panel */}
                {!selected.locked && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-border p-2">
                    <Input value={resolveAction} onChange={(e) => setResolveAction(e.target.value)}
                      placeholder="Final action taken (e.g. ambulance dispatched)"
                      className="h-9 flex-1 min-w-[200px]" />
                    <Button size="sm" className="gap-1 bg-status-ok text-white hover:bg-status-ok/90"
                      onClick={() => {
                        if (!user || !resolveAction.trim()) return;
                        queueStore.resolve(selected.id, user, resolveAction.trim());
                        setResolveAction("");
                      }}>
                      <Lock className="h-4 w-4" /> Mark Resolved (lock)
                    </Button>
                  </div>
                )}
                {selected.locked && (
                  <div className="mt-3 rounded border border-status-ok/40 bg-status-ok/10 p-2 text-xs">
                    <b>Resolved</b> by {selected.resolvedBy} at {new Date(selected.resolvedAt!).toLocaleString()} · final action: {selected.finalAction}
                  </div>
                )}

                {/* Callback workflow */}
                {!selected.locked && (
                  <div className="mt-3 rounded border border-border p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Callback workflow</span>
                      <span className="text-[10px] text-muted-foreground">
                        Attempts: {selected.callbackAttempts?.length ?? 0} · Retries: {selected.retryCount ?? 0}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => { if (user) { queueStore.addCallback(selected.id, { by: user, kind: "call", note: `Called ${selected.caller?.phone ?? ""}` }); queueStore.update(selected.id, { status: "connected" }); } }}>
                        <PhoneCall className="h-4 w-4" /> Call User
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => { if (user) { const at = new Date(Date.now() + 15*60*1000).toISOString(); queueStore.addCallback(selected.id, { by: user, kind: "schedule_retry", note: `Retry at ${new Date(at).toLocaleTimeString()}` }); queueStore.update(selected.id, { status: "retry_scheduled", nextRetryAt: at }); } }}>
                        <CalendarClock className="h-4 w-4" /> Schedule Retry (15m)
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => { if (user) queueStore.addCallback(selected.id, { by: user, kind: "follow_up", note: "Follow-up sent" }); }}>
                        <MailCheck className="h-4 w-4" /> Send Follow-up
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => { if (user) { queueStore.addCallback(selected.id, { by: user, kind: "unreachable" }); queueStore.update(selected.id, { status: "unreachable" }); } }}>
                        <PhoneOff className="h-4 w-4" /> Mark Unreachable
                      </Button>
                    </div>
                    {selected.nextRetryAt && (
                      <div className="text-[11px] text-muted-foreground">Next retry: {new Date(selected.nextRetryAt).toLocaleString()}</div>
                    )}
                    {(selected.callbackAttempts?.length ?? 0) > 0 && (
                      <div className="text-[11px] space-y-0.5 max-h-24 overflow-y-auto border-t border-border pt-1">
                        {selected.callbackAttempts!.slice().reverse().map((a, i) => (
                          <div key={i} className="text-muted-foreground">
                            <span className="tabular-nums">{new Date(a.ts).toLocaleTimeString()}</span> · <b className="text-foreground">{a.kind}</b> by {a.by}{a.note ? ` — ${a.note}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Live event stream</h3>
                  <div className="space-y-1 max-h-[40vh] overflow-y-auto text-xs">
                    {allEvents.length === 0 && <p className="text-muted-foreground">No events yet.</p>}
                    {allEvents.map((e, i) => (
                      <div key={i} className="flex gap-2 leading-snug">
                        <span className="text-muted-foreground tabular-nums">{new Date(e.ts).toLocaleTimeString()}</span>
                        <span className={
                          e.kind === "user" ? "text-foreground"
                          : e.kind === "agent_ai" ? "text-sky-400"
                          : e.kind === "agent_human" ? "text-status-info"
                          : e.kind === "escalation" ? "text-destructive"
                          : "text-muted-foreground"
                        }>
                          [{e.kind}]
                        </span>
                        <span className="flex-1">{e.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">AI Interpretation</h3>
                  {editing ? (
                    <>
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                        rows={12} className="font-mono text-xs" />
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => {
                          try {
                            const parsed = JSON.parse(editText);
                            update({ interpreted: parsed });
                            setEditing(false);
                          } catch { alert("Invalid JSON"); }
                        }}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
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

const Metric = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone?: "ok"|"info"|"critical" }) => (
  <div className={`rounded border px-2 py-1.5 flex items-center gap-2 ${
    tone === "ok" ? "border-status-ok/40 bg-status-ok/10"
    : tone === "info" ? "border-status-info/40 bg-status-info/10"
    : tone === "critical" ? "border-status-critical/40 bg-status-critical/10"
    : "border-border bg-muted/40"
  }`}>
    {icon}
    <span className="text-muted-foreground">{label}:</span>
    <b className="ml-auto">{value}</b>
  </div>
);

const Field = ({ k, v }: { k: string; v: string }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase text-muted-foreground">{k}</span>
    <span className="font-medium truncate">{v}</span>
  </div>
);

export default Dashboard;
