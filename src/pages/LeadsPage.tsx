import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Campaign, Lead } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Play, Download, Search, CheckCircle2, Circle, Loader2,
  Mail, Phone, Globe, MapPin, User, Building2, X, Link, ChevronDown, ChevronUp, Copy, Check, Trash2, ArrowLeft
} from "lucide-react"
import * as XLSX from "xlsx"
import { toast } from "@/hooks/use-toast"
import StarField from "@/components/StarField"
import RegressionCanvas from "@/components/RegressionCanvas"

interface PipelineStep {
  step: number
  name: string
  status: "pending" | "running" | "done" | "error"
  message: string
}

const INITIAL_STEPS: PipelineStep[] = [
  { step: 1, name: "URL Input", status: "pending", message: "User-provided URLs" },
  { step: 2, name: "Crawler", status: "pending", message: "Scrape pages" },
  { step: 3, name: "Filter", status: "pending", message: "Filter relevant content" },
  { step: 4, name: "Extractor", status: "pending", message: "Extract leads with AI" },
  { step: 5, name: "Enrichment", status: "pending", message: "Organize contact data" },
  { step: 6, name: "Save", status: "pending", message: "Save to database" },
]


export default function LeadsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS.map(s => ({ ...s })))
  const [showPipeline, setShowPipeline] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [editingNotes, setEditingNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [inputMode, setInputMode] = useState<"url" | "paste" | "search">("url")
  const [pasteContent, setPasteContent] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [errorCopied, setErrorCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (user) loadCampaigns()
  }, [user])

  useEffect(() => {
    if (selectedCampaignId) {
      loadLeads()
      const campaign = campaigns.find(c => c.id === selectedCampaignId)
      if (campaign?.perplexity_default_query && !searchQuery) {
        setSearchQuery(campaign.perplexity_default_query)
      }
    }
  }, [selectedCampaignId])

  useEffect(() => {
    let result = leads
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.company_name?.toLowerCase().includes(q) ||
        l.contact_name?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        (l.raw_data as Record<string, unknown>)?.location?.toString().toLowerCase().includes(q)
      )
    }
    setFilteredLeads(result)
  }, [leads, search])

  async function loadCampaigns() {
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", user!.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
    if (data) {
      setCampaigns(data)
      if (data.length > 0 && !selectedCampaignId) setSelectedCampaignId(data[0].id)
    }
  }

  async function loadLeads() {
    setLoading(true)
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", selectedCampaignId)
      .order("created_at", { ascending: false })
    if (data) setLeads(data)
    setLoading(false)
  }

  function parseUrls(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map(u => u.trim())
      .filter(u => u.startsWith("http://") || u.startsWith("https://"))
  }

  async function startPipeline() {
    if (!selectedCampaignId) {
      toast({ title: "No campaign selected", variant: "destructive" })
      return
    }

    const urls = parseUrls(urlInput)
    if (inputMode === "url" && urls.length === 0) {
      toast({ title: "No valid URLs", description: "Paste at least one URL starting with http:// or https://", variant: "destructive" })
      return
    }
    if (inputMode === "paste" && !pasteContent.trim()) {
      toast({ title: "No content", description: "Paste some text content first", variant: "destructive" })
      return
    }
    if (inputMode === "search" && !searchQuery.trim()) {
      toast({ title: "No search query", description: "Describe what businesses you're looking for", variant: "destructive" })
      return
    }
    const tavilyKey = localStorage.getItem("leadflow_tavily_key") || ""
    if (inputMode === "search" && !tavilyKey) {
      toast({ title: "Tavily API key not set", description: "Add it in Settings → API Keys", variant: "destructive" })
      return
    }

    setPipelineRunning(true)
    setShowPipeline(true)
    setSteps(INITIAL_STEPS.map(s => ({ ...s })))
    setPipelineError(null)

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token || supabaseKey

    abortRef.current = new AbortController()

    fetch(`${supabaseUrl}/functions/v1/agent-pipeline-full`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        campaign_id: selectedCampaignId,
        user_id: user?.id,
        ...(inputMode === "url" && { urls, firecrawlKey: localStorage.getItem("leadflow_firecrawl_key") || undefined }),
        ...(inputMode === "paste" && { rawContent: pasteContent }),
        ...(inputMode === "search" && { searchQuery, tavilyKey }),
        googlePlacesKey: localStorage.getItem("leadflow_google_places_key") || undefined,
      }),
      signal: abortRef.current.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text()
        setPipelineError(`HTTP ${response.status}\n${text}`)
        setPipelineRunning(false)
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() || ""

        for (const event of events) {
          const lines = event.split("\n")
          let eventType = "message"
          let data = ""
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7)
            if (line.startsWith("data: ")) data = line.slice(6)
          }
          if (!data) continue
          try {
            const parsed = JSON.parse(data)
            if (eventType === "step") {
              setSteps(prev => prev.map(s => s.step === parsed.step ? { ...s, status: parsed.status, message: parsed.message } : s))
            } else if (eventType === "complete") {
              const creditNote = parsed.firecrawl_credits_used > 0 ? ` · ${parsed.firecrawl_credits_used} Firecrawl credit${parsed.firecrawl_credits_used !== 1 ? "s" : ""} used` : ""
              toast({ title: `Done! Found ${parsed.total_leads} leads.`, description: creditNote ? `Check Settings → API Keys to see remaining balance${creditNote}` : undefined })
              setPipelineRunning(false)
              loadLeads()
            } else if (eventType === "error") {
              setPipelineError(parsed.message)
              setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s))
              setPipelineRunning(false)
            }
          } catch { /* ignore parse errors */ }
        }
      }
      setPipelineRunning(false)
    }).catch((e) => {
      if (e.name !== "AbortError") {
        setPipelineError(String(e))
        setPipelineRunning(false)
      }
    })
  }

  function stopPipeline() {
    abortRef.current?.abort()
    setPipelineRunning(false)
  }

  async function saveNotes() {
    if (!selectedLead) return
    setSavingNotes(true)
    await supabase.from("leads").update({ notes: editingNotes }).eq("id", selectedLead.id)
    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: editingNotes } : l))
    setSelectedLead(prev => prev ? { ...prev, notes: editingNotes } : null)
    setSavingNotes(false)
    toast({ title: "Notes saved" })
  }

  async function deleteLead(leadId: string) {
    if (!confirm("Delete this lead? This cannot be undone.")) return
    await supabase.from("leads").delete().eq("id", leadId)
    setLeads(prev => prev.filter(l => l.id !== leadId))
    if (selectedLead?.id === leadId) setSelectedLead(null)
    toast({ title: "Lead deleted" })
  }

  async function deleteAllLeads() {
    if (!selectedCampaignId || leads.length === 0) return
    const count = leads.length
    if (!confirm(`Delete all ${count} lead${count !== 1 ? "s" : ""} in this campaign? This cannot be undone.`)) return
    await supabase.from("leads").delete().eq("campaign_id", selectedCampaignId)
    setLeads([])
    toast({ title: `Deleted ${count} lead${count !== 1 ? "s" : ""}`, variant: "destructive" })
  }

  function exportLeads() {
    const data = filteredLeads.map(l => ({
      "Company": l.company_name,
      "Contact": l.contact_name,
      "Role": l.contact_role,
      "Email": l.email,
      "Phone": l.phone,
      "Category": l.lead_category,
      "Enrichment Source": l.enrichment_source,
      "Source URL": l.source_url,
      "Outreach Message": l.outreach_message,
      "Notes": l.notes,
      "Created": l.created_at,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Leads")
    XLSX.writeFile(wb, "leadflow-leads.xlsx")
  }

  const completedSteps = steps.filter(s => s.status === "done").length
  const progressPct = (completedSteps / 6) * 100
  const parsedUrlCount = parseUrls(urlInput).length

  return (
    <>
      {/* Fixed star field behind everything */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <StarField />
      </div>
      {/* Live regression canvas — lights up while pipeline runs */}
      <RegressionCanvas active={pipelineRunning} />
      <div className="relative p-4 md:p-6 space-y-4 md:space-y-6 page-enter" style={{ zIndex: 10 }}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Leads</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Paste URLs, run the pipeline, get contacts</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Select campaign..." />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportLeads} disabled={filteredLeads.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button variant="destructive" onClick={deleteAllLeads} disabled={leads.length === 0}>
            <Trash2 className="h-4 w-4 mr-2" /> Delete All
          </Button>
        </div>
      </div>

      {/* URL Input Card */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
              <button
                onClick={() => { setInputMode("url"); setShowUrlInput(true) }}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded font-medium transition-colors ${inputMode === "url" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Link className="h-3.5 w-3.5" /> By URL
              </button>
              <button
                onClick={() => { setInputMode("paste"); setShowUrlInput(true) }}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded font-medium transition-colors ${inputMode === "paste" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Paste Content
              </button>
              <button
                onClick={() => { setInputMode("search"); setShowUrlInput(true) }}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded font-medium transition-colors ${inputMode === "search" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Search className="h-3.5 w-3.5" /> AI Search
              </button>
            </div>
            <button onClick={() => setShowUrlInput(p => !p)} className="text-muted-foreground hover:text-foreground">
              {showUrlInput ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </CardHeader>
        {showUrlInput && (
          <CardContent className="space-y-3">
            {inputMode === "url" ? (
              <Textarea
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder={"https://www.example.com/businesses\nhttps://directory.gr/category\n\nOne URL per line — any public business directory or listing page"}
                rows={4}
                className="font-mono text-xs resize-none"
                disabled={pipelineRunning}
              />
            ) : inputMode === "paste" ? (
              <Textarea
                value={pasteContent}
                onChange={e => setPasteContent(e.target.value)}
                placeholder={"Paste from anywhere:\n• Google Maps → search your target → Ctrl+A → Ctrl+C\n• Any business directory page → Ctrl+A → Ctrl+C\n• A company's website → Ctrl+A → Ctrl+C\n• LinkedIn search results, Instagram bios, etc.\n\nThe AI extracts business names, emails, phones, and websites."}
                rows={6}
                className="text-xs resize-none"
                disabled={pipelineRunning}
              />
            ) : (
              <div className="space-y-2">
                {!localStorage.getItem("leadflow_tavily_key") && (
                  <p className="text-xs text-amber-500 bg-amber-950/40 border border-amber-800/40 rounded px-3 py-2">
                    Tavily API key not set. Go to <strong>Settings → API Keys</strong> to add it (free at tavily.com).
                  </p>
                )}
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="e.g. catering companies Athens, dentists in Thessaloniki, hotels in Crete..."
                  disabled={pipelineRunning}
                />
                {(() => {
                  const campaign = campaigns.find(c => c.id === selectedCampaignId)
                  if (!campaign) return null
                  const suggestions = [
                    campaign.perplexity_default_query,
                    campaign.icp_description ? `${campaign.icp_description} Greece` : null,
                    campaign.target_site ? `site:${campaign.target_site} businesses` : null,
                  ].filter(Boolean) as string[]
                  return (
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Search guide for <span className="text-foreground">{campaign.name}</span></p>
                      {campaign.icp_description && (
                        <p className="text-xs text-muted-foreground">Target: {campaign.icp_description}</p>
                      )}
                      {suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => setSearchQuery(s)}
                              className="text-xs bg-background border border-border rounded px-2 py-0.5 hover:border-primary hover:text-primary transition-colors text-left"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground/70">Tip: add a city for better results — e.g. "dentists Athens", "hotels Crete"</p>
                    </div>
                  )
                })()}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  {inputMode === "url"
                    ? "One URL per line • up to 20 URLs per run • public pages only"
                    : inputMode === "paste"
                    ? "Paste raw text from any page • AI will extract leads from it"
                    : "Tavily finds relevant pages • AI extracts business leads from them"}
                </p>
                {inputMode === "url" && parsedUrlCount > 0 && localStorage.getItem("leadflow_firecrawl_key") && (
                  <span className="text-xs bg-amber-900/30 text-amber-400 rounded px-2 py-0.5 shrink-0">
                    ~{parsedUrlCount} Firecrawl credit{parsedUrlCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {pipelineRunning ? (
                <Button variant="outline" onClick={stopPipeline} size="sm">
                  <X className="h-3.5 w-3.5 mr-1.5" /> Stop
                </Button>
              ) : (
                <Button
                  onClick={startPipeline}
                  disabled={!selectedCampaignId || (
                    inputMode === "url" ? parsedUrlCount === 0
                    : inputMode === "paste" ? !pasteContent.trim()
                    : !searchQuery.trim() || !localStorage.getItem("leadflow_tavily_key")
                  )}
                  size="sm"
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {inputMode === "search" ? "Search & Run"
                    : inputMode === "url" && parsedUrlCount > 0 ? `Run Pipeline (${parsedUrlCount})`
                    : "Run Pipeline"}
                </Button>
              )}
            </div>
          </CardContent>
        )}
        {!showUrlInput && (
          <CardContent className="pt-0 pb-4">
            <div className="flex items-center gap-3">
              {pipelineRunning ? (
                <Button variant="outline" onClick={stopPipeline} size="sm">
                  <X className="h-3.5 w-3.5 mr-1.5" /> Stop Pipeline
                </Button>
              ) : (
                <Button
                  onClick={() => { setShowUrlInput(true); }}
                  disabled={!selectedCampaignId}
                  size="sm"
                  variant={(parsedUrlCount > 0 || (inputMode === "search" && !!searchQuery.trim())) ? "default" : "outline"}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {inputMode === "search" && searchQuery.trim() ? `Search & Run`
                    : parsedUrlCount > 0 ? `Run Pipeline (${parsedUrlCount} URLs)`
                    : inputMode === "search" ? "Enter Search Query"
                    : "Add URLs & Run"}
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Pipeline Progress */}
      {showPipeline && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Pipeline Progress</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{completedSteps}/6 steps</span>
                {!pipelineRunning && (
                  <button onClick={() => setShowPipeline(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {steps.map(step => (
                <div key={step.step} className="flex items-start gap-2">
                  {step.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />}
                  {step.status === "running" && <Loader2 className="h-4 w-4 text-primary mt-0.5 shrink-0 animate-spin" />}
                  {step.status === "pending" && <Circle className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />}
                  {step.status === "error" && <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
                  <div>
                    <p className={`text-xs font-medium ${step.status === "pending" ? "text-muted-foreground" : ""}`}>{step.name}</p>
                    <p className="text-xs text-muted-foreground leading-tight">{step.message}</p>
                  </div>
                </div>
              ))}
            </div>
            {pipelineError && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-destructive">Error</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(pipelineError)
                      setErrorCopied(true)
                      setTimeout(() => setErrorCopied(false), 2000)
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {errorCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    {errorCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-all font-mono select-all">{pipelineError}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, contact, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">{filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Leads Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <Building2 className="h-10 w-10 mx-auto opacity-20" />
          <p className="text-sm">
            {selectedCampaignId
              ? "No leads yet — paste URLs above and run the pipeline."
              : "Select a campaign to view leads."}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-muted-foreground">Company</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Contact</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                <th className="w-10 p-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredLeads.map(lead => (
                <tr
                  key={lead.id}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => { setSelectedLead(lead); setEditingNotes(lead.notes || "") }}
                >
                  <td className="p-3">
                    <div className="font-medium">{lead.company_name || "—"}</div>
                    {lead.lead_category && (
                      <div className="text-xs text-muted-foreground mt-0.5">{lead.lead_category}</div>
                    )}
                  </td>
                  <td className="p-3">
                    <div>{lead.contact_name || "—"}</div>
                    {lead.contact_role && (
                      <div className="text-xs text-muted-foreground mt-0.5">{lead.contact_role}</div>
                    )}
                  </td>
                  <td className="p-3">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-primary hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {lead.phone || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3">
                    {lead.enrichment_source && (
                      <Badge
                        variant={
                          lead.enrichment_source === "no-website" ? "destructive"
                          : lead.enrichment_source === "outdated-website" ? "warning"
                          : lead.enrichment_source === "scraper" ? "success"
                          : lead.enrichment_source === "google-maps" ? "default"
                          : "outline"
                        }
                        className="text-xs"
                      >
                        {lead.enrichment_source === "no-website" ? "no website"
                          : lead.enrichment_source === "outdated-website" ? "outdated site"
                          : lead.enrichment_source === "google-maps" ? "Google Maps"
                          : lead.enrichment_source}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => deleteLead(lead.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10"
                      title="Delete lead"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Lead Detail Modal */}
      <Dialog open={!!selectedLead} onOpenChange={open => !open && setSelectedLead(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {selectedLead?.company_name || "Lead Details"}
            </DialogTitle>
          </DialogHeader>

          {selectedLead && (
            <div className="space-y-5">
              {/* Contact grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {selectedLead.contact_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{selectedLead.contact_name}</span>
                    {selectedLead.contact_role && (
                      <span className="text-muted-foreground">· {selectedLead.contact_role}</span>
                    )}
                  </div>
                )}
                {selectedLead.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={`mailto:${selectedLead.email}`} className="text-primary hover:underline">
                      {selectedLead.email}
                    </a>
                  </div>
                )}
                {selectedLead.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{selectedLead.phone}</span>
                  </div>
                )}
                {selectedLead.source_url && (
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={selectedLead.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate"
                    >
                      {selectedLead.source_url}
                    </a>
                  </div>
                )}
                {!!(selectedLead.raw_data as Record<string, unknown>)?.location && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{String((selectedLead.raw_data as Record<string, unknown>).location)}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="flex gap-2 flex-wrap">
                {selectedLead.enrichment_source && (
                  <Badge
                    variant={
                      selectedLead.enrichment_source === "no-website" ? "destructive"
                      : selectedLead.enrichment_source === "outdated-website" ? "warning"
                      : selectedLead.enrichment_source === "scraper" ? "success"
                      : "outline"
                    }
                  >
                    {selectedLead.enrichment_source === "no-website" ? "no website"
                      : selectedLead.enrichment_source === "outdated-website" ? "outdated site"
                      : selectedLead.enrichment_source}
                  </Badge>
                )}
                {selectedLead.lead_category && (
                  <Badge variant="secondary">{selectedLead.lead_category}</Badge>
                )}
              </div>

              {/* Google Maps shortcut — shown when no contact info found */}
              {!selectedLead.email && !selectedLead.phone && selectedLead.company_name && (
                <div className="rounded-lg border border-dashed p-3 flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="space-y-1.5 flex-1">
                    <p className="text-xs text-muted-foreground">
                      No contact info found automatically. The phone number is usually visible on their Google Maps listing.
                    </p>
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(
                        selectedLead.company_name +
                        ((selectedLead.raw_data as Record<string, unknown>)?.location
                          ? ` ${(selectedLead.raw_data as Record<string, unknown>).location}`
                          : "")
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <MapPin className="h-3 w-3 mr-1.5" />
                        Find on Google Maps
                      </Button>
                    </a>
                  </div>
                </div>
              )}

              {/* Outreach message */}
              {selectedLead.outreach_message && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium uppercase text-muted-foreground tracking-wide">Outreach Message</Label>
                  <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed border">
                    {selectedLead.outreach_message}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase text-muted-foreground tracking-wide">Notes</Label>
                <Textarea
                  value={editingNotes}
                  onChange={e => setEditingNotes(e.target.value)}
                  placeholder="Add private notes about this lead..."
                  rows={3}
                  className="resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
                    {savingNotes ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving...</> : "Save Notes"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteLead(selectedLead.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Lead
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </>
  )
}
