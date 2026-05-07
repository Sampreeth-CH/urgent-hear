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

export type CallState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "escalated"
  | "resolved";

const SILENCE_MS = 1000;

export function useConversationEngine(initialLang: TTSLang = "en-IN") {
  const [language, setLanguage] = useState<TTSLang>(initialLang);
  const [callState, setCallState] = useState<CallState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [latestTriage, setLatestTriage] = useState<Triage | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caller, setCaller] = useState<CallerInfo | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const finalBufferRef = useRef("");
  const interimBufferRef = useRef("");
  const isSpeakingRef = useRef(false);
  const processingRef = useRef(false);
  const languageRef = useRef<TTSLang>(initialLang);
  const escalatedRef = useRef(false);
  const wantListeningRef = useRef(false);
  const mutedRef = useRef(false);
  const caseIdRef = useRef<string | null>(null);
  const callerRef = useRef<CallerInfo | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const lowConfStreakRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const noResponseStageRef = useRef(0); // 0,1,2 -> ask, then mark pending
  const lastSentimentRef = useRef<Sentiment | null>(null);

  useEffect(() => {
    languageRef.current = language;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = language;
      } catch {}
    }
  }, [language]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const pushTurn = useCallback((t: Omit<Turn, "id" | "ts">) => {
    setTurns((prev) => [
      ...prev,
      { ...t, id: crypto.randomUUID(), ts: Date.now() },
    ]);
  }, []);

  // Persist case to dashboard queue
  const persistCase = useCallback(
    (patch: Partial<QueuedCall>) => {
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
    },
    [],
  );

  const addEvent = useCallback(
    (kind: "user" | "agent_ai" | "agent_human" | "system" | "escalation" | "status", text: string) => {
      if (!caseIdRef.current) return;
      // ensure case exists
      if (!queueStore.get(caseIdRef.current)) persistCase({});
      queueStore.addEvent(caseIdRef.current, { kind, text });
    },
    [persistCase],
  );

  // ----- Idle / no-response loop -----
  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const speakLine = useCallback((text: string) => {
    cancelSpeech();
    isSpeakingRef.current = true;
    setCallState("speaking");
    pushTurn({ role: "agent", text });
    addEvent("agent_ai", text);
    speak(text, languageRef.current, {
      onEnd: () => {
        isSpeakingRef.current = false;
        if (escalatedRef.current) return;
        setCallState(mutedRef.current ? "muted" : "listening");
        armIdleTimer();
      },
      onError: () => {
        isSpeakingRef.current = false;
        setCallState(mutedRef.current ? "muted" : "listening");
      },
    });
  }, [pushTurn, addEvent]);

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    if (escalatedRef.current || mutedRef.current) return;
    // Slow down on emotional distress
    const base = lastSentimentRef.current === "distress" ? 18000 : 12000;
    idleTimerRef.current = window.setTimeout(() => {
      if (escalatedRef.current || mutedRef.current || isSpeakingRef.current) return;
      const stage = noResponseStageRef.current;
      const lang = languageRef.current;
      if (stage === 0) {
        const msg = lang === "hi-IN" ? "क्या आप अभी भी लाइन पर हैं?"
          : lang === "kn-IN" ? "ನೀವು ಇನ್ನೂ ಲೈನ್‌ನಲ್ಲಿ ಇದ್ದೀರಾ?"
          : "Are you still there?";
        noResponseStageRef.current = 1;
        speakLine(msg);
      } else if (stage === 1) {
        const msg = lang === "hi-IN" ? "मुझे आपकी आवाज़ साफ़ नहीं सुनाई दे रही।"
          : lang === "kn-IN" ? "ನಿಮ್ಮ ಧ್ವನಿ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸುತ್ತಿಲ್ಲ."
          : "I'm unable to hear you clearly.";
        noResponseStageRef.current = 2;
        speakLine(msg);
      } else {
        // mark pending response, stop prompting
        addEvent("system", "No caller response — marked pending");
        persistCase({ status: "pending_response" });
        pushTurn({ role: "system", text: "No response detected — case marked Pending Response." });
      }
    }, base);
  }, [speakLine, addEvent, persistCase, pushTurn]);

  // ----- Escalation (natural, silent hand-off) -----
  const escalate = useCallback(
    (reason: string, triage?: Triage | null) => {
      if (escalatedRef.current) return;
      escalatedRef.current = true;
      setEscalated(true);
      setCallState("escalated");
      cancelSpeech();
      clearIdleTimer();
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
      speak(msg, languageRef.current, {
        onEnd: () => { isSpeakingRef.current = false; },
      });
    },
    [latestTriage, persistCase, addEvent, pushTurn],
  );

  // ----- NLP / Triage call -----
  const runTriage = useCallback(
    async (transcript: string) => {
      processingRef.current = true;
      noResponseStageRef.current = 0;
      clearIdleTimer();
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
        lastSentimentRef.current = triage.sentiment;

        persistCase({
          interpreted: triage,
          confidence: triage.confidence_score,
          sentiment: triage.sentiment,
          priority: triage.priority,
          category: triage.category,
          suggestedAction: triage.suggested_action,
          status: triage.needs_human ? "escalated" : (triage.resolved_by_ai ? "ai_resolving" : "in_progress"),
        });

        // Speak short reply FIRST (natural turn) — escalation happens silently in parallel
        const reply = triage.assistant_reply?.trim() || triage.summary;
        setCallState("speaking");
        pushTurn({ role: "agent", text: reply, triage });
        addEvent("agent_ai", reply);
        isSpeakingRef.current = true;
        speak(reply, languageRef.current, {
          onEnd: () => {
            isSpeakingRef.current = false;
            if (escalatedRef.current) return;
            setCallState(mutedRef.current ? "muted" : "listening");
            armIdleTimer();
          },
          onError: () => {
            isSpeakingRef.current = false;
            setCallState(mutedRef.current ? "muted" : "listening");
          },
        });

        // Silent escalation triggers (data sent to dashboard immediately; spoken hand-off is brief & natural)
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
        setCallState(mutedRef.current ? "muted" : "listening");
      } finally {
        processingRef.current = false;
      }
    },
    [escalate, persistCase, addEvent, pushTurn, armIdleTimer],
  );

  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      const text = (finalBufferRef.current + " " + interimBufferRef.current)
        .replace(/\s+/g, " ")
        .trim();
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      setLiveTranscript("");
      if (!text) return;
      if (escalatedRef.current) return;
      runTriage(text);
    }, SILENCE_MS);
  }, [runTriage]);

  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
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

      if (combined && (isSpeakingRef.current || isSpeaking())) {
        cancelSpeech();
        isSpeakingRef.current = false;
        setCallState("listening");
      }
      armSilenceTimer();
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("recognition error:", ev.error);
        setError(ev.error);
      }
    };

    rec.onend = () => {
      if (wantListeningRef.current && !escalatedRef.current && !mutedRef.current) {
        try { rec.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, [armSilenceTimer]);

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
      setMuted(false);
      mutedRef.current = false;

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

      // Create case
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

      const rec = ensureRecognition();
      if (!rec) return;
      wantListeningRef.current = true;
      try { rec.start(); } catch {}
      setCallState("listening");

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
          ? " यह कॉल लगातार सुनती रहती है। जब मैं बोल रहा हूँ, तब आप म्यूट दबा सकते हैं, और जवाब देने के लिए अनम्यूट कर लें।"
          : lang === "kn-IN"
            ? " ಈ ಕರೆ ನಿರಂತರವಾಗಿ ಆಲಿಸುತ್ತದೆ. ನಾನು ಮಾತನಾಡುವಾಗ ಮ್ಯೂಟ್ ಒತ್ತಿ, ಪ್ರತಿಕ್ರಿಯಿಸಲು ಅನ್‌ಮ್ಯೂಟ್ ಮಾಡಿ."
            : " This line listens continuously — if my voice overlaps yours, just tap mute while I speak, then unmute to reply.";
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
          if (!escalatedRef.current) {
            setCallState(mutedRef.current ? "muted" : "listening");
            armIdleTimer();
          }
        },
      });
    },
    [ensureRecognition, pushTurn, addEvent, armIdleTimer],
  );

  const endCall = useCallback(() => {
    wantListeningRef.current = false;
    cancelSpeech();
    try { recognitionRef.current?.stop(); } catch {}
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    clearIdleTimer();
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

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    clearIdleTimer();
    if (next) {
      // Speak ONE calm acknowledgement, then go silent
      const lang = languageRef.current;
      const msg = lang === "hi-IN"
        ? "आपका माइक्रोफ़ोन म्यूट है। तैयार होने पर अनम्यूट करें।"
        : lang === "kn-IN"
          ? "ನಿಮ್ಮ ಮೈಕ್ ಮ್ಯೂಟ್ ಆಗಿದೆ. ಸಿದ್ಧವಾದಾಗ ಅನ್‌ಮ್ಯೂಟ್ ಮಾಡಿ."
          : "Your microphone is muted. Unmute whenever you're ready to continue.";
      addEvent("system", "Caller muted microphone");
      pushTurn({ role: "system", text: "🎤 Mic muted" });
      isSpeakingRef.current = true;
      setCallState("speaking");
      speak(msg, lang, {
        onEnd: () => {
          isSpeakingRef.current = false;
          try { recognitionRef.current?.stop(); } catch {}
          setCallState("muted");
        },
        onError: () => {
          isSpeakingRef.current = false;
          try { recognitionRef.current?.stop(); } catch {}
          setCallState("muted");
        },
      });
    } else {
      const rec = ensureRecognition();
      if (rec) {
        try { rec.start(); } catch {}
      }
      setCallState("listening");
      addEvent("system", "Caller unmuted microphone");
      pushTurn({ role: "system", text: "🎤 Listening resumed" });
      armIdleTimer();
    }
  }, [ensureRecognition, addEvent, pushTurn, armIdleTimer]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      cancelSpeech();
      try { recognitionRef.current?.stop(); } catch {}
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
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
