import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cancelSpeech, isSpeaking, speak, TTSLang } from "@/lib/tts";
import { queueStore, CallerInfo, QueuedCall, CallStatus } from "@/lib/queueStore";

export type Sentiment = "calm" | "distress" | "panic";
export type Priority = "low" | "medium" | "critical";

export interface Triage {
  intent: string;
  incident_type: string;
  category: string;
  location: string;
  sentiment: Sentiment;
  confidence_score: number;
  priority: Priority;
  summary: string;
  assistant_reply: string;
  suggested_action: string;
  needs_human: boolean;
  resolved_by_ai: boolean;
}

export interface Turn {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  ts: number;
  triage?: Triage;
}

// User-controlled turn-taking states:
// idle      → no call
// speaking  → AI is talking (user should remain muted)
// listening → AI finished, waiting for user to UNMUTE
// user_speaking → user unmuted, capturing speech
// thinking  → user muted with buffered text → processing
// muted     → manually muted with no pending input
// escalated / resolved → terminal-ish
export type CallState =
  | "idle"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "speaking"
  | "muted"
  | "escalated"
  | "resolved";

export function useConversationEngine(initialLang: TTSLang = "en-IN") {
  const [language, setLanguage] = useState<TTSLang>(initialLang);
  const [callState, setCallState] = useState<CallState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [latestTriage, setLatestTriage] = useState<Triage | null>(null);
  const [escalated, setEscalated] = useState(false);
  // muted = true means mic is OFF. Default ON until user unmutes.
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caller, setCaller] = useState<CallerInfo | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalBufferRef = useRef("");
  const interimBufferRef = useRef("");
  const isSpeakingRef = useRef(false);
  const processingRef = useRef(false);
  const languageRef = useRef<TTSLang>(initialLang);
  const escalatedRef = useRef(false);
  const wantListeningRef = useRef(false);
  const mutedRef = useRef(true);
  const caseIdRef = useRef<string | null>(null);
  const callerRef = useRef<CallerInfo | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const lowConfStreakRef = useRef(0);

  useEffect(() => {
    languageRef.current = language;
    if (recognitionRef.current) {
      try { recognitionRef.current.lang = language; } catch {}
    }
  }, [language]);

  useEffect(() => { turnsRef.current = turns; }, [turns]);

  const pushTurn = useCallback((t: Omit<Turn, "id" | "ts">) => {
    setTurns((prev) => [...prev, { ...t, id: crypto.randomUUID(), ts: Date.now() }]);
  }, []);

  const persistCase = useCallback((patch: Partial<QueuedCall>) => {
    const id = caseIdRef.current;
    if (!id) return;
    const existing = queueStore.get(id);
    const transcript = turnsRef.current
      .map((t) => `[${new Date(t.ts).toLocaleTimeString()}] ${t.role}: ${t.text}`)
      .join("\n");
    const base: QueuedCall = existing ?? {
      id,
      ts: new Date().toISOString(),
      reason: "incoming",
      transcript: "",
      events: [],
      interpreted: null,
      confidence: null,
      sentiment: null,
      priority: null,
      category: null,
      suggestedAction: null,
      language: languageRef.current,
      status: "queued",
      caller: callerRef.current,
    };
    queueStore.upsert({ ...base, transcript, caller: callerRef.current, ...patch });
  }, []);

  const addEvent = useCallback(
    (kind: "user" | "agent_ai" | "agent_human" | "system" | "escalation" | "status", text: string) => {
      if (!caseIdRef.current) return;
      if (!queueStore.get(caseIdRef.current)) persistCase({});
      queueStore.addEvent(caseIdRef.current, { kind, text });
    },
    [persistCase],
  );

  // ----- Escalation -----
  const escalate = useCallback(
    (reason: string, triage?: Triage | null) => {
      if (escalatedRef.current) return;
      escalatedRef.current = true;
      setEscalated(true);
      setCallState("escalated");
      cancelSpeech();
      const t = triage ?? latestTriage;
      const isCritical = t?.priority === "critical" || t?.sentiment === "panic";
      persistCase({
        status: "escalated",
        reason,
        interpreted: t,
        confidence: t?.confidence_score ?? null,
        sentiment: t?.sentiment ?? null,
        priority: t?.priority ?? null,
        category: t?.category ?? null,
        suggestedAction: t?.suggested_action ?? null,
        language: languageRef.current,
      });
      addEvent("escalation", `Silent hand-off to agent console — ${reason}`);
      pushTurn({ role: "system", text: `Case forwarded to support officer — ${reason}` });
      const lang = languageRef.current;
      const msg = isCritical
        ? (lang === "hi-IN" ? "मैं इसे अभी अधिकारी को भेज रहा हूँ। लाइन पर बने रहें।"
            : lang === "kn-IN" ? "ಇದನ್ನು ಈಗಲೇ ಅಧಿಕಾರಿಗೆ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ. ಲೈನ್‌ನಲ್ಲಿ ಇರಿ."
            : "I'm forwarding this to an emergency officer now. Please stay on the line.")
        : (lang === "hi-IN" ? "मैं यह आपातकालीन सहायता अधिकारी को भेज रहा हूँ।"
            : lang === "kn-IN" ? "ನಾನು ಇದನ್ನು ತುರ್ತು ಸಹಾಯ ಅಧಿಕಾರಿಗೆ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ."
            : "I'm forwarding this to an emergency support officer. They may contact you shortly.");
      isSpeakingRef.current = true;
      speak(msg, languageRef.current, { onEnd: () => { isSpeakingRef.current = false; } });
    },
    [latestTriage, persistCase, addEvent, pushTurn],
  );

  // ----- NLP / Triage -----
  const runTriage = useCallback(
    async (transcript: string) => {
      processingRef.current = true;
      setCallState("thinking");
      pushTurn({ role: "user", text: transcript });
      addEvent("user", transcript);

      try {
        const history = turnsRef.current
          .slice(-6)
          .map((t) => `${t.role}: ${t.text}`)
          .join("\n");
        const { data, error } = await supabase.functions.invoke("nlp-analyze", {
          body: {
            transcript,
            language: languageRef.current,
            history,
            caller: callerRef.current,
          },
        });
        if (error) throw error;
        const triage = data as Triage;
        setLatestTriage(triage);

        persistCase({
          interpreted: triage,
          confidence: triage.confidence_score,
          sentiment: triage.sentiment,
          priority: triage.priority,
          category: triage.category,
          suggestedAction: triage.suggested_action,
          status: triage.needs_human ? "escalated" : (triage.resolved_by_ai ? "ai_resolving" : "in_progress"),
        });

        const reply = triage.assistant_reply?.trim() || triage.summary;
        setCallState("speaking");
        pushTurn({ role: "agent", text: reply, triage });
        addEvent("agent_ai", reply);
        isSpeakingRef.current = true;
        speak(reply, languageRef.current, {
          onEnd: () => {
            isSpeakingRef.current = false;
            if (escalatedRef.current) return;
            // Turn handed back to user — wait for them to UNMUTE.
            setCallState("listening");
          },
          onError: () => {
            isSpeakingRef.current = false;
            setCallState("listening");
          },
        });

        if (triage.sentiment === "panic") return escalate("panic detected", triage);
        if (triage.priority === "critical" && triage.needs_human) return escalate("critical incident", triage);
        if (triage.needs_human) return escalate("AI requested human", triage);
        if (triage.confidence_score < 40) {
          lowConfStreakRef.current += 1;
          if (lowConfStreakRef.current >= 2) return escalate("low confidence repeated", triage);
        } else {
          lowConfStreakRef.current = 0;
        }
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "NLP error");
        setCallState("listening");
      } finally {
        processingRef.current = false;
      }
    },
    [escalate, persistCase, addEvent, pushTurn],
  );

  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition not supported. Please use Chrome.");
      return null;
    }
    const rec: SpeechRecognition = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = languageRef.current;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      if (mutedRef.current) return;
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript + " ";
      }
      if (finalText) finalBufferRef.current += finalText;
      interimBufferRef.current = interim;
      const combined = (finalBufferRef.current + " " + interim).replace(/\s+/g, " ").trim();
      setLiveTranscript(combined);
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("recognition error:", ev.error);
        setError(ev.error);
      }
    };

    rec.onend = () => {
      // Restart only if user is actively unmuted.
      if (wantListeningRef.current && !escalatedRef.current && !mutedRef.current) {
        try { rec.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, []);

  // ----- Public controls -----
  const startCall = useCallback(
    (info: CallerInfo) => {
      setError(null);
      setEscalated(false);
      escalatedRef.current = false;
      lowConfStreakRef.current = 0;
      setTurns([]);
      setLatestTriage(null);
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      setLiveTranscript("");
      setMuted(true);
      mutedRef.current = true;

      const id = crypto.randomUUID();
      caseIdRef.current = id;
      setCaseId(id);
      callerRef.current = info;
      setCaller(info);
      if (info.language) {
        const lang = info.language as TTSLang;
        setLanguage(lang);
        languageRef.current = lang;
      }

      queueStore.upsert({
        id,
        ts: new Date().toISOString(),
        reason: "incoming",
        transcript: "",
        events: [{ ts: new Date().toISOString(), kind: "system", text: `Call started — ${info.name}` }],
        interpreted: null,
        confidence: null,
        sentiment: null,
        priority: null,
        category: null,
        suggestedAction: null,
        language: languageRef.current,
        status: "queued",
        caller: info,
      });

      // Pre-create recognition but DO NOT start until user unmutes.
      ensureRecognition();
      wantListeningRef.current = true;

      const lang = languageRef.current;
      const hasGps = !!info.gps;
      const locLine = hasGps
        ? (lang === "hi-IN" ? " मैंने आपकी अनुमानित लोकेशन प्राप्त कर ली है।"
          : lang === "kn-IN" ? " ನಿಮ್ಮ ಸುಮಾರು ಸ್ಥಳ ಸಿಕ್ಕಿದೆ."
          : " I detected your approximate location for emergency assistance.")
        : (lang === "hi-IN" ? " कृपया अपनी लोकेशन बताइए।"
          : lang === "kn-IN" ? " ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸ್ಥಳ ತಿಳಿಸಿ."
          : " Could you please tell me your location?");
      const howto =
        lang === "hi-IN"
          ? " जब मैं बात करूँ, माइक म्यूट रखें। मेरी बात पूरी होने पर अनम्यूट करें, बोलें, और फिर म्यूट कर दें ताकि मैं जवाब दे सकूँ।"
          : lang === "kn-IN"
            ? " ನಾನು ಮಾತನಾಡುವಾಗ ಮೈಕ್ ಮ್ಯೂಟ್ ಇಡಿ. ನಾನು ಮುಗಿಸಿದ ನಂತರ ಅನ್‌ಮ್ಯೂಟ್ ಮಾಡಿ, ಮಾತನಾಡಿ, ಮತ್ತೆ ಮ್ಯೂಟ್ ಮಾಡಿ ನಾನು ಉತ್ತರಿಸಲು."
            : " Please keep your mic muted while I speak. When I finish, tap unmute, say what you need, then tap mute again so I can respond.";
      const greet =
        lang === "hi-IN"
          ? `नमस्ते ${info.name}, यह सुरक्षा एआई आपातकालीन सेवा है।${locLine}${howto} बताइए क्या हुआ है?`
          : lang === "kn-IN"
            ? `ನಮಸ್ಕಾರ ${info.name}, ಇದು ಸುರಕ್ಷಾ ಎಐ ತುರ್ತು ಸೇವೆ.${locLine}${howto} ಏನಾಯಿತು?`
            : `Hello ${info.name}, this is SurakshaAI emergency line.${locLine}${howto} Tell me what happened.`;
      pushTurn({ role: "agent", text: greet });
      addEvent("agent_ai", greet);
      isSpeakingRef.current = true;
      setCallState("speaking");
      speak(greet, languageRef.current, {
        onEnd: () => {
          isSpeakingRef.current = false;
          if (!escalatedRef.current) setCallState("listening"); // awaiting unmute
        },
      });
    },
    [ensureRecognition, pushTurn, addEvent],
  );

  const endCall = useCallback(() => {
    wantListeningRef.current = false;
    cancelSpeech();
    try { recognitionRef.current?.stop(); } catch {}
    if (caseIdRef.current) {
      addEvent("system", "Caller ended the call");
      const c = queueStore.get(caseIdRef.current);
      if (c && !c.locked && c.status !== "resolved" && c.status !== "escalated") {
        queueStore.update(caseIdRef.current, { status: "false_alarm" });
      }
    }
    setCallState("idle");
    caseIdRef.current = null;
    setCaseId(null);
    callerRef.current = null;
    setCaller(null);
  }, [addEvent]);

  // toggleMute = the user's "turn-end" / "turn-start" button.
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);

    if (next) {
      // ----- MUTING: end of user's turn -----
      try { recognitionRef.current?.stop(); } catch {}
      const text = (finalBufferRef.current + " " + interimBufferRef.current)
        .replace(/\s+/g, " ").trim();
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      setLiveTranscript("");
      addEvent("system", "Caller muted — turn complete");
      if (text && !escalatedRef.current) {
        // Process the completed user turn
        runTriage(text);
      } else {
        setCallState(isSpeakingRef.current ? "speaking" : "muted");
      }
    } else {
      // ----- UNMUTING: user is taking the turn -----
      // Cut off any AI speech immediately so there is no overlap.
      if (isSpeakingRef.current || isSpeaking()) {
        cancelSpeech();
        isSpeakingRef.current = false;
      }
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      setLiveTranscript("");
      const rec = ensureRecognition();
      if (rec) { try { rec.start(); } catch {} }
      setCallState("user_speaking");
      addEvent("system", "Caller unmuted — speaking");
    }
  }, [ensureRecognition, addEvent, runTriage]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      cancelSpeech();
      try { recognitionRef.current?.stop(); } catch {}
    };
  }, []);

  return {
    language,
    setLanguage,
    callState,
    liveTranscript,
    turns,
    latestTriage,
    escalated,
    muted,
    error,
    caseId,
    caller,
    startCall,
    endCall,
    toggleMute,
  };
}
