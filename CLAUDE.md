# ProspectFlow AI — Claude Context

## What this project is
AI-powered B2B lead generation platform. User pastes URLs or page content → 6-step pipeline extracts business contacts → AI writes personalized outreach emails.

Target market: Greek B2B (restaurants, catering, lawyers, dentists, hotels).
Distribution: TikTok demos → DM-based sales.

GitHub: https://github.com/doctoralex9/prospectflow-ai

---

## Tech Stack
- **Frontend:** React + TypeScript + Vite + Tailwind CSS + shadcn-style components
- **Backend:** Supabase Edge Functions (Deno runtime)
- **Database:** Supabase PostgreSQL with Row Level Security
- **Auth:** Supabase Auth (email/password)
- **Only external API:** OpenAI (gpt-4o-mini for extraction, gpt-4o for outreach emails)

## Supabase Project
- URL: `https://ymxskdbmdwikzfzowznu.supabase.co`
- Anon key: in `.env` as `VITE_SUPABASE_PUBLISHABLE_KEY` (JWT format, eyJ...)
- Secret configured: `OPENAI_API_KEY`

---

## Project Structure
```
src/
  pages/
    AuthPage.tsx          — email/password login + signup
    DashboardPage.tsx     — stats cards, pie/bar charts, recent pipeline runs
    LeadsPage.tsx         — URL input, pipeline progress (SSE), leads table, detail modal, export
    SettingsPage.tsx      — campaign CRUD, agent config editor (model + prompt), seed data
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
1. **URL Input** — user-provided URLs (no auto-discovery)
2. **Crawler** — plain fetch + HTML stripping (no Firecrawl)
3. **Filter** — pass-through
4. **Extractor** — OpenAI gpt-4o-mini extracts leads as JSON
5. **Enrichment** — scraper data only (no Apollo)
6. **Persistence** — upsert to DB, trigger outreach agent fire-and-forget

---

## APIs Removed (intentional decisions)
- ❌ **Perplexity AI** — replaced with manual URL input by user
- ❌ **Firecrawl** — using plain fetch fallback only
- ❌ **Apollo.io** — enrichment is scraper-only
- ✅ **OpenAI only** — the only required API

---

## Current Main Problem
Plain `fetch()` only works on static HTML pages. Most modern Greek directories (e-food.gr, foody.gr, vrisko.gr) are JavaScript-rendered — fetch returns empty HTML, pipeline finds 0 leads.

---

## What To Build Next (in priority order)

### 1. Manual paste mode — MOST IMPORTANT
Add a "Paste Content" tab on the Leads page alongside the URL input.
User opens any site in browser → Ctrl+A → Ctrl+C → pastes raw text into LeadFlow → AI extracts leads.
Works on 100% of sites. Zero extra cost. Best for TikTok demos.

Implementation:
- LeadsPage: add two tabs — "By URL" and "Paste Content" (textarea for raw text)
- agent-pipeline-full: accept `rawContent` string in request body, skip crawler step if present
- Show "Content paste mode" in step 1 of pipeline progress

### 2. Optional Firecrawl key in Settings
Let user enter their own Firecrawl API key in Settings page.
If key present → use Firecrawl for scraping. If not → plain fetch fallback.
Firecrawl free tier = 500 pages/month.

### 3. Stripe one-time payment
€97 one-time, 1000 lead credits, never expire.
Top-up: €47 for 500 more credits.
Not needed until first clients validated via DM.

### 4. Landing page
Only after product validated with paying clients.

---

## How To Run Locally
```bash
npm run dev
# visit http://localhost:5173
```

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
