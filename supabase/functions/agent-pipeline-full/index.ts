import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Verify the caller's JWT against Supabase's JWKS. This is a real signature
// check — base64-decoding the payload (which we used to do) accepts forged
// tokens, so we let the auth server validate it.
// deno-lint-ignore no-explicit-any
async function verifyUser(supabase: any, req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "")
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return null
  return { id: data.user.id }
}

// Returns false if the user has exceeded maxPerHour calls. Logs the call and cleans up old rows (1% chance).
async function checkRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  functionName: string,
  maxPerHour: number,
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await supabase
    .from("api_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("function_name", functionName)
    .gte("created_at", oneHourAgo)
  if ((count ?? 0) >= maxPerHour) return false
  await supabase.from("api_rate_limits").insert({ user_id: userId, function_name: functionName })
  if (Math.random() < 0.01) {
    const twoDaysAgo = new Date(Date.now() - 172_800_000).toISOString()
    supabase.from("api_rate_limits").delete().lt("created_at", twoDaysAgo).then(() => {})
  }
  return true
}

async function callAI(model: string, systemPrompt: string, userContent: string, retries = 2): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), 25000)

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
        signal: abort.signal,
      }).finally(() => clearTimeout(timer))

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

const SOCIAL_PLATFORMS = [
  { name: "Facebook", domains: ["facebook.com"] },
  { name: "Instagram", domains: ["instagram.com"] },
  { name: "TikTok", domains: ["tiktok.com"] },
  { name: "LinkedIn", domains: ["linkedin.com"] },
  { name: "YouTube", domains: ["youtube.com", "youtu.be"] },
]

// Profile-link patterns — match only actual account URLs, not generic mentions or share buttons
const SOCIAL_PROFILE_PATTERNS: Record<string, RegExp> = {
  Instagram: /instagram\.com\/(?!p\/|reel\/|tv\/|stories\/|explore\/|accounts\/|_n\/)[a-zA-Z0-9_.]{3,}/i,
  Facebook:  /facebook\.com\/(?!sharer|share\.php|dialog\/|plugins\/)[a-zA-Z0-9_.]{3,}/i,
  TikTok:    /tiktok\.com\/@[a-zA-Z0-9_.]{3,}/i,
  LinkedIn:  /linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]{3,}/i,
  YouTube:   /youtube\.com\/(?:channel\/|c\/|@)[a-zA-Z0-9_-]{3,}|youtu\.be\/[a-zA-Z0-9_-]{5,}/i,
}

function detectSocialFromHtml(html: string): string[] {
  return SOCIAL_PLATFORMS.filter(p => {
    const pattern = SOCIAL_PROFILE_PATTERNS[p.name]
    return pattern ? pattern.test(html) : p.domains.some(d => html.toLowerCase().includes(d))
  }).map(p => p.name)
}

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

function isSameDomain(a: string, b: string): boolean {
  try { return new URL(a).hostname === new URL(b).hostname } catch { return false }
}

functon filterDirectoryUrl(urls: string:[]): string {
  const LISTING_SEGMENTS = /\/(restaurants?|cafes?|bars?|tavernas?|se
  arch|results?|list|category|tag|article|blog|news|top|best|guide)\//i
    const filtered = urls.filter(url => {
      try {
        const u = new URL(url)
        const segments = u.pathname.split("/". filter(Boolean))
        if (segments.length > 2) return false
        if (LISTING_SEGMENTS.test(u.pathname)) return false
        return true
      } catch {return false}
    })
    // if the filter removed everything, fall back to original
    //so the pipeline never silently breaks
    return filtered.length > 0 ? filtered : urls
}

async function tavilySearch(query: string, apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${query} επικοινωνία τηλέφωνο`
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      exclude_domains: [
        "e-food.gr", "efood.gr", "foody.gr", "wolt.com",
        "getir.com", "box.gr", "deliveras.gr",
        "booking.com", "airbnb.com", "expedia.com",
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tavily [${res.status}]: ${text}`)
  }
  const data = await res.json()
  return ((data.results || []) as Array<{ url: string }>).map(r => r.url).filter(Boolean)
}

