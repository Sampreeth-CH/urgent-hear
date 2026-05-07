// Edge function: emergency triage NLP via Lovable AI Gateway.
// Returns structured triage JSON with a short spoken reply and a needs_human flag.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are SurakshaAI — an Indian government emergency triage operator.
You speak like a calm, trained 112-style call-taker, NOT a chatbot.

You will receive:
- The caller's latest transcript (may mix Kannada, Hindi, English).
- A short rolling history of the conversation so far.
- Optional caller metadata (name, phone, GPS).

Your job per turn:
1. Understand the situation.
2. Try to RESOLVE it yourself when safe (cyber-fraud guidance, basic first-aid steps, women-safety advice, calming instructions, clarifying questions).
3. Escalate to a human ONLY when truly needed.

Output rules — strict:
- assistant_reply: ONE short spoken line in the SAME language as the caller. Max 22 words. No filler, no long paragraphs. It must be either: a clarifying question, a safety instruction, a confirmation, or a hand-off line. NEVER monologue.
- needs_human: true ONLY if any of: caller explicitly asks for a human/police/ambulance/fire dispatch, panic detected, life-threatening incident, you cannot resolve, or confidence < 40.
- resolved_by_ai: true if your assistant_reply fully addresses the caller's need this turn (e.g. cyber-fraud first steps given) and no further help is required.
- category: one of [medical, police, fire, women_safety, cyber_crime, disaster, other, unknown].
- priority: low | medium | critical.
- sentiment: calm | distress | panic.
- confidence_score: 0-100 integer — your confidence in the extracted fields.
- intent: short verb phrase.
- incident_type: one of [fire, medical, accident, crime, natural_disaster, harassment, cyber, other, unknown].
- location: best-guess location string in English transliteration, or "unknown".
- summary: ONE neutral English sentence describing the situation.
- suggested_action: ONE short English line for the human agent (what to do next).

Tone of assistant_reply: calm, short, situational, emergency-focused. 2–14 words. Sound like a trained operator, not a chatbot.
GOOD examples:
"Are you safe right now?"
"I understand."
"Help is being reviewed."
"Can you describe what happened?"
"I may forward this for additional support."
"Stay where you are. I'm getting help."
BAD examples (NEVER use this style):
"Please stay online while the system escalates your request to a human emergency support representative."
"I'm sorry to hear that. As an AI assistant I will now…"
Never apologize, never explain that you are an AI, never say "system", "escalate", "request", "representative". Speak like a human operator on a 112 line.
If sentiment is distress or panic: be even shorter and softer (max 8 words).`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transcript, language, history, caller } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "transcript required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const tool = {
      type: "function",
      function: {
        name: "emit_triage",
        description: "Emit emergency triage decision",
        parameters: {
          type: "object",
          properties: {
            intent: { type: "string" },
            incident_type: {
              type: "string",
              enum: ["fire", "medical", "accident", "crime", "natural_disaster", "harassment", "cyber", "other", "unknown"],
            },
            category: {
              type: "string",
              enum: ["medical", "police", "fire", "women_safety", "cyber_crime", "disaster", "other", "unknown"],
            },
            location: { type: "string" },
            sentiment: { type: "string", enum: ["calm", "distress", "panic"] },
            confidence_score: { type: "number" },
            priority: { type: "string", enum: ["low", "medium", "critical"] },
            summary: { type: "string" },
            assistant_reply: { type: "string" },
            suggested_action: { type: "string" },
            needs_human: { type: "boolean" },
            resolved_by_ai: { type: "boolean" },
          },
          required: [
            "intent", "incident_type", "category", "location",
            "sentiment", "confidence_score", "priority", "summary",
            "assistant_reply", "suggested_action", "needs_human", "resolved_by_ai",
          ],
          additionalProperties: false,
        },
      },
    };

    const userContent = [
      `Language code: ${language || "en-IN"}`,
      caller ? `Caller: ${JSON.stringify(caller)}` : null,
      history ? `History (recent):\n${history}` : null,
      `Latest transcript: """${transcript}"""`,
    ].filter(Boolean).join("\n");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "emit_triage" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ error: "no tool call" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const args = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("nlp-analyze error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
