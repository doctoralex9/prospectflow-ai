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

function send(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

// CrawlerAgent — plain fetch + HTML stripping (no external API needed)
async function crawlerAgent(urls: string[]): Promise<Array<{ url: string; content: string }>> {
  const results: Array<{ url: string; content: string }> = []
  const BATCH_SIZE = 5

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
        })

        if (!res.ok) return { url, content: "" }

        const html = await res.text()
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 25000)

        return { url, content: text }
      } catch (e) {
        console.error(`Crawler failed for ${url}:`, e)
        return { url, content: "" }
      }
    }))
    results.push(...batchResults.filter(r => r.content.length > 100))
  }

  return results
}

// QualifierAgent — extracts lead candidates via OpenAI
async function qualifierAgent(
  pages: Array<{ url: string; content: string }>,
  scraperConfig: { model: string; system_prompt: string }
): Promise<Array<Record<string, unknown>>> {
  const BATCH_SIZE = 5
  const allLeads: Array<Record<string, unknown>> = []

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE)
    const batchLeads = await Promise.all(batch.map(async (page) => {
      try {
        const mandatoryFields = "\n\nALWAYS include these fields for every lead: company_name, contact_name, contact_role, email, phone, website, location, source_url"
        const raw = await callAI(
          scraperConfig.model,
          scraperConfig.system_prompt + mandatoryFields,
          `URL: ${page.url}\n\nContent:\n${page.content}`
        )

        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (!jsonMatch) return []
        const leads = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
        return leads.map(lead => ({ ...lead, source_url: lead.source_url || page.url }))
      } catch (e) {
        console.error("QualifierAgent error:", e)
        return []
      }
    }))
    allLeads.push(...batchLeads.flat())
  }

  return allLeads
}

// EnrichmentAgent — scraper data only, no external APIs
function enrichmentAgent(leads: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return leads.map(lead => {
    if (lead.email || lead.phone) {
      return { ...lead, enrichment_source: "scraper" }
    }
    return { ...lead, enrichment_source: "not_found" }
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let campaignId: string
  let userId: string
  let urls: string[]

  try {
    const body = await req.json()
    campaignId = body.campaign_id
    userId = body.user_id
    urls = (body.urls as string[]) || []
    if (!campaignId) throw new Error("campaign_id required")
    if (!urls.length) throw new Error("urls array required")
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Load campaign + agent configs
  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single()

  if (campaignErr || !campaign) {
    return new Response(JSON.stringify({ error: "Campaign not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { data: agentConfigs } = await supabase
    .from("agent_configs")
    .select("*")
    .eq("campaign_id", campaignId)

  const getConfig = (type: string) =>
    agentConfigs?.find((c: Record<string, unknown>) => c.agent_type === type) || { model: "gpt-4o-mini", system_prompt: "Extract business leads from this page as a JSON array." }

  // Create scrape job
  const { data: scrapeJob } = await supabase
    .from("scrape_jobs")
    .insert({ campaign_id: campaignId, target_url: urls.join(", "), status: "running" })
    .select()
    .single()

  const jobId = scrapeJob?.id

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: URLs provided by user (no discovery needed)
        send(controller, "step", { step: 1, name: "URLInput", status: "done", message: `${urls.length} URL${urls.length !== 1 ? "s" : ""} ready to process` })

        // Step 2: Crawler
        send(controller, "step", { step: 2, name: "CrawlerAgent", status: "running", message: `Scraping ${urls.length} page${urls.length !== 1 ? "s" : ""}...` })
        const pages = await crawlerAgent(urls)
        if (pages.length === 0) {
          send(controller, "error", { message: "Could not scrape any pages. Check that the URLs are publicly accessible." })
          await supabase.from("scrape_jobs").update({ status: "failed", error_message: "No pages scraped" }).eq("id", jobId)
          controller.close()
          return
        }
        send(controller, "step", { step: 2, name: "CrawlerAgent", status: "done", message: `Scraped ${pages.length} page${pages.length !== 1 ? "s" : ""} successfully` })

        // Step 3: Filter (pass-through)
        send(controller, "step", { step: 3, name: "FilterAgent", status: "done", message: `${pages.length} page${pages.length !== 1 ? "s" : ""} passed to extraction` })

        // Step 4: Qualifier / Extractor
        send(controller, "step", { step: 4, name: "QualifierAgent", status: "running", message: "Extracting lead candidates with AI..." })
        const scraperConfig = getConfig("scraper")
        const extractedLeads = await qualifierAgent(pages, scraperConfig as { model: string; system_prompt: string })
        if (extractedLeads.length === 0) {
          send(controller, "error", { message: "No leads extracted. Try adjusting your scraper prompt in Settings." })
          await supabase.from("scrape_jobs").update({ status: "failed", error_message: "No leads extracted" }).eq("id", jobId)
          controller.close()
          return
        }
        send(controller, "step", { step: 4, name: "QualifierAgent", status: "done", message: `Extracted ${extractedLeads.length} lead candidate${extractedLeads.length !== 1 ? "s" : ""}` })

        // Step 5: Enrichment (scraper data only)
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: "Organizing contact data..." })
        const enrichedLeads = enrichmentAgent(extractedLeads)
        const withContact = enrichedLeads.filter(l => l.email || l.phone).length
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "done", message: `${withContact} lead${withContact !== 1 ? "s" : ""} with contact info found` })

        // Step 6: Persistence
        send(controller, "step", { step: 6, name: "PersistenceAgent", status: "running", message: "Saving leads to database..." })

        let savedCount = 0
        const SAVE_BATCH = 20

        for (let i = 0; i < enrichedLeads.length; i += SAVE_BATCH) {
          const batch = enrichedLeads.slice(i, i + SAVE_BATCH)
          const records = batch.map(lead => ({
            campaign_id: campaignId,
            company_name: (lead.company_name as string) || "Unknown",
            contact_name: (lead.contact_name as string) || null,
            contact_role: (lead.contact_role as string) || null,
            email: (lead.email as string) || null,
            phone: (lead.phone as string) || null,
            source_url: (lead.source_url as string) || null,
            raw_data: lead,
            qualified: true,
            lead_category: (lead.industry as string) || null,
            enrichment_source: (lead.enrichment_source as string) || null,
            status: "new",
          }))

          const { error: upsertErr } = await supabase
            .from("leads")
            .upsert(records, { onConflict: "campaign_id,company_name,source_url", ignoreDuplicates: false })

          if (upsertErr) {
            console.error("Upsert error:", upsertErr)
          } else {
            savedCount += batch.length
          }
        }

        await supabase
          .from("scrape_jobs")
          .update({ status: "completed", pages_scraped: pages.length, leads_found: savedCount })
          .eq("id", jobId)

        send(controller, "step", { step: 6, name: "PersistenceAgent", status: "done", message: `Saved ${savedCount} lead${savedCount !== 1 ? "s" : ""} to database` })
        send(controller, "complete", { total_leads: savedCount, job_id: jobId })

        // Fire-and-forget outreach generation
        fetch(`${supabaseUrl}/functions/v1/agent-outreach`, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseServiceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: campaignId, user_id: userId }),
        }).catch(e => console.error("Outreach trigger failed:", e))

      } catch (e) {
        console.error("Pipeline error:", e)
        send(controller, "error", { message: String(e) })
        await supabase.from("scrape_jobs").update({ status: "failed", error_message: String(e) }).eq("id", jobId)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})
