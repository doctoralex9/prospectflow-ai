# LeadFlow AI

AI-powered B2B lead generation platform with a 6-step automated pipeline.

## Stack
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Supabase (PostgreSQL + Edge Functions / Deno)
- AI: OpenAI (gpt-4o-mini / gpt-4o), Perplexity AI, Firecrawl, Apollo.io

## Setup

### 1. Supabase Project
1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/migrations/20240101000000_initial_schema.sql` in the SQL editor
3. Deploy edge functions (see below)

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your values:
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 3. Edge Function Secrets
In Supabase Dashboard → Settings → Edge Functions → Secrets, add:
- `OPENAI_API_KEY`
- `PERPLEXITY_API_KEY`
- `FIRECRAWL_KEY`
- `APOLLO_API_KEY`

### 4. Deploy Edge Functions
```bash
supabase functions deploy agent-pipeline-full
supabase functions deploy agent-outreach
supabase functions deploy agent-chat
```

### 5. Run Frontend
```bash
npm install
npm run dev
```

## Pipeline (6 Steps)
1. **DiscoveryAgent** — Finds URLs via Perplexity citations
2. **CrawlerAgent** — Scrapes pages via Firecrawl (fetch fallback)
3. **FilterAgent** — Pass-through (Perplexity pre-filters)
4. **QualifierAgent** — Extracts leads via OpenAI
5. **EnrichmentAgent** — 4-level enrichment (scraper → Apollo → Perplexity → not_found)
6. **PersistenceAgent** — Upserts leads, triggers outreach generation

## Pages
- `/` — Dashboard with stats and charts
- `/leads` — Lead pipeline runner + table + detail modal + export
- `/settings` — Campaign CRUD + agent config editor + sample data loader
- `/auth` — Email/password auth
- `/chat` — AI assistant chat
