import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Campaign, AgentConfig } from "@/types/database"
import { DEMO_CAMPAIGN, DEMO_AGENT_CONFIGS } from "@/data/seedData"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2, Edit2, Loader2, Database, Sparkles, Key, RefreshCw, ExternalLink, ArrowLeft } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "@/hooks/use-toast"

function buildAgentConfigs(product: string, target: string, language: string) {
  const langLine =
    language === "greek" ? "Γράψε το μήνυμα στα Ελληνικά."
    : language === "english" ? "Write the message in English."
    : "Write in Greek if the business name sounds Greek, otherwise English."

  return [
    {
      agent_type: "scraper",
      model: "gpt-4o-mini",
      system_prompt: `Extract businesses matching this profile: ${target}.

For each business extract:
- company_name: Business name
- industry: Type of business
- location: City or area
- contact_name: Owner or manager name if visible
- email: Email address if visible
- phone: Phone number if visible
- website: Website URL if visible
- source_url: Leave as empty string

Include businesses even with only a name and location — contact data is not required.
Ignore aggregators and directory websites — only real individual businesses.
Return ONLY a valid JSON array. No explanations.`,
    },
    {
      agent_type: "qualifier",
      model: "gpt-4o-mini",
      system_prompt: `Decide if this business matches: ${target}.
ACCEPT if it clearly fits.
REJECT if it's a large chain, unrelated business, or aggregator site.
Return JSON: {"qualified": true/false, "reason": "..."}`,
    },
    {
      agent_type: "enrichment",
      model: "gpt-4o-mini",
      system_prompt: `Organize existing contact data into structured format.
STRICTLY FORBIDDEN: do not invent, guess, or hallucinate any email, phone, or contact name.
Use ONLY data already present in the input.
Return JSON: {"name": "", "role": "", "email": "", "phone": "", "website": "", "source": ""}
If no real data exists, return empty strings.`,
    },
    {
      agent_type: "content",
      model: "gpt-4o",
      system_prompt: `Write a short personalized B2B outreach message.
You are selling: ${product}
You are writing to: ${target}

IMPORTANT: The lead data includes a field "lead_phone" — this is the LEAD'S own phone number, NOT yours. Never use it as your contact number.

Structure:
1. Address the business by name
2. One sentence about their specific situation or pain point that your offer solves
3. One sentence about what you offer and the concrete benefit
4. CTA: end the message with your contact — always write the literal placeholder [ΚΙΝΗΤΟ], never fill it with any real number.

Tone: Friendly, direct, human — not a template, not salesy. 4 sentences max.
${langLine}`,
    },
  ]
}

