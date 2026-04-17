-- Campaigns
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  target_site text NOT NULL,
  icp_description text NOT NULL,
  perplexity_default_query text,
  crawl_keywords text[],
  system_prompt text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Agent configs (LLM model + system prompt per agent type per campaign)
CREATE TABLE public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  agent_type text NOT NULL, -- scraper | qualifier | enrichment | content
  instance_name text,
  model text DEFAULT 'gpt-4o-mini',
  system_prompt text NOT NULL,
  UNIQUE(campaign_id, agent_type)
);

-- Leads
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  company_name text,
  contact_name text,
  contact_role text,
  email text,
  phone text,
  source_url text,
  raw_data jsonb,
  qualified boolean DEFAULT false,
  qualification_reason text,
  enriched_data jsonb,
  outreach_message text,
  lead_category text,
  enrichment_source text,
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(campaign_id, company_name, source_url)
);

-- Pipeline run history
CREATE TABLE public.scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  target_url text NOT NULL,
  status text DEFAULT 'pending',
  pages_scraped int DEFAULT 0,
  pages_rejected int DEFAULT 0,
  leads_found int DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Chat memory
CREATE TABLE public.agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  agent_type text NOT NULL,
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  agent_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- User policies
CREATE POLICY "Users manage own campaigns" ON public.campaigns FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own agent_configs" ON public.agent_configs FOR ALL USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = agent_configs.campaign_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = agent_configs.campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "Users manage own leads" ON public.leads FOR ALL USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = leads.campaign_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = leads.campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "Users manage own scrape_jobs" ON public.scrape_jobs FOR ALL USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = scrape_jobs.campaign_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = scrape_jobs.campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "Users manage own agent_memory" ON public.agent_memory FOR ALL USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = agent_memory.campaign_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = agent_memory.campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "Users manage own chat_sessions" ON public.chat_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own chat_messages" ON public.chat_messages FOR ALL USING (EXISTS (SELECT 1 FROM public.chat_sessions cs WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sessions cs WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid()));

-- Service role (for edge functions)
CREATE POLICY "Service role full access campaigns" ON public.campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access agent_configs" ON public.agent_configs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access leads" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access scrape_jobs" ON public.scrape_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access agent_memory" ON public.agent_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access chat_sessions" ON public.chat_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access chat_messages" ON public.chat_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
