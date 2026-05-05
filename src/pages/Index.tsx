import { useEffect, useRef } from "react";
import {
  useConversationEngine,
  type Verification,
} from "@/hooks/useConversationEngine";
import { TTSLang } from "@/lib/tts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, PhoneOff, Phone, AlertTriangle, LayoutDashboard } from "lucide-react";
import { Link } from "react-router-dom";

const LANGS: { code: TTSLang; label: string }[] = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
];

const Index = () => {
  const {
    language,
    setLanguage,
    callState,
    liveTranscript,
    turns,
    pendingAnalysis,
    escalated,
    error,
    startCall,
    endCall,
    submitVerification,
  } = useConversationEngine("en-IN");

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, liveTranscript]);

  const inCall = callState !== "idle";
  const stateLabel: Record<string, string> = {
    idle: "Idle",
    listening: "Listening…",
    thinking: "Analyzing…",
    speaking: "Speaking",
    verifying: "Awaiting confirmation",
    escalated: "Escalated",
  };

  const stateColor: Record<string, string> = {
    listening: "bg-emerald-500",
    thinking: "bg-amber-500",
    speaking: "bg-sky-500",
    verifying: "bg-violet-500",
    escalated: "bg-destructive",
    idle: "bg-muted-foreground",
  };

  const verify = (v: Verification) => submitVerification(v);

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
              <p className="text-xs text-muted-foreground">
                Emergency voice agent
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${stateColor[callState]}`}
              />
              <span className="text-sm text-muted-foreground">
                {stateLabel[callState]}
              </span>
            </span>
            <Link to="/dashboard">
              <Button variant="outline" size="sm" className="gap-1">
                <LayoutDashboard className="h-4 w-4" /> Agent Console
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container grid gap-6 py-6 lg:grid-cols-[1fr,320px]">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">
              Language:
            </span>
            {LANGS.map((l) => (
              <Button
                key={l.code}
                variant={language === l.code ? "default" : "outline"}
                size="sm"
                disabled={inCall}
                onClick={() => setLanguage(l.code)}
              >
                {l.label}
              </Button>
            ))}
            <div className="ml-auto flex gap-2">
              {!inCall ? (
                <Button onClick={startCall} className="gap-2">
                  <Phone className="h-4 w-4" />
                  Start Call
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={endCall}
                  className="gap-2"
                >
                  <PhoneOff className="h-4 w-4" />
                  End Call
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div
            ref={scrollRef}
            className="flex-1 min-h-[420px] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card p-4 space-y-3"
          >
            {turns.length === 0 && !liveTranscript && (
              <p className="text-sm text-muted-foreground">
                Press Start Call. Speak naturally — the agent listens
                continuously and you can interrupt it any time.
              </p>
            )}
            {turns.map((t) => (
              <div
                key={t.id}
                className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    t.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : t.role === "system"
                        ? "bg-destructive/15 text-destructive border border-destructive/30"
                        : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  <div className="text-[10px] uppercase opacity-70 mb-0.5">
                    {t.role}
                  </div>
                  {t.text}
                </div>
              </div>
            ))}
            {liveTranscript && (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary/40 text-primary-foreground italic">
                  <div className="text-[10px] uppercase opacity-70 mb-0.5">
                    you (live)
                  </div>
                  {liveTranscript}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
            {callState === "listening" ? (
              <Mic className="h-5 w-5 text-emerald-500 animate-pulse" />
            ) : (
              <MicOff className="h-5 w-5 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground">
              Mic stays hot. Pause for ~1.2s to send. Speak over the agent to
              interrupt.
            </p>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold mb-2">Interpretation</h2>
            {pendingAnalysis ? (
              <div className="space-y-2 text-sm">
                <Row k="Intent" v={pendingAnalysis.intent} />
                <Row k="Type" v={pendingAnalysis.incident_type} />
                <Row k="Location" v={pendingAnalysis.location} />
                <Row k="Sentiment" v={pendingAnalysis.sentiment} />
                <Row
                  k="Confidence"
                  v={`${Math.round(pendingAnalysis.confidence_score)}%`}
                />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Priority</span>
                  <Badge
                    variant={
                      pendingAnalysis.priority === "critical"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {pendingAnalysis.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                  {pendingAnalysis.summary}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Awaiting first user input…
              </p>
            )}
          </div>

          {callState === "verifying" && pendingAnalysis && !escalated && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold">Confirm understanding</h2>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" onClick={() => verify("correct")}>
                  ✔ Correct
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => verify("partial")}
                >
                  ➖ Partial
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => verify("incorrect")}
                >
                  ❌ Incorrect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Or just keep speaking — the agent will listen again.
              </p>
            </div>
          )}

          {escalated && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <h2 className="text-sm font-semibold text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Escalated to human agent
              </h2>
              <p className="mt-1 text-xs text-destructive/80">
                Call added to agent queue with full transcript and metadata.
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