export default function SettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("")
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [seedingDemo, setSeedingDemo] = useState(false)
  const [showNewCampaign, setShowNewCampaign] = useState(false)

  const [campaignForm, setCampaignForm] = useState({
    name: "",
    description: "",
    target_site: "",
    icp_description: "",
    perplexity_default_query: "",
    crawl_keywords: "",
  })

  // Wizard state
  const [wizard, setWizard] = useState({ product: "", target: "", language: "greek" })

  // API keys (stored locally in browser)
  const [tavilyKey, setTavilyKey] = useState(() => localStorage.getItem("leadflow_tavily_key") || "")
  const [firecrawlKey, setFirecrawlKey] = useState(() => localStorage.getItem("leadflow_firecrawl_key") || "")
  const [googlePlacesKey, setGooglePlacesKey] = useState(() => localStorage.getItem("leadflow_google_places_key") || "")
  const [firecrawlBalance, setFirecrawlBalance] = useState<{ credits: number } | null>(null)
  const [checkingBalance, setCheckingBalance] = useState(false)

  async function checkFirecrawlBalance() {
    const key = firecrawlKey || localStorage.getItem("leadflow_firecrawl_key") || ""
    if (!key) { toast({ title: "Enter your Firecrawl API key first", variant: "destructive" }); return }
    setCheckingBalance(true)
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/account", {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const credits = json?.data?.credits ?? json?.credits ?? null
      if (credits === null) throw new Error("Unexpected response format")
      setFirecrawlBalance({ credits })
    } catch (e) {
      toast({ title: "Could not fetch Firecrawl balance", description: String(e), variant: "destructive" })
    } finally {
      setCheckingBalance(false)
    }
  }

  useEffect(() => {
    if (user) loadCampaigns()
  }, [user])

  useEffect(() => {
    if (selectedCampaignId) {
      loadAgentConfigs()
      const c = campaigns.find(c => c.id === selectedCampaignId)
      if (c) {
        setCampaignForm({
          name: c.name,
          description: c.description || "",
          target_site: c.target_site,
          icp_description: c.icp_description,
          perplexity_default_query: c.perplexity_default_query || "",
          crawl_keywords: c.crawl_keywords?.join(", ") || "",
        })
      }
    }
  }, [selectedCampaignId])

  async function loadCampaigns() {
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
    if (data) {
      setCampaigns(data)
      if (data.length > 0 && !selectedCampaignId) setSelectedCampaignId(data[0].id)
    }
  }

  async function loadAgentConfigs() {
    setLoading(true)
    const { data } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("campaign_id", selectedCampaignId)
    if (data) setAgentConfigs(data)
    setLoading(false)
  }

  async function saveCampaign() {
    if (!selectedCampaignId) return
    setSaving(true)
    const { error } = await supabase
      .from("campaigns")
      .update({
        name: campaignForm.name,
        description: campaignForm.description || null,
        target_site: campaignForm.target_site,
        icp_description: campaignForm.icp_description,
        perplexity_default_query: campaignForm.perplexity_default_query || null,
        crawl_keywords: campaignForm.crawl_keywords
          ? campaignForm.crawl_keywords.split(",").map(k => k.trim()).filter(Boolean)
          : null,
      })
      .eq("id", selectedCampaignId)
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "Campaign saved" })
      loadCampaigns()
    }
    setSaving(false)
  }

  async function createCampaignFromWizard() {
    if (!wizard.product.trim() || !wizard.target.trim()) return
    setSaving(true)

    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        user_id: user!.id,
        name: `${wizard.target} — ${wizard.product}`,
        description: `Find ${wizard.target} and pitch them: ${wizard.product}.`,
        target_site: "Google Maps / paste from any source",
        icp_description: wizard.target,
        is_active: true,
      })
      .select()
      .single()

    if (campErr || !campaign) {
      toast({ title: "Create failed", description: campErr?.message, variant: "destructive" })
      setSaving(false)
      return
    }

    const configs = buildAgentConfigs(wizard.product, wizard.target, wizard.language).map(c => ({
      campaign_id: campaign.id,
      ...c,
    }))

    const { error: configErr } = await supabase.from("agent_configs").insert(configs)
    if (configErr) {
      toast({ title: "Agent configs failed", description: configErr.message, variant: "destructive" })
    } else {
      toast({ title: "Campaign created!", description: "AI prompts generated automatically." })
      setShowNewCampaign(false)
      setWizard({ product: "", target: "", language: "greek" })
      await loadCampaigns()
      setSelectedCampaignId(campaign.id)
    }
    setSaving(false)
  }

  async function deleteCampaign() {
    if (!selectedCampaignId || !confirm("Delete this campaign and all its leads?")) return
    await supabase.from("campaigns").delete().eq("id", selectedCampaignId)
    toast({ title: "Campaign deleted" })
    setSelectedCampaignId("")
    loadCampaigns()
  }

  async function saveAgentConfig(config: AgentConfig) {
    const { error } = await supabase
      .from("agent_configs")
      .upsert(config, { onConflict: "campaign_id,agent_type" })
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" })
    } else {
      toast({ title: `${config.agent_type} config saved` })
    }
  }

  function saveApiKeys() {
    if (tavilyKey) localStorage.setItem("leadflow_tavily_key", tavilyKey)
    else localStorage.removeItem("leadflow_tavily_key")
    if (firecrawlKey) localStorage.setItem("leadflow_firecrawl_key", firecrawlKey)
    else localStorage.removeItem("leadflow_firecrawl_key")
    if (googlePlacesKey) localStorage.setItem("leadflow_google_places_key", googlePlacesKey)
    else localStorage.removeItem("leadflow_google_places_key")
    toast({ title: "API keys saved" })
  }

  async function loadSampleData() {
    if (!confirm("This will create the Greek Hotel Direct Booking Leads demo campaign. Continue?")) return
    setSeedingDemo(true)

    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({ user_id: user!.id, ...DEMO_CAMPAIGN })
      .select()
      .single()

    if (campErr || !campaign) {
      toast({ title: "Seed failed", description: campErr?.message, variant: "destructive" })
      setSeedingDemo(false)
      return
    }

    const configs = DEMO_AGENT_CONFIGS.map(c => ({
      campaign_id: campaign.id,
      agent_type: c.agent_type,
      model: c.model,
      system_prompt: c.system_prompt,
    }))

    const { error: configErr } = await supabase.from("agent_configs").insert(configs)
    if (configErr) {
      toast({ title: "Agent configs failed", description: configErr.message, variant: "destructive" })
    } else {
      toast({ title: "Demo campaign loaded!", description: "Greek Hotel Direct Booking Leads is ready." })
      await loadCampaigns()
      setSelectedCampaignId(campaign.id)
    }
    setSeedingDemo(false)
  }

  const AGENT_TYPES = ["scraper", "qualifier", "enrichment", "content"]

  function getConfig(type: string) {
    return agentConfigs.find(c => c.agent_type === type) || {
      id: "",
      campaign_id: selectedCampaignId,
      agent_type: type,
      instance_name: null,
      model: "gpt-4o-mini",
      system_prompt: "",
    }
  }

  const wizardReady = wizard.product.trim().length > 2 && wizard.target.trim().length > 2

  return (
    <div className="p-4 md:p-6 space-y-6 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={loadSampleData} disabled={seedingDemo}>
            {seedingDemo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Load Sample Data
          </Button>
          <Button onClick={() => { setShowNewCampaign(true); setWizard({ product: "", target: "", language: "greek" }) }}>
            <Plus className="h-4 w-4 mr-2" /> New Campaign
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Campaign list */}
        <div className="w-full lg:w-64 space-y-1 shrink-0">
          <p className="text-xs font-medium text-muted-foreground uppercase px-2 pb-1">Campaigns</p>
          {campaigns.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">No campaigns yet</div>
          ) : (
            campaigns.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedCampaignId(c.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedCampaignId === c.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))
          )}
        </div>

        {/* Campaign detail */}
        {selectedCampaignId ? (
          <div className="flex-1">
            <Tabs defaultValue="campaign">
              <TabsList>
                <TabsTrigger value="campaign">Campaign</TabsTrigger>
                <TabsTrigger value="agents">Agent Configs</TabsTrigger>
              </TabsList>

              <TabsContent value="campaign" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Campaign Settings</CardTitle>
                    <CardDescription>Configure your campaign's targeting and ICP</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Campaign Name</Label>
                        <Input
                          value={campaignForm.name}
                          onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Target Site</Label>
                        <Input
                          value={campaignForm.target_site}
                          onChange={e => setCampaignForm(p => ({ ...p, target_site: e.target.value }))}
                          placeholder="e.g. Google Maps, LinkedIn"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={campaignForm.description}
                        onChange={e => setCampaignForm(p => ({ ...p, description: e.target.value }))}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ICP Description</Label>
                      <Textarea
                        value={campaignForm.icp_description}
                        onChange={e => setCampaignForm(p => ({ ...p, icp_description: e.target.value }))}
                        placeholder="Describe your ideal customer profile..."
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Crawl Keywords (comma-separated)</Label>
                      <Input
                        value={campaignForm.crawl_keywords}
                        onChange={e => setCampaignForm(p => ({ ...p, crawl_keywords: e.target.value }))}
                        placeholder="keyword1, keyword2, ..."
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={saveCampaign} disabled={saving}>
                        {saving ? "Saving..." : "Save Campaign"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={deleteCampaign}>
                        <Trash2 className="h-4 w-4 mr-1" /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="agents" className="mt-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  AGENT_TYPES.map(agentType => {
                    const config = getConfig(agentType)
                    return (
                      <AgentConfigCard
                        key={`${selectedCampaignId}-${agentType}`}
                        config={config as AgentConfig}
                        onSave={saveAgentConfig}
                      />
                    )
                  })
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a campaign or create a new one
          </div>
        )}
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">API Keys</CardTitle>
          </div>
          <CardDescription className="text-xs">Stored locally in your browser — never sent to our servers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tavily API Key</Label>
              <Input
                value={tavilyKey}
                onChange={e => setTavilyKey(e.target.value)}
                placeholder="tvly-..."
                type="password"
              />
              <p className="text-xs text-muted-foreground">Powers "AI Search" mode on Leads page. Free at tavily.com (1,000 searches/month).</p>
            </div>
            <div className="space-y-2">
              <Label>Firecrawl API Key <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <div className="flex gap-2">
                <Input
                  value={firecrawlKey}
                  onChange={e => { setFirecrawlKey(e.target.value); setFirecrawlBalance(null) }}
                  placeholder="fc-..."
                  type="password"
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={checkFirecrawlBalance} disabled={checkingBalance} className="shrink-0">
                  {checkingBalance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">Balance</span>
                </Button>
              </div>
              {firecrawlBalance !== null && (
                <div className={`flex items-center justify-between text-xs rounded px-3 py-1.5 ${firecrawlBalance.credits < 50 ? "bg-red-900/30 text-red-400" : firecrawlBalance.credits < 150 ? "bg-amber-900/30 text-amber-400" : "bg-green-900/30 text-green-400"}`}>
                  <span><strong>{firecrawlBalance.credits}</strong> credits remaining (1 credit = 1 URL scraped)</span>
                  <a href="https://www.firecrawl.dev/app/usage" target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:underline ml-2">
                    Dashboard <ExternalLink className="h-3 w-3 ml-0.5" />
                  </a>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Enables scraping of JS-rendered pages in URL mode. Free tier: 500 pages/month. Each URL = 1 credit.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Google Places API Key <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input
              value={googlePlacesKey}
              onChange={e => setGooglePlacesKey(e.target.value)}
              placeholder="AIza..."
              type="password"
            />
            <p className="text-xs text-muted-foreground">
              Auto-fetches phone &amp; address from Google Maps for leads missing contact info. Works on every campaign. Google gives $200/month free credit (~11,000 lookups). Get a key at <strong>console.cloud.google.com</strong> → enable "Places API (New)".
            </p>
          </div>
          <Button size="sm" onClick={saveApiKeys}>Save API Keys</Button>
        </CardContent>
      </Card>

      {/* New Campaign Wizard Dialog */}
      <Dialog open={showNewCampaign} onOpenChange={setShowNewCampaign}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              New Campaign
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <p className="text-sm text-muted-foreground">
              Answer 2 questions — the AI prompts are generated automatically.
            </p>

            <div className="space-y-2">
              <Label>What are you selling?</Label>
              <Input
                value={wizard.product}
                onChange={e => setWizard(p => ({ ...p, product: e.target.value }))}
                placeholder="e.g. websites για ξενοδοχεία, social media management, λογιστικές υπηρεσίες"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Who are you targeting?</Label>
              <Input
                value={wizard.target}
                onChange={e => setWizard(p => ({ ...p, target: e.target.value }))}
                placeholder="e.g. ξενοδοχεία στην Ελλάδα, dentists in Athens, freelance photographers"
              />
            </div>

            <div className="space-y-2">
              <Label>Outreach language</Label>
              <Select value={wizard.language} onValueChange={v => setWizard(p => ({ ...p, language: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="greek">Greek</SelectItem>
                  <SelectItem value="english">English</SelectItem>
                  <SelectItem value="auto">Auto (Greek name → Greek, otherwise English)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {wizardReady && (
              <div className="rounded-lg bg-muted/60 border px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-sm">Will be created:</p>
                <p>Campaign: <span className="text-foreground font-medium">"{wizard.target} — {wizard.product}"</span></p>
                <p>4 AI agents auto-configured (scraper, qualifier, enrichment, outreach)</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCampaign(false)}>Cancel</Button>
            <Button
              onClick={createCampaignFromWizard}
              disabled={saving || !wizardReady}
            >
              {saving
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                : <><Sparkles className="h-4 w-4 mr-2" /> Generate & Create</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AgentConfigCard({ config, onSave }: { config: AgentConfig; onSave: (c: AgentConfig) => void }) {
  const [form, setForm] = useState({ model: config.model, system_prompt: config.system_prompt })
  const [saving, setSaving] = useState(false)

  const agentLabels: Record<string, { title: string; desc: string }> = {
    scraper: { title: "Scraper Agent", desc: "Extracts lead data from crawled pages" },
    qualifier: { title: "Qualifier Agent", desc: "Decides if a lead is worth pursuing" },
    enrichment: { title: "Enrichment Agent", desc: "Organizes contact data into structured format" },
    content: { title: "Content Agent", desc: "Writes personalized outreach messages" },
  }

  const info = agentLabels[config.agent_type] || { title: config.agent_type, desc: "" }

  async function handleSave() {
    setSaving(true)
    await onSave({ ...config, model: form.model, system_prompt: form.system_prompt })
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Edit2 className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">{info.title}</CardTitle>
        </div>
        <CardDescription className="text-xs">{info.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Select value={form.model} onValueChange={v => setForm(p => ({ ...p, model: v }))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</SelectItem>
              <SelectItem value="gpt-4o">gpt-4o (quality)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">System Prompt</Label>
          <Textarea
            value={form.system_prompt}
            onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
            rows={5}
            className="text-xs font-mono"
          />
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  )
}
