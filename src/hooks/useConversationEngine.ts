import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cancelSpeech, isSpeaking, speak, TTSLang } from "@/lib/tts";
import { queueStore } from "@/lib/queueStore";

export type Sentiment = "calm" | "distress" | "panic";
export type Priority = "low" | "medium" | "critical";

export interface Analysis {
  intent: string;
  incident_type: string;
  location: string;
  sentiment: Sentiment;
  confidence_score: number;
  priority: Priority;
  summary: string;
  ack_phrase: string;
}

export interface Turn {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  ts: number;
  analysis?: Analysis;
}

export type CallState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "verifying"
  | "escalated";

export type Verification = "correct" | "partial" | "incorrect";

const SILENCE_MS = 900;

export function useConversationEngine(initialLang: TTSLang = "en-IN") {
  const [language, setLanguage] = useState<TTSLang>(initialLang);
  const [callState, setCallState] = useState<CallState>("idle");
  const [liveTranscript, setLiveTranscript] = useState(""); // interim
  const [stableTranscript, setStableTranscript] = useState(""); // last final segment pending NLP
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingAnalysis, setPendingAnalysis] = useState<Analysis | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Counters for escalation rules
  const incorrectCountRef = useRef(0);
  const partialCountRef = useRef(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const finalBufferRef = useRef("");
  const interimBufferRef = useRef("");
  const isSpeakingRef = useRef(false);
  const processingRef = useRef(false);
  const languageRef = useRef<TTSLang>(initialLang);
  const callStateRef = useRef<CallState>("idle");
  const escalatedRef = useRef(false);
  const wantListeningRef = useRef(false);

  useEffect(() => {
    languageRef.current = language;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = language;
      } catch {}
    }
  }, [language]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const pushTurn = useCallback((t: Omit<Turn, "id" | "ts">) => {
    setTurns((prev) => [
      ...prev,
      { ...t, id: crypto.randomUUID(), ts: Date.now() },
    ]);
  }, []);

  // ----- Escalation -----
  const escalate = useCallback(
    (reason: string, analysis?: Analysis | null) => {
      if (escalatedRef.current) return;
      escalatedRef.current = true;
      setEscalated(true);
      setCallState("escalated");
      cancelSpeech();
      try {
        recognitionRef.current?.stop();
      } catch {}
      wantListeningRef.current = false;
      const payload = {
        reason,
        transcript: turns
          .map((t) => `[${t.role}] ${t.text}`)
          .join("\n"),
        interpreted: analysis ?? pendingAnalysis,
        confidence: (analysis ?? pendingAnalysis)?.confidence_score ?? null,
        sentiment: (analysis ?? pendingAnalysis)?.sentiment ?? null,
        priority: (analysis ?? pendingAnalysis)?.priority ?? null,
        language: languageRef.current,
        ts: new Date().toISOString(),
      };
      pushTurn({
        role: "system",
        text: `🚨 Escalated to human agent — ${reason}`,
      });
      // Speak escalation notice
      const msg =
        languageRef.current === "hi-IN"
          ? "मैं आपको एक एजेंट से जोड़ रहा हूँ। कृपया लाइन पर बने रहें।"
          : languageRef.current === "kn-IN"
            ? "ನಾನು ನಿಮ್ಮನ್ನು ಏಜೆಂಟ್‌ಗೆ ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಲೈನ್‌ನಲ್ಲಿ ಇರಿ।"
            : "Connecting you to a human agent now. Please stay on the line.";
      speak(msg, languageRef.current);
      console.warn("[ESCALATION]", payload);
      try {
        queueStore.enqueue(payload);
      } catch (e) {
        console.error("queue enqueue failed", e);
      }
    },
    [pendingAnalysis, pushTurn, turns],
  );

  // ----- NLP call -----
  const runNLP = useCallback(
    async (transcript: string) => {
      processingRef.current = true;
      setCallState("thinking");
      pushTurn({ role: "user", text: transcript });

      try {
        const { data, error } = await supabase.functions.invoke("nlp-analyze", {
          body: { transcript, language: languageRef.current },
        });
        if (error) throw error;
        const analysis = data as Analysis;
        setPendingAnalysis(analysis);

        // Auto-escalate rules
        if (analysis.sentiment === "panic") {
          escalate("panic detected", analysis);
          return;
        }
        if (analysis.confidence_score < 30) {
          escalate("low confidence", analysis);
          return;
        }

        // Speak verification ack
        setCallState("speaking");
        const ack = analysis.ack_phrase || analysis.summary;
        pushTurn({ role: "agent", text: ack, analysis });
        isSpeakingRef.current = true;
        speak(ack, languageRef.current, {
          onEnd: () => {
            isSpeakingRef.current = false;
            if (escalatedRef.current) return;
            setCallState("verifying");
          },
          onError: () => {
            isSpeakingRef.current = false;
            setCallState("verifying");
          },
        });
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "NLP error");
        setCallState("listening");
      } finally {
        processingRef.current = false;
      }
    },
    [escalate, pushTurn],
  );

  // ----- Silence-triggered processing -----
  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = window.setTimeout(() => {
      const text = (finalBufferRef.current + " " + interimBufferRef.current)
        .replace(/\s+/g, " ")
        .trim();
      finalBufferRef.current = "";
      interimBufferRef.current = "";
      setLiveTranscript("");
      setStableTranscript(text);
      if (!text) return;
      if (escalatedRef.current) return;
      runNLP(text);
    }, SILENCE_MS);
  }, [runNLP]);

  // ----- Recognition setup -----
  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition not supported in this browser. Use Chrome.");
      return null;
    }
    const rec: SpeechRecognition = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = languageRef.current;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript + " ";
      }
      if (finalText) finalBufferRef.current += finalText;
      interimBufferRef.current = interim;
      const combined = (finalBufferRef.current + " " + interim)
        .replace(/\s+/g, " ")
        .trim();
      setLiveTranscript(combined);

      // BARGE-IN: user speaking while AI is talking
      if (combined && (isSpeakingRef.current || isSpeaking())) {
        cancelSpeech();
        isSpeakingRef.current = false;
        setCallState("listening");
      }

      armSilenceTimer();
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      // 'no-speech' is normal — don't surface
      if (ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("recognition error:", ev.error);
        setError(ev.error);
      }
    };

    rec.onend = () => {
      // Auto-restart so mic stays HOT (continuous listening)
      if (wantListeningRef.current && !escalatedRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, [armSilenceTimer]);

  // ----- Public controls -----
  const startCall = useCallback(() => {
    setError(null);
    setEscalated(false);
    escalatedRef.current = false;
    incorrectCountRef.current = 0;
    partialCountRef.current = 0;
    setTurns([]);
    setPendingAnalysis(null);
    finalBufferRef.current = "";
    interimBufferRef.current = "";
    setLiveTranscript("");
    setStableTranscript("");

    const rec = ensureRecognition();
    if (!rec) return;
    wantListeningRef.current = true;
    try {
      rec.start();
    } catch (e) {
      // already started
    }
    setCallState("listening");

    // Greeting
    const greet =
      languageRef.current === "hi-IN"
        ? "नमस्ते, यह सुरक्षा एआई आपातकालीन सेवा है। कृपया बताएं क्या हुआ है।"
        : languageRef.current === "kn-IN"
          ? "ನಮಸ್ಕಾರ, ಇದು ಸುರಕ್ಷಾ ಎಐ ತುರ್ತು ಸೇವೆ. ಏನಾಯಿತು ಎಂದು ಹೇಳಿ."
          : "Hello, this is SurakshaAI emergency line. Please tell me what happened.";
    pushTurn({ role: "agent", text: greet });
    isSpeakingRef.current = true;
    setCallState("speaking");
    speak(greet, languageRef.current, {
      onEnd: () => {
        isSpeakingRef.current = false;
        if (!escalatedRef.current) setCallState("listening");
      },
    });
  }, [ensureRecognition, pushTurn]);

  const endCall = useCallback(() => {
    wantListeningRef.current = false;
    cancelSpeech();
    try {
      recognitionRef.current?.stop();
    } catch {}
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    setCallState("idle");
  }, []);

  const submitVerification = useCallback(
    (v: Verification) => {
      if (!pendingAnalysis) return;
      cancelSpeech();
      isSpeakingRef.current = false;

      if (v === "correct") {
        incorrectCountRef.current = 0;
        partialCountRef.current = 0;
        // Confirm and continue gathering
        const msg =
          languageRef.current === "hi-IN"
            ? "धन्यवाद। मैं मदद भेज रहा हूँ। और कोई जानकारी?"
            : languageRef.current === "kn-IN"
              ? "ಧನ್ಯವಾದಗಳು. ಸಹಾಯ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ. ಇನ್ನಷ್ಟು ಮಾಹಿತಿ?"
              : "Thank you. Help is being dispatched. Any more details?";
        pushTurn({ role: "agent", text: msg });
        setCallState("speaking");
        speak(msg, languageRef.current, {
          onEnd: () => setCallState("listening"),
        });
        setPendingAnalysis(null);
        return;
      }

      if (v === "partial") {
        partialCountRef.current += 1;
        if (partialCountRef.current >= 3) {
          escalate("3 partial verifications", pendingAnalysis);
          return;
        }
        const msg =
          languageRef.current === "hi-IN"
            ? "कृपया फिर से बताएं — क्या और क्या सही नहीं था?"
            : languageRef.current === "kn-IN"
              ? "ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ — ಯಾವುದು ಸರಿಯಾಗಿಲ್ಲ?"
              : "Please clarify — what part was not right?";
        pushTurn({ role: "agent", text: msg });
        setCallState("speaking");
        speak(msg, languageRef.current, {
          onEnd: () => setCallState("listening"),
        });
        setPendingAnalysis(null);
        return;
      }

      // incorrect
      incorrectCountRef.current += 1;
      if (incorrectCountRef.current >= 2) {
        escalate("2 incorrect verifications", pendingAnalysis);
        return;
      }
      const msg =
        languageRef.current === "hi-IN"
          ? "क्षमा कीजिए, फिर से बताएं क्या हुआ है।"
          : languageRef.current === "kn-IN"
            ? "ಕ್ಷಮಿಸಿ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ ಏನಾಯಿತು ಎಂದು."
            : "I'm sorry, please tell me again what happened.";
      pushTurn({ role: "agent", text: msg });
      setCallState("speaking");
      speak(msg, languageRef.current, {
        onEnd: () => setCallState("listening"),
      });
      setPendingAnalysis(null);
    },
    [escalate, pendingAnalysis, pushTurn],
  );

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      cancelSpeech();
      try {
        recognitionRef.current?.stop();
      } catch {}
      if (silenceTimerRef.current)
        window.clearTimeout(silenceTimerRef.current);
    };
  }, []);

  return {
    language,
    setLanguage,
    callState,
    liveTranscript,
    stableTranscript,
    turns,
    pendingAnalysis,
    escalated,
    error,
    startCall,
    endCall,
    submitVerification,
  };
}
