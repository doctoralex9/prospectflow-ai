import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (!openaiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let sessionId: string | undefined
  let campaignId: string | undefined
  let userId: string | undefined
  let message: string
  let agentType: string

  try {
    const body = await req.json()
    message = body.message
    agentType = body.agent_type || "assistant"
    sessionId = body.session_id
    campaignId = body.campaign_id
    userId = body.user_id
    if (!message) throw new Error("message required")
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Get or create session
  if (!sessionId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .insert({ campaign_id: campaignId, user_id: userId, agent_type: agentType })
      .select()
      .single()
    sessionId = session?.id
  }

  // Load conversation history
  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(20)

  // Save user message
  await supabase.from("chat_messages").insert({ session_id: sessionId, role: "user", content: message })

  const systemPrompt = `You are a helpful AI assistant for LeadFlow AI, a B2B lead generation platform.
You help users understand their leads, suggest outreach strategies, and provide insights about their campaigns.
Agent type: ${agentType}`

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(history || []).map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: message },
  ]

  // Stream response
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      stream: true,
    }),
  })

  if (!openaiResponse.ok) {
    const text = await openaiResponse.text()
    return new Response(JSON.stringify({ error: `OpenAI error: ${text}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Collect full response for saving to DB
  let fullResponse = ""

  const transformStream = new TransformStream({
    transform(chunk, ctrl) {
      const text = new TextDecoder().decode(chunk)
      const lines = text.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6))
            const content = data.choices?.[0]?.delta?.content || ""
            if (content) fullResponse += content
          } catch {}
        }
      }
      ctrl.enqueue(chunk)
    },
    flush() {
      // Save assistant message after stream completes
      if (sessionId && fullResponse) {
        supabase.from("chat_messages")
          .insert({ session_id: sessionId, role: "assistant", content: fullResponse })
          .then()
      }
    },
  })

  return new Response(openaiResponse.body!.pipeThrough(transformStream), {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Session-Id": sessionId || "",
    },
  })
})
