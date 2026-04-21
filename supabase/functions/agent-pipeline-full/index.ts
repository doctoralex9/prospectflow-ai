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

async function fetchWithFirecrawl(url: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  })
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`)
  const data = await res.json()
  return (data?.data?.markdown as string) || ""
}

async function fetchWithPlainFetch(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return html
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
}

const OTA_PATTERN = /booking\.com|airbnb\.com|tripadvisor\.|expedia\.com|hotels\.com|agoda\.com|vrbo\.com/gi

// Strips OTA-dominated lines from pasted content so the AI focuses on actual hotels.
// Only activates when >15% of lines are pure OTA noise.
function filterOTANoise(content: string): { filtered: string; otaRatio: number } {
  const lines = content.split("\n")
  const otaLineCount = lines.filter(l => OTA_PATTERN.test(l)).length
  const otaRatio = otaLineCount / Math.max(lines.length, 1)

  if (otaRatio > 0.15) {
    const filtered = lines
      .filter(l => !OTA_PATTERN.test(l) || /hotel|ξενοδοχ|διαμον|villa|studio|apart/i.test(l))
      .join("\n")
    return { filtered, otaRatio }
  }
  return { filtered: content, otaRatio }
}

// CrawlerAgent — tries Firecrawl (JS-rendered sites) if key provided, falls back to plain fetch
async function crawlerAgent(urls: string[], firecrawlKey?: string): Promise<Array<{ url: string; content: string }>> {
  const results: Array<{ url: string; content: string }> = []
  const BATCH_SIZE = 5

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(async (url) => {
      let content = ""

      if (firecrawlKey) {
        try {
          content = await fetchWithFirecrawl(url, firecrawlKey)
          if (content.length > 20) return { url, content: content.substring(0, 25000) }
          console.warn(`Firecrawl returned empty for ${url}, falling back`)
        } catch (e) {
          console.error(`Firecrawl failed for ${url}:`, e)
        }
      }

      try {
        content = await fetchWithPlainFetch(url)
        return { url, content: content.substring(0, 25000) }
      } catch (e) {
        console.error(`Crawler failed for ${url}:`, e)
        return { url, content: "" }
      }
    }))
    results.push(...batchResults.filter(r => r.content.length > 20))
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
        const mandatoryFields = "\n\nCRITICAL: You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code blocks. Just the raw JSON array starting with [ and ending with ]. Every lead must include: company_name, contact_name, contact_role, email, phone, website, location, source_url. If a field is unknown use empty string."
        const raw = await callAI(
          scraperConfig.model,
          scraperConfig.system_prompt + mandatoryFields,
          `URL: ${page.url}\n\nContent:\n${page.content}`
        )

        // Try to extract JSON array from response — handle markdown code blocks too
        let jsonStr = raw
        const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (codeBlock) jsonStr = codeBlock[1]
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
        if (!arrayMatch) {
          // If AI returned a single object, wrap it
          const objMatch = jsonStr.match(/\{[\s\S]*\}/)
          if (!objMatch) {
            console.error("No JSON found in response:", raw.substring(0, 200))
            return []
          }
          const lead = JSON.parse(objMatch[0]) as Record<string, unknown>
          return [{ ...lead, source_url: lead.source_url || page.url }]
        }
        const leads = JSON.parse(arrayMatch[0]) as Array<Record<string, unknown>>
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

// Extracts email and phone from raw HTML text.
// Email: prefers mailto: links (most reliable), falls back to plain-text regex.
// Phone: matches Greek landlines (2XXXXXXXXX) and mobiles (69XXXXXXXX), with optional +30 prefix.
function extractContactsFromHtml(html: string): { email: string | null; phone: string | null } {
  let email: string | null = null
  const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
  if (mailtoMatch) {
    email = mailtoMatch[1].toLowerCase()
  } else {
    const emailMatch = html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)
    const candidate = emailMatch?.[1]?.toLowerCase()
    if (candidate && !candidate.startsWith("noreply") && !candidate.includes("example.com") && !candidate.includes("sentry") && !candidate.includes("wixpress")) {
      email = candidate
    }
  }

  let phone: string | null = null
  const phoneMatch = html.match(/(?:\+30[\s\-.]?)?(?:2\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}|2\d{3}[\s\-.]?\d{6}|69\d[\s\-.]?\d{3}[\s\-.]?\d{4})/)
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/[\s\-.]/g, "")
    phone = digits.startsWith("+") ? digits : `+30${digits}`
  }

  return { email, phone }
}

// WebsiteCheckAgent — fetches each lead's website, scores it for outdatedness,
// and extracts email + phone from the HTML while it's already downloaded.
async function websiteCheckAgent(leads: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const BATCH_SIZE = 5
  const results: Array<Record<string, unknown>> = []

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE)
    const checked = await Promise.all(batch.map(async (lead) => {
      const website = lead.website as string
      if (!website || !website.startsWith("http")) {
        return { ...lead, website_signals: ["no website"], website_status: "no-website", enrichment_source: "no-website" }
      }

      try {
        const html = await fetchWithPlainFetch(website)
        const signals: string[] = []

        // Copyright year check
        const yearMatches = [...html.matchAll(/©\s*(\d{4})/g)]
        if (yearMatches.length > 0) {
          const years = yearMatches.map(m => parseInt(m[1]))
          const maxYear = Math.max(...years)
          if (maxYear < 2022) signals.push(`last updated ${maxYear}`)
        }

        // Mobile viewport
        if (!html.toLowerCase().includes('name="viewport"') && !html.toLowerCase().includes("name='viewport'")) {
          signals.push("not mobile-friendly")
        }

        // HTTPS
        if (website.startsWith("http://")) signals.push("no HTTPS")

        // No direct booking widget
        const hasBookingWidget = /iframe[^>]*(reserv|cloudbeds|beds24|hotelrunner|siteminder|wubook)/i.test(html)
        if (!hasBookingWidget) signals.push("no direct booking widget")

        // Relies only on OTAs
        const hasOTALinks = /booking\.com|airbnb\.com|expedia\.com/i.test(html)
        if (hasOTALinks && !hasBookingWidget) signals.push("relies on OTAs only")

        const isOutdated = signals.length >= 2

        // Extract email + phone from HTML — only fill in if the AI didn't already find them
        const { email: scrapedEmail, phone: scrapedPhone } = extractContactsFromHtml(html)

        return {
          ...lead,
          email: (lead.email as string) || scrapedEmail || null,
          phone: (lead.phone as string) || scrapedPhone || null,
          website_signals: signals,
          website_status: isOutdated ? "outdated" : "ok",
          enrichment_source: isOutdated ? "outdated-website" : (lead.enrichment_source as string),
        }
      } catch {
        return { ...lead, website_signals: ["website unreachable"], website_status: "unreachable", enrichment_source: "no-website" }
      }
    }))
    results.push(...checked)
  }

  return results
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || undefined

  let campaignId: string
  let userId: string
  let urls: string[]
  let rawContent: string | undefined

  try {
    const body = await req.json()
    campaignId = body.campaign_id
    userId = body.user_id
    urls = (body.urls as string[]) || []
    rawContent = body.rawContent as string | undefined
    if (!campaignId) throw new Error("campaign_id required")
    if (!rawContent && !urls.length) throw new Error("urls or rawContent required")
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
    .insert({ campaign_id: campaignId, target_url: urls.length ? urls.join(", ") : "pasted-content", status: "running" })
    .select()
    .single()

  const jobId = scrapeJob?.id

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Input ready
        send(controller, "step", { step: 1, name: "URLInput", status: "done", message: rawContent ? "Content paste mode — skipping crawler" : `${urls.length} URL${urls.length !== 1 ? "s" : ""} ready to process` })

        // Step 2: Crawler (skipped if rawContent provided)
        let pages: Array<{ url: string; content: string }>
        if (rawContent) {
          const { filtered, otaRatio } = filterOTANoise(rawContent)
          const wasFiltered = otaRatio > 0.15
          pages = [{ url: "pasted-content", content: filtered }]
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "done", message: wasFiltered ? `OTA noise removed (${Math.round(otaRatio * 100)}% was booking sites) — using cleaned content` : "Using pasted content directly" })
        } else {
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "running", message: `Scraping ${urls.length} page${urls.length !== 1 ? "s" : ""} ${firecrawlKey ? "via Firecrawl" : "(plain fetch)"}...` })
          pages = await crawlerAgent(urls, firecrawlKey)
          if (pages.length === 0) {
            send(controller, "error", { message: "Could not scrape any pages. Check that the URLs are publicly accessible." })
            await supabase.from("scrape_jobs").update({ status: "failed", error_message: "No pages scraped" }).eq("id", jobId)
            controller.close()
            return
          }
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "done", message: `Scraped ${pages.length} page${pages.length !== 1 ? "s" : ""} successfully` })
        }

        // Step 3: Filter (pass-through)
        send(controller, "step", { step: 3, name: "FilterAgent", status: "done", message: `${pages.length} page${pages.length !== 1 ? "s" : ""} passed to extraction` })

        // Step 4: Qualifier / Extractor
        send(controller, "step", { step: 4, name: "QualifierAgent", status: "running", message: "Extracting lead candidates with AI..." })
        const scraperConfig = getConfig("scraper")
        const extractedLeads = await qualifierAgent(pages, scraperConfig as { model: string; system_prompt: string })
        send(controller, "step", { step: 4, name: "QualifierAgent", status: "done", message: `Extracted ${extractedLeads.length} lead candidate${extractedLeads.length !== 1 ? "s" : ""}` })

        // Step 5: Enrichment + website check
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: "Checking websites for outdated signals..." })
        const enrichedLeads = enrichmentAgent(extractedLeads)
        const checkedLeads = await websiteCheckAgent(enrichedLeads)
        const noWebsite = checkedLeads.filter(l => l.website_status === "no-website").length
        const outdated = checkedLeads.filter(l => l.website_status === "outdated").length
        const withContact = checkedLeads.filter(l => l.email || l.phone).length
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "done", message: `${noWebsite} no website · ${outdated} outdated · ${withContact} with contact info` })

        // Step 6: Persistence
        send(controller, "step", { step: 6, name: "PersistenceAgent", status: "running", message: "Saving leads to database..." })

        let savedCount = 0
        const SAVE_BATCH = 20

        for (let i = 0; i < checkedLeads.length; i += SAVE_BATCH) {
          const batch = checkedLeads.slice(i, i + SAVE_BATCH)
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
