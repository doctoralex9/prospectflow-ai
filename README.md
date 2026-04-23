# LeadFlow AI

AI-powered B2B lead generation platform. Search for businesses, run a 6-step extraction pipeline, get contact info, and send personalized outreach — all in one tool.

Built for the Greek B2B market (restaurants, catering, lawyers, dentists, hotels) and distributed via TikTok demos.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | Supabase Edge Functions (Deno runtime) |
| Database | Supabase PostgreSQL + Row Level Security |
| Auth | Supabase Auth (email/password) |
| AI | OpenAI gpt-4o-mini (extraction) + gpt-4o (outreach) |
| Optional | Tavily (AI Search), Firecrawl (JS scraping), Google Places (phone enrichment) |

---

## Setup

### 1. Supabase Project

1. Create a project at [supabase.com](https://supabase.com)
2. In the SQL editor, run: `supabase/migrations/20240101000000_initial_schema.sql`
3. Deploy the edge functions (see step 4)

### 2. Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 3. Edge Function Secrets

In Supabase Dashboard → Settings → Edge Functions → Secrets, add:

| Secret | Required | Purpose |
|--------|----------|---------|
| `OPENAI_API_KEY` | Yes | Lead extraction + outreach generation |
| `FIRECRAWL_API_KEY` | No | JS-rendered page scraping fallback |
| `GOOGLE_PLACES_API_KEY` | No | Phone/address enrichment from Google Maps |
| `TAVILY_API_KEY` | No | AI Search mode (finds URLs from plain-language queries) |

> User-entered API keys (from Settings → API Keys) are stored in **localStorage** and sent per-request — they override the server-side secrets above.

### 4. Deploy Edge Functions

```bash
supabase functions deploy agent-pipeline-full
supabase functions deploy agent-outreach
```

### 5. Run Frontend

```bash
npm install
npm run dev
# open http://localhost:5173
```

---

## The 6-Step Pipeline

| Step | Name | What it does |
|------|------|-------------|
| 1 | URL Input | Accepts URLs, pasted text, or Tavily search query |
| 2 | Crawler | Fetches pages (plain fetch or Firecrawl for JS-heavy sites) |
| 3 | Filter | Pass-through / content validation |
| 4 | Extractor | OpenAI gpt-4o-mini extracts leads as JSON |
| 5 | Enrichment | Website check + optional Google Places phone lookup |
| 6 | Persistence | Upserts leads to DB, triggers outreach agent |

### Three Input Modes

- **By URL** — paste one or more URLs, pipeline crawls and extracts leads
- **Paste Content** — Ctrl+A / Ctrl+C any page, paste the raw text
- **AI Search** *(requires Tavily key)* — type a plain query like "dentists in Athens", Tavily finds the URLs

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — stats cards, enrichment pie chart, status bar chart, recent pipeline runs |
| `/leads` | Lead pipeline runner, progress tracker, leads table with search/filter, detail modal, Excel export |
| `/settings` | Campaign CRUD with AI wizard, agent prompt editor, API keys |
| `/auth` | Email/password login and signup |

---

## API Keys (user-managed, stored in browser)

All optional keys are entered in **Settings → API Keys** and stored in `localStorage`. They are never sent to any server other than the respective API provider.

| Key | localStorage key | Service |
|-----|-----------------|---------|
| Tavily | `leadflow_tavily_key` | AI Search mode — free at tavily.com (1,000/month) |
| Firecrawl | `leadflow_firecrawl_key` | JS-rendered scraping — free tier 500 pages/month |
| Google Places | `leadflow_google_places_key` | Phone enrichment — $200/month free credit (~11,000 lookups) |

---

## Demo Campaign

Settings → **Load Sample Data** creates the "Greek Hotel Direct Booking Leads" demo campaign with all 4 agent prompts pre-configured.

---

## Notes

- Dark theme is permanent (`class="dark"` on `<html>`)
- Leads upsert on conflict `(campaign_id, company_name, source_url)` — re-running the same URLs won't duplicate leads
- `Deno` errors in VS Code are false positives — functions run on Deno, not Node
- Edge function imports use `https://esm.sh/` — valid Deno syntax
