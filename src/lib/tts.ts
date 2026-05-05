// TTS engine — interruptible. Always cancels before speaking.
export type TTSLang = "en-IN" | "hi-IN" | "kn-IN";

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function cancelSpeech() {
  try {
    window.speechSynthesis.cancel();
  } catch {}
  currentUtterance = null;
}

export function pickVoice(lang: TTSLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.startsWith(lang.split("-")[0])) ||
    voices.find((v) => v.lang.startsWith("en"))
  );
}

export function speak(
  text: string,
  lang: TTSLang,
  opts?: { onStart?: () => void; onEnd?: () => void; onError?: () => void },
) {
  if (!text?.trim()) return;
  // CRITICAL: always cancel before speaking
  cancelSpeech();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1.05;
  u.pitch = 1;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.onstart = () => opts?.onStart?.();
  u.onend = () => {
    if (currentUtterance === u) currentUtterance = null;
    opts?.onEnd?.();
  };
  u.onerror = () => {
    if (currentUtterance === u) currentUtterance = null;
    opts?.onError?.();
  };
  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function isSpeaking() {
  return window.speechSynthesis.speaking;
}

// Pre-load voices (Chrome lazy loads)
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
