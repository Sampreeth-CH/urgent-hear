// Edge function: analyze emergency transcript via Lovable AI Gateway
// Returns structured JSON: intent, incident_type, location, sentiment, confidence_score, priority

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an emergency call-center NLP engine for an Indian helpline (SurakshaAI).
You receive a raw transcript (may mix Kannada, Hindi, English).
Extract structured data describing the emergency.

Rules:
- intent: short verb phrase ("report_fire", "request_ambulance", "report_accident", "general_query", "report_crime", "unknown")
- incident_type: one of [fire, medical, accident, crime, natural_disaster, harassment, other, unknown]
- location: best-guess location string in English transliteration, or "unknown"
- sentiment: one of [calm, distress, panic]
- confidence_score: integer 0-100 — how confident you are in extracted fields
- priority: low | medium | critical
- summary: one-sentence neutral English summary
- ack_phrase: a short empathetic spoken acknowledgment in the SAME language as the user (max 20 words) confirming what you understood, asking "Is that correct?"`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transcript, language } = await req.json();
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
        name: "emit_analysis",
        description: "Emit structured emergency analysis",
        parameters: {
          type: "object",
          properties: {
            intent: { type: "string" },
            incident_type: {
              type: "string",
              enum: ["fire", "medical", "accident", "crime", "natural_disaster", "harassment", "other", "unknown"],
            },
            location: { type: "string" },
            sentiment: { type: "string", enum: ["calm", "distress", "panic"] },
            confidence_score: { type: "number" },
            priority: { type: "string", enum: ["low", "medium", "critical"] },
            summary: { type: "string" },
            ack_phrase: { type: "string" },
          },
          required: [
            "intent",
            "incident_type",
            "location",
            "sentiment",
            "confidence_score",
            "priority",
            "summary",
            "ack_phrase",
          ],
          additionalProperties: false,
        },
      },
    };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Language code: ${language || "en-IN"}\nTranscript: """${transcript}"""`,
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "emit_analysis" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ error: "no tool call" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