// InstagramSearchAgent — searches instagram.com directly (via Tavily include_domains) for each lead.
// Only marks Instagram as confirmed when Tavily returns an actual profile URL (instagram.com/username).
// Skips leads already confirmed from HTML detection.
async function socialMediaSearchAgent(
  leads: Array<Record<string, unknown>>,
  tavilyKey: string,
): Promise<Array<Record<string, unknown>>> {
  const BATCH_SIZE = 3
  // Must be a real profile URL — not a post, reel, story, or generic path
  const INSTAGRAM_PROFILE = /instagram\.com\/(?!p\/|reel\/|tv\/|stories\/|explore\/|accounts\/)[a-zA-Z0-9_.]{3,}/i
  const results: Array<Record<string, unknown>> = []

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE)
    const enriched = await Promise.all(batch.map(async (lead) => {
      const rawData = (lead.raw_data as Record<string, unknown>) || {}
      const htmlFound: string[] = (rawData.social_media_found as string[]) || []

      // Already confirmed from HTML — no need to search
      if (htmlFound.includes("Instagram")) return lead

      const name = (lead.company_name as string) || ""
      if (!name) return lead

      // location may be top-level on the lead or inside raw_data
      const location = (lead.location as string) || (rawData.location as string) || ""

      // Add the website domain to the query so Tavily can find the Instagram profile
      // even when the business uses a different handle than its name
      // (e.g. website "tavernakostas.gr" → handle "@taverna_by_kostas")
      const website = (lead.website as string) || (rawData.website as string) || ""
      let websiteDomain = ""
      try { if (website) websiteDomain = new URL(website).hostname.replace(/^www\./, "") } catch { /* */ }

      const queryParts: string[] = [name]
      if (location) queryParts.push(location)
      if (websiteDomain) queryParts.push(websiteDomain)
      const query = queryParts.join(" ")

      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: false,
            include_domains: ["instagram.com"], // force results to come from Instagram itself
          }),
        })
        if (!res.ok) return lead

        const data = await res.json()
        const resultUrls: string[] = ((data.results || []) as Array<{ url: string }>).map(r => r.url)

        // Only flag Instagram if at least one result is a proper profile URL
        const hasInstagram = resultUrls.some(url => INSTAGRAM_PROFILE.test(url))
        if (!hasInstagram) return lead

        const combined = [...new Set([...htmlFound, "Instagram"])]
        const missing = SOCIAL_PLATFORMS.filter(p => !combined.includes(p.name)).map(p => p.name)

        return {
          ...lead,
          raw_data: {
            ...rawData,
            social_media_found: combined,
            social_media_missing: missing,
            social_media_google_checked: true,
          },
        }
      } catch {
        return lead
      }
    }))
    results.push(...enriched)
  }

  return results
}

// GooglePlacesAgent — looks up each lead on Google Places to fetch phone, address, website
async function googlePlacesAgent(
  leads: Array<Record<string, unknown>>,
  apiKey: string,
): Promise<Array<Record<string, unknown>>> {
  const BATCH_SIZE = 5
  const results: Array<Record<string, unknown>> = []

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE)
    const enriched = await Promise.all(batch.map(async (lead) => {
      if (lead.phone) return lead // already have phone, skip API call

      const name = (lead.company_name as string) || ""
      const location = ((lead.raw_data as Record<string, unknown>)?.location as string) || ""
      if (!name) return lead

      const query = location ? `${name} ${location}` : name

      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri",
          },
          body: JSON.stringify({ textQuery: query }),
        })
        if (!res.ok) return lead

        const data = await res.json()
        const place = data.places?.[0]
        if (!place) return lead

        const gotPhone = !!place.nationalPhoneNumber
        return {
          ...lead,
          phone: (lead.phone as string) || place.nationalPhoneNumber || null,
          website: (lead.website as string) || place.websiteUri || null,
          raw_data: {
            ...(lead.raw_data as Record<string, unknown>),
            address: place.formattedAddress,
            google_maps_enriched: true,
          },
          enrichment_source: gotPhone ? "google-maps" : (lead.enrichment_source as string),
        }
      } catch {
        return lead
      }
    }))
    results.push(...enriched)
  }

  return results
}

