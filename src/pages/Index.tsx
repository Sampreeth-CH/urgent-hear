import { useEffect, useRef, useState } from "react";
import { useConversationEngine } from "@/hooks/useConversationEngine";
import { TTSLang } from "@/lib/tts";
import { CallerInfo } from "@/lib/queueStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Mic, MicOff, PhoneOff, Phone, AlertTriangle, LayoutDashboard,
  MapPin, Loader2, ShieldCheck, Volume2,
} from "lucide-react";
import { Link } from "react-router-dom";

const LANGS: { code: TTSLang; label: string }[] = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
];

function detectBrowserLang(): TTSLang {
  const l = (navigator.language || "en-IN").toLowerCase();
  if (l.startsWith("hi")) return "hi-IN";
  if (l.startsWith("kn")) return "kn-IN";
  return "en-IN";
}

const Index = () => {
  const detected = detectBrowserLang();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<TTSLang>(detected);
  const [gps, setGps] = useState<CallerInfo["gps"]>(null);
  const [gpsState, setGpsState] = useState<"idle"|"requesting"|"granted"|"denied">("idle");
  const [micState, setMicState] = useState<"idle"|"requesting"|"granted"|"denied">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    callState, liveTranscript, turns, latestTriage,
    escalated, muted, error, caseId, caller,
    startCall, endCall, toggleMute,
  } = useConversationEngine(detected);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, liveTranscript]);

  const inCall = callState !== "idle";

  const requestGps = () => {
    if (!("geolocation" in navigator)) { setGpsState("denied"); return; }
    setGpsState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsState("granted");
      },
      () => setGpsState("denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const requestMic = async () => {
    setMicState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
    } catch {
      setMicState("denied");
    }
  };

  const handleStart = () => {
    setFormError(null);
    if (!name.trim() || !phone.trim()) {
      setFormError("Name and phone are required.");
      return;
    }
    if (micState !== "granted") {
      setFormError("Microphone permission is required for voice support.");
      return;
    }
    const info: CallerInfo = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      gps: gps ?? null,
      language: lang,
    };
    startCall(info);
  };

  const stateLabel: Record<string, string> = {
    idle: "Idle", listening: "Listening", thinking: "Processing",
    speaking: "AI Speaking", muted: "Mic Muted", escalated: "Escalated", resolved: "Resolved",
  };
  const stateColor: Record<string, string> = {
    listening: "bg-emerald-500", thinking: "bg-amber-500", speaking: "bg-sky-500",
    muted: "bg-muted-foreground", escalated: "bg-destructive", resolved: "bg-status-ok",
    idle: "bg-muted-foreground",
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">SurakshaAI</h1>
              <p className="text-xs text-muted-foreground">Government Emergency Voice Line</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${stateColor[callState]}`} />
              <span className="text-sm text-muted-foreground">{stateLabel[callState]}</span>
            </span>
            <Link to="/dashboard">
              <Button variant="outline" size="sm" className="gap-1">
                <LayoutDashboard className="h-4 w-4" /> Agent Console
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container grid gap-6 py-6 lg:grid-cols-[1fr,340px]">
        <section className="flex flex-col gap-4">
          {!inCall ? (
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-status-ok" />
                <h2 className="text-sm font-semibold">Caller information</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Your information is securely used only for emergency handling.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="n">Full name *</Label>
                  <Input id="n" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohan Kumar" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="p">Phone number *</Label>
                  <Input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="e">Email (optional)</Label>
                  <Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Language:</span>
                {LANGS.map((l) => (
                  <Button key={l.code} size="sm"
                    variant={lang === l.code ? "default" : "outline"}
                    onClick={() => setLang(l.code)}>
                    {l.label}
                  </Button>
                ))}
                <span className="ml-2 text-[11px] text-muted-foreground">
                  Auto-detected: {detected}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" size="sm" onClick={requestMic} className="justify-start gap-2">
                  {micState === "requesting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  Microphone:&nbsp;
                  <span className={micState === "granted" ? "text-status-ok" : micState === "denied" ? "text-destructive" : ""}>
                    {micState}
                  </span>
                </Button>
                <Button variant="outline" size="sm" onClick={requestGps} className="justify-start gap-2">
                  {gpsState === "requesting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  Location:&nbsp;
                  <span className={gpsState === "granted" ? "text-status-ok" : gpsState === "denied" ? "text-destructive" : ""}>
                    {gpsState}
                  </span>
                </Button>
              </div>
              {gps && (
                <p className="text-xs text-status-ok">
                  📍 Location detected for emergency assistance ({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
                </p>
              )}
              {gpsState === "denied" && (
                <p className="text-xs text-muted-foreground">
                  GPS denied — the agent will ask for your location during the call.
                </p>
              )}

              {formError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {formError}
                </div>
              )}

              <Button onClick={handleStart} className="w-full gap-2 bg-status-critical text-white hover:bg-status-critical/90">
                <Phone className="h-4 w-4" /> Start Emergency Call
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
              <Badge variant="outline" className="font-mono text-[10px]">
                Case #{caseId?.slice(0, 8)}
              </Badge>
              <Badge variant="outline">{caller?.name}</Badge>
              <Badge variant="outline">{caller?.phone}</Badge>
              {caller?.gps && <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" /> GPS</Badge>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant={muted ? "default" : "outline"} onClick={toggleMute} className="gap-1">
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="destructive" onClick={endCall} className="gap-1">
                  <PhoneOff className="h-4 w-4" /> End Call
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div ref={scrollRef}
            className="flex-1 min-h-[420px] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card p-4 space-y-3">
            {turns.length === 0 && !liveTranscript && (
              <p className="text-sm text-muted-foreground">
                Live transcript will appear here. The mic stays open — speak naturally and you can interrupt the agent at any time.
              </p>
            )}
            {turns.map((t) => (
              <div key={t.id} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  t.role === "user" ? "bg-primary text-primary-foreground"
                  : t.role === "system" ? "bg-destructive/15 text-destructive border border-destructive/30"
                  : "bg-secondary text-secondary-foreground"}`}>
                  <div className="text-[10px] uppercase opacity-70 mb-0.5 flex items-center gap-2">
                    <span>{t.role === "agent" ? "AI Agent" : t.role}</span>
                    <span className="opacity-60">{new Date(t.ts).toLocaleTimeString()}</span>
                  </div>
                  {t.text}
                </div>
              </div>
            ))}
            {liveTranscript && (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary/30 text-primary-foreground italic">
                  <div className="text-[10px] uppercase opacity-70 mb-0.5">you (live)</div>
                  {liveTranscript}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
            {callState === "listening" ? <Mic className="h-5 w-5 text-emerald-500 animate-pulse" />
              : callState === "speaking" ? <Volume2 className="h-5 w-5 text-sky-500 animate-pulse" />
              : callState === "muted" ? <MicOff className="h-5 w-5 text-muted-foreground" />
              : <MicOff className="h-5 w-5 text-muted-foreground" />}
            <p className="text-sm text-muted-foreground">
              State: <b className="text-foreground">{stateLabel[callState]}</b>
              &nbsp;· Mic stays open. Speak over the agent to interrupt. Use Mute to pause.
            </p>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold mb-2">AI Triage</h2>
            {latestTriage ? (
              <div className="space-y-2 text-sm">
                <Row k="Category" v={latestTriage.category} />
                <Row k="Type" v={latestTriage.incident_type} />
                <Row k="Location" v={latestTriage.location} />
                <Row k="Sentiment" v={latestTriage.sentiment} />
                <Row k="Confidence" v={`${Math.round(latestTriage.confidence_score)}%`} />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Priority</span>
                  <Badge variant={latestTriage.priority === "critical" ? "destructive" : "secondary"}>
                    {latestTriage.priority}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Needs human</span>
                  <Badge variant={latestTriage.needs_human ? "destructive" : "outline"}>
                    {latestTriage.needs_human ? "yes" : "no"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                  {latestTriage.summary}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Awaiting first user input…</p>
            )}
          </div>

          {escalated && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <h2 className="text-sm font-semibold text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Connecting human agent
              </h2>
              <p className="mt-1 text-xs text-destructive/80">
                Full case file streamed to the agent console.
              </p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-medium truncate">{v}</span>
  </div>
);

export default Index;
