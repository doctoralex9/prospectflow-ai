-- Rate limiting table for edge function calls
CREATE TABLE public.api_rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX ON public.api_rate_limits (user_id, function_name, created_at);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access api_rate_limits" ON public.api_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