// CrawlerAgent — fetches and strips HTML from each URL
async function crawlerAgent(urls: string[]): Promise<Array<{ url: string; content: string }>> {
  const results: Array<{ url: string; content: string }> = []
  const BATCH_SIZE = 5

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(async (url) => {
      let content = ""

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
          `URL: ${page.url}\n\nContent:\n${page.content}`,
          0
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
          return [{
            ...lead,
            source_url: lead.source_url || page.url,
            website: (lead.website && !isSameDomain(lead.website as string, page.url)) ? lead.website : "",
          }]
        }
        const leads = JSON.parse(arrayMatch[0]) as Array<Record<string, unknown>>
        return leads.map(lead => ({
          ...lead,
          source_url: lead.source_url || page.url,
          // Clear website if it points back to the same directory we scraped — it's not the hotel's own site
          website: (lead.website && !isSameDomain(lead.website as string, page.url)) ? lead.website : "",
        }))
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

        // Detect social media links from the website HTML
        const socialFound = detectSocialFromHtml(html)
        const socialMissing = SOCIAL_PLATFORMS.filter(p => !socialFound.includes(p.name)).map(p => p.name)

        return {
          ...lead,
          email: (lead.email as string) || scrapedEmail || null,
          phone: (lead.phone as string) || scrapedPhone || null,
          website_signals: signals,
          website_status: isOutdated ? "outdated" : "ok",
          enrichment_source: isOutdated ? "outdated-website" : (lead.enrichment_source as string),
          raw_data: {
            ...(lead.raw_data as Record<string, unknown>),
            social_media_found: socialFound,
            social_media_missing: socialMissing,
          },
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

  // Verify JWT signature against Supabase auth — rejects forged tokens.
  const user = await verifyUser(supabase, req)
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized: valid user session required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
  const userId = user.id

  // Rate limit: 20 pipeline runs per hour per user
  const allowed = await checkRateLimit(supabase, userId, "agent-pipeline-full", 20)
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Maximum 20 pipeline runs per hour." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let campaignId: string
  let urls: string[]
  let rawContent: string | undefined
  let searchQuery: string | undefined
  let tavilyKey: string | undefined
  let googlePlacesKey: string | undefined

  try {
    const body = await req.json()
    campaignId = body.campaign_id
    urls = (body.urls as string[]) || []
    rawContent = body.rawContent as string | undefined
    searchQuery = body.searchQuery as string | undefined
    tavilyKey = body.tavilyKey as string | undefined
    googlePlacesKey = (body.googlePlacesKey as string | undefined) || Deno.env.get("GOOGLE_PLACES_API_KEY") || undefined
    if (!campaignId) throw new Error("campaign_id required")
    if (!rawContent && !urls.length && !searchQuery) throw new Error("urls, rawContent, or searchQuery required")
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Load campaign — verify it belongs to the authenticated user
  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
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
    .insert({ campaign_id: campaignId, target_url: searchQuery ? `search:${searchQuery}` : urls.length ? urls.join(", ") : "pasted-content", status: "running" })
    .select()
    .single()

  const jobId = scrapeJob?.id

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Wipe leads from previous runs — guarantees the table only contains
        // results from this run and never shows stale leads with social media
        await supabase.from("leads").delete().eq("campaign_id", campaignId)

        // Steps 1 & 2: handle three input modes
        let pages: Array<{ url: string; content: string }>

        if (searchQuery) {
          // Search mode — Tavily finds URLs, then we crawl them
          send(controller, "step", { step: 1, name: "URLInput", status: "running", message: `Searching for: "${searchQuery}"...` })
          const apiKey = tavilyKey || Deno.env.get("TAVILY_API_KEY") || ""
          if (!apiKey) {
            send(controller, "error", { message: "Tavily API key not configured. Add it in Settings → API Keys." })
            await supabase.from("scrape_jobs").update({ status: "failed", error_message: "No Tavily key" }).eq("id", jobId)
            controller.close()
            return
          }
          const foundUrls = await tavilySearch(await tavilySearch(searchQuery, apiKey))
          if (!foundUrls.length) {
            send(controller, "error", { message: `No results found for "${searchQuery}". Try a different search query.` })
            await supabase.from("scrape_jobs").update({ status: "failed", error_message: "Tavily returned no results" }).eq("id", jobId)
            controller.close()
            return
          }
          send(controller, "step", { step: 1, name: "URLInput", status: "done", message: `Found ${foundUrls.length} result${foundUrls.length !== 1 ? "s" : ""} for "${searchQuery}"` })

          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "running", message: `Scraping ${foundUrls.length} page${foundUrls.length !== 1 ? "s" : ""}...` })
          pages = await crawlerAgent(foundUrls)
          if (!pages.length) {
            send(controller, "error", { message: "Could not scrape any of the found pages. Try a different query." })
            await supabase.from("scrape_jobs").update({ status: "failed", error_message: "No pages scraped from search results" }).eq("id", jobId)
            controller.close()
            return
          }
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "done", message: `Scraped ${pages.length} page${pages.length !== 1 ? "s" : ""}` })

        } else if (rawContent) {
          // Paste mode — skip crawler
          const { filtered, otaRatio } = filterOTANoise(rawContent)
          const wasFiltered = otaRatio > 0.15
          pages = [{ url: "pasted-content", content: filtered }]
          send(controller, "step", { step: 1, name: "URLInput", status: "done", message: "Content paste mode — skipping crawler" })
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "done", message: wasFiltered ? `OTA noise removed (${Math.round(otaRatio * 100)}% was booking sites) — using cleaned content` : "Using pasted content directly" })

        } else {
          // URL mode — crawl provided URLs
          send(controller, "step", { step: 1, name: "URLInput", status: "done", message: `${urls.length} URL${urls.length !== 1 ? "s" : ""} ready to process` })
          send(controller, "step", { step: 2, name: "CrawlerAgent", status: "running", message: `Scraping ${urls.length} page${urls.length !== 1 ? "s" : ""}` })
          pages = await crawlerAgent(urls)
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

        // Step 5: Enrichment + website check + optional Google Places lookup
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: "Checking websites for outdated signals..." })
        const enrichedLeads = enrichmentAgent(extractedLeads)
        let finalLeads = await websiteCheckAgent(enrichedLeads)

        if (googlePlacesKey) {
          const missingPhone = finalLeads.filter(l => !l.phone).length
          if (missingPhone > 0) {
            send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: `Google Maps: looking up ${missingPhone} lead${missingPhone !== 1 ? "s" : ""} without phone...` })
            finalLeads = await googlePlacesAgent(finalLeads, googlePlacesKey)
          }
        }

        // Tavily Instagram search — only for leads not already confirmed from HTML.
        // Uses include_domains:["instagram.com"] so results come from Instagram itself.
        const smTavilyKey = tavilyKey || Deno.env.get("TAVILY_API_KEY") || ""
        if (smTavilyKey) {
          const needsCheck = finalLeads.filter(l => {
            const found = ((l.raw_data as Record<string, unknown>)?.social_media_found as string[]) || []
            return !found.includes("Instagram")
          }).length
          if (needsCheck > 0) {
            send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: `Instagram check: searching ${needsCheck} lead${needsCheck !== 1 ? "s" : ""} on Instagram...` })
            finalLeads = await socialMediaSearchAgent(finalLeads, smTavilyKey)
          }
        }

        // Drop leads that have a confirmed Instagram presence (actual profile link in their website HTML
        // or a real instagram.com/username URL returned by Tavily).
        const beforeFilter = finalLeads.length
        finalLeads = finalLeads.filter(lead => {
          const found = ((lead.raw_data as Record<string, unknown>)?.social_media_found as string[]) || []
          return !found.includes("Instagram")
        })
        const dropped = beforeFilter - finalLeads.length
        if (dropped > 0) {
          send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "running", message: `Filtered out ${dropped} lead${dropped !== 1 ? "s" : ""} with confirmed Instagram · ${finalLeads.length} remaining` })
        }

        const noWebsite = finalLeads.filter(l => l.website_status === "no-website").length
        const outdated = finalLeads.filter(l => l.website_status === "outdated").length
        const withContact = finalLeads.filter(l => l.email || l.phone).length
        const googleMapsEnriched = finalLeads.filter(l => l.enrichment_source === "google-maps").length
        const enrichmentMsg = googleMapsEnriched > 0
          ? `${noWebsite} no website · ${outdated} outdated · ${withContact} with contact info (${googleMapsEnriched} via Google Maps)`
          : `${noWebsite} no website · ${outdated} outdated · ${withContact} with contact info`
        send(controller, "step", { step: 5, name: "EnrichmentAgent", status: "done", message: enrichmentMsg })

        // Step 6: Persistence
        send(controller, "step", { step: 6, name: "PersistenceAgent", status: "running", message: "Saving leads to database..." })

        let savedCount = 0
        const SAVE_BATCH = 20

        for (let i = 0; i < finalLeads.length; i += SAVE_BATCH) {
          const batch = finalLeads.slice(i, i + SAVE_BATCH)
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
          .update({ status: "completed", pages_scraped: pages.length, leads_found: finalLeads.length })
          .eq("id", jobId)

        send(controller, "step", { step: 6, name: "PersistenceAgent", status: "done", message: `Saved ${savedCount} lead${savedCount !== 1 ? "s" : ""} to database` })
        send(controller, "complete", { total_leads: savedCount, job_id: jobId })

        // Trigger outreach generation. `EdgeRuntime.waitUntil` keeps the
        // worker alive after the SSE stream closes, otherwise the platform
        // can kill the worker mid-fetch and outreach silently never runs.
        const outreachPromise = fetch(`${supabaseUrl}/functions/v1/agent-outreach`, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseServiceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: campaignId }),
        }).catch(e => console.error("Outreach trigger failed:", e))
        // @ts-ignore EdgeRuntime is provided by Supabase's Deno runtime
        if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
          // @ts-ignore
          EdgeRuntime.waitUntil(outreachPromise)
        }

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
