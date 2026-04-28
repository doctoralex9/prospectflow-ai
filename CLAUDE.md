# LeadFlow AI — Claude Context

## What this project is
AI-powered B2B lead generation platform. User types a search query → Tavily finds relevant pages → 6-step pipeline extracts business contacts → AI writes personalized outreach emails → Google Maps auto-fills missing phones → social media check flags businesses with no Instagram/TikTok presence.

Target market: Greek restaurants, cafes, tavernas, and pizzerias (social media management niche).
Distribution: TikTok demos → DM-based sales.

**Note:** TikTok content strategy (how to record, edit in CapCut, upload, etc.) is discussed separately in a browser Claude conversation — not Claude Code. Claude Code is only for app development tasks.

GitHub: https://github.com/doctoralex9/prospectflow-ai

---

## Tech Stack
- **Frontend:** React + TypeScript + Vite + Tailwind CSS + shadcn-style components (dark theme permanent)
- **Backend:** Supabase Edge Functions (Deno runtime)
- **Database:** Supabase PostgreSQL with Row Level Security
- **Auth:** Supabase Auth (email/password)
- **Required API:** OpenAI (gpt-4o-mini for extraction, gpt-4o for outreach emails)
- **Optional APIs:** Tavily (AI Search — required for search mode), Google Places (phone enrichment)

## Supabase Project
- URL: `https://ymxskdbmdwikzfzowznu.supabase.co`
- Anon key: in `.env` as `VITE_SUPABASE_PUBLISHABLE_KEY` (JWT format, eyJ...)
- Secrets configured: `OPENAI_API_KEY`

---

## Project Structure
```
src/
  pages/
    AuthPage.tsx          — email/password login + signup
    DashboardPage.tsx     — stats cards, pie/bar charts, recent pipeline runs
    LeadsPage.tsx         — AI Search input only, pipeline progress (SSE), leads table, detail modal, export; auto-creates default campaign on first load
    SettingsPage.tsx      — campaign CRUD, agent config editor, API Keys card, seed data
    ChatPage.tsx          — streaming AI assistant chat
  components/
    Layout.tsx            — sidebar navigation
    ui/                   — shadcn-style primitives (button, card, dialog, select, etc.)
  hooks/
    useAuth.ts            — Supabase auth state
    use-toast.ts          — toast notifications
  lib/
    supabase.ts           — Supabase client (uses `any` cast — intentional, avoids generic type conflicts)
    utils.ts              — cn() helper
  types/
    database.ts           — DB type definitions
  data/
    seedData.ts           — Default campaign: Greek Restaurants & Cafes (social media niche) + agent prompts; exported as DEFAULT_CAMPAIGN / DEFAULT_AGENT_CONFIGS (DEMO_* aliases kept for backwards compat)

supabase/
  functions/
    agent-pipeline-full/  — 6-step pipeline, SSE streaming
    agent-outreach/       — background outreach email generator, self-chains
    agent-chat/           — streaming chat with session memory
  migrations/
    20240101000000_initial_schema.sql — full schema + RLS policies
```

---

## The 6-Step Pipeline
1. **AI Search** — Tavily searches the web for pages matching the user's query
2. **Crawler** — plain fetch + HTML stripping
3. **Filter** — pass-through
4. **Extractor** — OpenAI gpt-4o-mini extracts leads as JSON
5. **Enrichment** — website check (outdated signals) + social media presence check (Instagram/TikTok) + optional Google Places phone lookup
6. **Persistence** — upsert to DB, trigger outreach agent fire-and-forget

---

## Input Mode (LeadsPage)

### AI Search (only mode)
User types a plain-language query (e.g. "εστιατόρια Αθήνα χωρίς Instagram") → Tavily finds relevant URLs → pipeline crawls and extracts leads.
- Requires `leadflow_tavily_key` in localStorage.
- Tavily free tier: 1,000 searches/month.
- Greek search suggestions shown in the UI as quick-fill chips.
- URL/Paste modes have been removed to keep the flow simple.

---

## API Keys (all optional except OpenAI)

All user-entered keys are stored in **localStorage** and passed in the pipeline request body. Never stored server-side.

