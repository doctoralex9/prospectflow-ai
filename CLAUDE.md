# LeadFlow AI — Claude Context

## What this project is
AI-powered B2B lead generation platform. User searches, pastes, or provides URLs → 6-step pipeline extracts business contacts → AI writes personalized outreach emails → Google Maps auto-fills missing phone numbers.

Target market: Greek B2B (restaurants, catering, lawyers, dentists, hotels).
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
- **Optional APIs:** Tavily (AI Search mode), Firecrawl (JS-rendered scraping), Google Places (phone enrichment)

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
    LeadsPage.tsx         — 3-tab input (URL/Paste/Search), pipeline progress (SSE), leads table, detail modal, export
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
    seedData.ts           — Athens Corporate Catering demo campaign + agent prompts

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
1. **URL Input / Search** — user-provided URLs, pasted text, or Tavily search query
2. **Crawler** — plain fetch + HTML stripping; Firecrawl if key present
3. **Filter** — pass-through
4. **Extractor** — OpenAI gpt-4o-mini extracts leads as JSON
5. **Enrichment** — website check (outdated signals) + optional Google Places phone lookup
6. **Persistence** — upsert to DB, trigger outreach agent fire-and-forget

---

## Three Input Modes (LeadsPage tabs)

### By URL
User pastes one or more URLs → pipeline crawls and extracts leads.
- Firecrawl used if `leadflow_firecrawl_key` is in localStorage, else plain fetch.

### Paste Content
User opens any site in browser → Ctrl+A → Ctrl+C → pastes raw text.
- Works on 100% of sites including JS-rendered ones.
- OTA noise filter activates if >15% of lines are booking sites (hotels use case).

### AI Search *(Tavily)*
User types a plain-language query (e.g. "dentists in Athens") → Tavily finds relevant URLs → pipeline crawls and extracts leads.
- Requires `leadflow_tavily_key` in localStorage.
- Tavily free tier: 1,000 searches/month.

---

## API Keys (all optional except OpenAI)

All user-entered keys are stored in **localStorage** and passed in the pipeline request body. Never stored server-side.

| Key | localStorage key | Used for |
|-----|-----------------|----------|
| Tavily | `leadflow_tavily_key` | AI Search mode |
| Firecrawl | `leadflow_firecrawl_key` | JS-rendered page scraping in URL mode |
| Google Places | `leadflow_google_places_key` | Auto-fetch phone/address for leads missing contact info |

Settings → API Keys card → Save API Keys writes to localStorage.

Edge function also falls back to Supabase env vars (`FIRECRAWL_API_KEY`, `GOOGLE_PLACES_API_KEY`, `TAVILY_API_KEY`) if body keys are absent.

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
- ✅ **Tavily** — optional, AI Search mode, free tier
- ✅ **Firecrawl** — optional, JS-rendered scraping, free tier
- ✅ **Google Places** — optional, phone enrichment, $200/mo free credit
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

## Demo Campaign
Settings → Load Sample Data → creates "Athens Corporate Catering Leads" with all 4 agent prompts pre-configured.

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
- `googlePlacesKey` is passed from the frontend on every pipeline run (all 3 input modes), not just search
