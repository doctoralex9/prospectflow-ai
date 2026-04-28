import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { AgentConfig } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Edit2, Loader2, Key, ArrowLeft } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "@/hooks/use-toast"
import StarField from "@/components/StarField"

export default function SettingsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [campaignId, setCampaignId] = useState<string>("")
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(false)

  const [tavilyKey, setTavilyKey] = useState(() => localStorage.getItem("leadflow_tavily_key") || "")
  const [googlePlacesKey, setGooglePlacesKey] = useState(() => localStorage.getItem("leadflow_google_places_key") || "")

  useEffect(() => {
    if (user) loadCampaign()
  }, [user])

  useEffect(() => {
    if (campaignId) loadAgentConfigs()
  }, [campaignId])

  async function loadCampaign() {
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", user!.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
    if (data) setCampaignId(data.id)
  }

  async function loadAgentConfigs() {
    setLoading(true)
    const { data } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("campaign_id", campaignId)
    if (data) setAgentConfigs(data)
    setLoading(false)
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
    if (googlePlacesKey) localStorage.setItem("leadflow_google_places_key", googlePlacesKey)
    else localStorage.removeItem("leadflow_google_places_key")
    toast({ title: "API keys saved" })
  }

  function getConfig(type: string): AgentConfig {
    return agentConfigs.find(c => c.agent_type === type) || {
      id: "",
      campaign_id: campaignId,
      agent_type: type,
      instance_name: null,
      model: "gpt-4o-mini",
      system_prompt: "",
    }
  }

  const AGENT_TYPES = ["scraper", "qualifier", "enrichment", "content"]

  return (
    <>
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <StarField />
      </div>
      <div className="relative p-4 md:p-6 space-y-6 page-enter" style={{ zIndex: 10 }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-bold">Settings</h1>
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
                <Label>Tavily API Key <span className="text-destructive">*</span></Label>
                <Input
                  value={tavilyKey}
                  onChange={e => setTavilyKey(e.target.value)}
                  placeholder="tvly-..."
                  type="password"
                />
                <p className="text-xs text-muted-foreground">Required for AI Search. Free at tavily.com (1,000 searches/month).</p>
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
                  Auto-fetches phone from Google Maps for leads without contact info. Google gives $200/month free credit (~11,000 lookups). Enable "Places API (New)" at console.cloud.google.com.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={saveApiKeys}>Save API Keys</Button>
          </CardContent>
        </Card>

        {/* Agent Prompts */}
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Agent Prompts</h2>
            <p className="text-sm text-muted-foreground mt-0.5">The AI instructions used at each pipeline step.</p>
          </div>
          {loading || !campaignId ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            AGENT_TYPES.map(agentType => (
              <AgentConfigCard
                key={`${campaignId}-${agentType}`}
                config={getConfig(agentType)}
                onSave={saveAgentConfig}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

function AgentConfigCard({ config, onSave }: { config: AgentConfig; onSave: (c: AgentConfig) => void }) {
  const [form, setForm] = useState({ model: config.model, system_prompt: config.system_prompt })
  const [saving, setSaving] = useState(false)

  const agentLabels: Record<string, { title: string; desc: string }> = {
    scraper: { title: "Scraper Agent", desc: "Extracts lead data from crawled pages" },
    qualifier: { title: "Qualifier Agent", desc: "Decides if a lead is worth pursuing" },
    enrichment: { title: "Enrichment Agent", desc: "Organizes contact data into structured format" },
    content: { title: "Content Agent", desc: "Writes personalized outreach messages using social media gaps" },
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
            rows={6}
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