| Key | localStorage key | Used for |
|-----|-----------------|----------|
| Tavily | `leadflow_tavily_key` | AI Search (required for pipeline to run) |
| Google Places | `leadflow_google_places_key` | Auto-fetch phone/address for leads missing contact info |

Settings → API Keys card → Save API Keys writes to localStorage.

Edge function also falls back to Supabase env vars (`GOOGLE_PLACES_API_KEY`, `TAVILY_API_KEY`) if body keys are absent.

---

## Google Places Agent (Step 5)

After the website check, if `googlePlacesKey` is present:
- Finds all leads that have no phone number
- Calls `POST https://places.googleapis.com/v1/places:searchText` with `"Company Name City"` as query
- Extracts `nationalPhoneNumber`, `websiteUri`, `formattedAddress`
- Updates lead: fills phone/website if missing, sets `enrichment_source = "google-maps"`
- Badge shown in leads table: **"Google Maps"** (default variant)
- Cost: $0.017/call; $200/month free credit from Google (~11,700 free lookups)
- Enable: Google Cloud Console → enable **"Places API (New)"** → create API key

---

## Enrichment Source Badges

| Value | Badge | Meaning |
|-------|-------|---------|
| `scraper` | green | Contact info found on the scraped page |
| `google-maps` | filled | Phone/address fetched from Google Places |
| `outdated-website` | yellow | Website found but has outdated signals |
| `no-website` | red | No website found for the business |

---

## Website Hallucination Fix

When a directory page is scraped (e.g. `cretehotels.gr/list`), the AI sometimes sets the directory's own domain as each hotel's `website`. Fixed with `isSameDomain(lead.website, page.url)` — if the extracted `website` belongs to the same domain as the source page, it is cleared before saving.

---

## APIs — Current Status

- ✅ **OpenAI** — required, gpt-4o-mini + gpt-4o
- ✅ **Tavily** — required for search, free tier (1,000/month)
- ✅ **Google Places** — optional, phone enrichment, $200/mo free credit
- ❌ **Firecrawl** — removed (URL/Paste modes dropped)
- ❌ **Perplexity AI** — removed
- ❌ **Apollo.io** — removed

---

## What To Build Next (in priority order)

### 1. Landing page
Only after product validated with paying clients.

---

## Pricing Model

There is **no fixed pricing or payment system** (Stripe or otherwise).
Pricing is negotiated manually per client depending on their needs, volume, and use case.
Do not suggest or build any payment integration unless explicitly requested.

---

## How To Run Locally
```bash
npm run dev
# visit http://localhost:5173
```

## Dark Theme
Permanent. `class="dark"` on `<html>` in `index.html`. Dark CSS variables are defined in `src/index.css` under `.dark {}`. Do not add a theme toggle unless explicitly requested.

## Edge Function Deployment
Every code change must be manually redeployed:
Supabase Dashboard → Edge Functions → [function name] → Edit → paste code → Deploy

## Default Campaign
The app auto-creates the default campaign ("Greek Restaurants & Cafes") on first login — no manual setup needed. Agent configs are also upserted automatically to stay in sync with the latest defaults in seedData.ts.

---

## Code Change Communication Rule
Every time a code change is made, explain:
1. **What changed** — which file, which part
2. **Why** — what problem it solves
3. **How it works** — step by step, in plain language
4. **What to do next** — deploy instructions or next step

---

## Important Implementation Notes
- Supabase client uses `as unknown as SupabaseClient<any>` — intentional to avoid supabase-js 2.103 generic type conflicts
- Edge functions use `https://esm.sh/` imports — valid Deno syntax, not a bug
- `Deno` errors in VS Code are false positives — functions run on Deno runtime, not Node
- `.vscode/settings.json` configures Deno extension for the `supabase/functions/` folder
- Pipeline SSE uses fetch-based reader (not EventSource) because EventSource only supports GET
- Leads upsert on conflict `(campaign_id, company_name, source_url)` — no duplicates across runs
- `googlePlacesKey` is passed from the frontend on every pipeline run
- Social media check (Instagram/TikTok) runs in enrichment step; results stored in lead `raw_data` as `social_media_missing` / `social_media_present`; outreach agent uses these fields to tailor the pitch
