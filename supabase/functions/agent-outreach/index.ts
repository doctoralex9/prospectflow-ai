import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function callAI(model: string, systemPrompt: string, userContent: string, retries = 2): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent.substring(0, 30000) },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OpenAI error [${response.status}]: ${text}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content || ""
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw new Error("callAI: all retries exhausted")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const startTime = Date.now()
  const TIMEOUT_BUDGET = 140000 // 140s — leave 10s buffer

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let campaignId: string
  let userId: string

  try {
    const body = await req.json()
    campaignId = body.campaign_id
    userId = body.user_id
    if (!campaignId) throw new Error("campaign_id required")
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Load content agent config
  const { data: agentConfigs } = await supabase
    .from("agent_configs")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("agent_type", "content")

  const contentConfig = agentConfigs?.[0] || {
    model: "gpt-4o",
    system_prompt: "Write a short, personalized B2B outreach email. Be professional and concise.",
  }

  // Load leads without outreach messages (up to 40)
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .is("outreach_message", null)
    .eq("qualified", true)
    .limit(40)

  if (error || !leads || leads.length === 0) {
    return new Response(JSON.stringify({ message: "No leads to process", processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let processed = 0
  const BATCH_SIZE = 10

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > TIMEOUT_BUDGET) {
      // Self-chain: trigger ourselves again for remaining leads
      const supabaseFnUrl = `${supabaseUrl}/functions/v1/agent-outreach`
      fetch(supabaseFnUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ campaign_id: campaignId, user_id: userId }),
      }).catch(e => console.error("Self-chain trigger failed:", e))
      break
    }

    const batch = leads.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (lead) => {
      try {
        const leadContext = JSON.stringify({
          company_name: lead.company_name,
          contact_name: lead.contact_name,
          contact_role: lead.contact_role,
          industry: lead.lead_category,
          location: (lead.raw_data as Record<string, unknown>)?.location,
          email: lead.email,
          lead_phone: lead.phone,
        })

        const message = await callAI(
          contentConfig.model,
          contentConfig.system_prompt,
          `Generate outreach for this lead: ${leadContext}`
        )

        await supabase
          .from("leads")
          .update({ outreach_message: message })
          .eq("id", lead.id)

        processed++
      } catch (e) {
        console.error(`Outreach failed for lead ${lead.id}:`, e)
      }
    }))
  }

  return new Response(JSON.stringify({ message: "Outreach generation complete", processed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
