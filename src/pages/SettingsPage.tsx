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
import { Plus, Trash2, Edit2, Loader2, Database } from "lucide-react"
import { toast } from "@/hooks/use-toast"

export default function SettingsPage() {
  const { user } = useAuth()
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

  async function createCampaign() {
    setSaving(true)
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        user_id: user!.id,
        name: campaignForm.name,
        description: campaignForm.description || null,
        target_site: campaignForm.target_site,
        icp_description: campaignForm.icp_description,
        perplexity_default_query: campaignForm.perplexity_default_query || null,
        crawl_keywords: campaignForm.crawl_keywords
          ? campaignForm.crawl_keywords.split(",").map(k => k.trim()).filter(Boolean)
          : null,
      })
      .select()
      .single()
    if (error) {
      toast({ title: "Create failed", description: error.message, variant: "destructive" })
    } else if (data) {
      toast({ title: "Campaign created" })
      setShowNewCampaign(false)
      setCampaignForm({ name: "", description: "", target_site: "", icp_description: "", perplexity_default_query: "", crawl_keywords: "" })
      await loadCampaigns()
      setSelectedCampaignId(data.id)
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

  async function loadSampleData() {
    if (!confirm("This will create the Athens Corporate Catering Leads demo campaign. Continue?")) return
    setSeedingDemo(true)

    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        user_id: user!.id,
        ...DEMO_CAMPAIGN,
      })
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
      toast({ title: "Demo campaign loaded!", description: "Athens Corporate Catering Leads is ready." })
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadSampleData} disabled={seedingDemo}>
            {seedingDemo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Load Sample Data
          </Button>
          <Button onClick={() => { setShowNewCampaign(true); setCampaignForm({ name: "", description: "", target_site: "", icp_description: "", perplexity_default_query: "", crawl_keywords: "" }) }}>
            <Plus className="h-4 w-4 mr-2" /> New Campaign
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Campaign list */}
        <div className="w-64 space-y-1">
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
                    <div className="grid grid-cols-2 gap-4">
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
                      <Label>Perplexity Query</Label>
                      <Textarea
                        value={campaignForm.perplexity_default_query}
                        onChange={e => setCampaignForm(p => ({ ...p, perplexity_default_query: e.target.value }))}
                        placeholder="Use | to separate multiple queries..."
                        rows={3}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">Separate multiple queries with | — each runs in parallel</p>
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
                        key={agentType}
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

      {/* New Campaign Dialog */}
      <Dialog open={showNewCampaign} onOpenChange={setShowNewCampaign}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Campaign Name *</Label>
              <Input
                value={campaignForm.name}
                onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Athens Restaurant Leads"
              />
            </div>
            <div className="space-y-2">
              <Label>Target Site *</Label>
              <Input
                value={campaignForm.target_site}
                onChange={e => setCampaignForm(p => ({ ...p, target_site: e.target.value }))}
                placeholder="Google Maps, LinkedIn, etc."
              />
            </div>
            <div className="space-y-2">
              <Label>ICP Description *</Label>
              <Textarea
                value={campaignForm.icp_description}
                onChange={e => setCampaignForm(p => ({ ...p, icp_description: e.target.value }))}
                placeholder="Describe your ideal customer..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCampaign(false)}>Cancel</Button>
            <Button onClick={createCampaign} disabled={saving || !campaignForm.name || !campaignForm.target_site}>
              {saving ? "Creating..." : "Create Campaign"}
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
