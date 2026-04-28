import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Lead } from "@/types/database"
import { DEFAULT_CAMPAIGN, DEFAULT_AGENT_CONFIGS } from "@/data/seedData"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Play, Download, Search, CheckCircle2, Circle, Loader2,
  Mail, Phone, Globe, MapPin, User, Building2, X, Copy, Check, Trash2, ArrowLeft
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
  { step: 1, name: "Search", status: "pending", message: "Find relevant pages via Tavily" },
  { step: 2, name: "Crawler", status: "pending", message: "Scrape pages" },
  { step: 3, name: "Filter", status: "pending", message: "Filter relevant content" },
  { step: 4, name: "Extractor", status: "pending", message: "Extract leads with AI" },
  { step: 5, name: "Enrichment", status: "pending", message: "Enrich contacts & check social media" },
  { step: 6, name: "Save", status: "pending", message: "Save to database" },
]

const SEARCH_SUGGESTIONS = [
  "καφετέριες Αθήνα",
  "εστιατόρια Θεσσαλονίκη",
  "ταβέρνες Κρήτη",
  "pizzerias Athens",
  "καφέ Πάτρα",
  "εστιατόρια Ρόδος",
  "ταβέρνες Χαλκιδική",
  "εστιατόρια Ηράκλειο",
]

export default function LeadsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([])
  const [tableSearch, setTableSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS.map(s => ({ ...s })))
  const [showPipeline, setShowPipeline] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [editingNotes, setEditingNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [errorCopied, setErrorCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const hasTavilyKey = !!localStorage.getItem("leadflow_tavily_key")

  useEffect(() => {
    if (user) ensureCampaign()
  }, [user])

  useEffect(() => {
    if (selectedCampaignId) loadLeads()
  }, [selectedCampaignId])

  useEffect(() => {
    if (!tableSearch) { setFilteredLeads(leads); return }
    const q = tableSearch.toLowerCase()
    setFilteredLeads(leads.filter(l =>
      l.company_name?.toLowerCase().includes(q) ||
      l.contact_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      (l.raw_data as Record<string, unknown>)?.location?.toString().toLowerCase().includes(q)
    ))
  }, [leads, tableSearch])

  async function ensureCampaign() {
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", user!.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })

    if (data && data.length > 0) {
      const id = data[0].id
      setSelectedCampaignId(id)
      // Always sync agent configs to latest defaults (upsert = update if exists)
      const configs = DEFAULT_AGENT_CONFIGS.map(c => ({ campaign_id: id, ...c }))
      await supabase.from("agent_configs").upsert(configs, { onConflict: "campaign_id,agent_type" })
      return
    }

    // First time: auto-create the default campaign
    const { data: campaign } = await supabase
      .from("campaigns")
      .insert({ user_id: user!.id, ...DEFAULT_CAMPAIGN })
      .select()
      .single()

    if (campaign) {
      const configs = DEFAULT_AGENT_CONFIGS.map(c => ({ campaign_id: campaign.id, ...c }))
      await supabase.from("agent_configs").insert(configs)
      setSelectedCampaignId(campaign.id)
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

  async function startPipeline() {
    if (!selectedCampaignId) {
      toast({ title: "Campaign not ready yet", description: "Wait a moment and try again.", variant: "destructive" })
      return
    }
    if (!searchQuery.trim()) {
      toast({ title: "Enter a search query", description: "Describe the businesses you're looking for.", variant: "destructive" })
      return
    }
    const tavilyKey = localStorage.getItem("leadflow_tavily_key") || ""
    if (!tavilyKey) {
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
        searchQuery: searchQuery.trim(),
        tavilyKey,
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
              toast({ title: `Done! Found ${parsed.total_leads} leads.` })
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
    if (!confirm(`Delete all ${count} lead${count !== 1 ? "s" : ""}? This cannot be undone.`)) return
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

  return (
    <>
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <StarField />
      </div>
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
              <h1 className="text-2xl font-bold">Find Leads</h1>
              <p className="text-sm text-muted-foreground mt-0.5">AI search → extract contacts → personalized outreach</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={exportLeads} disabled={filteredLeads.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Button variant="destructive" onClick={deleteAllLeads} disabled={leads.length === 0}>
              <Trash2 className="h-4 w-4 mr-2" /> Delete All
            </Button>
          </div>
        </div>

        {/* Search Card */}
        <Card className="border-dashed">
          <CardContent className="pt-5 space-y-3">
            {!hasTavilyKey && (
              <p className="text-xs text-amber-500 bg-amber-950/40 border border-amber-800/40 rounded px-3 py-2">
                Tavily API key not set. Go to <strong>Settings → API Keys</strong> to add it (free at tavily.com).
              </p>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !pipelineRunning && startPipeline()}
                  placeholder="e.g. εστιατόρια Αθήνα χωρίς Instagram, cafes Thessaloniki..."
                  className="pl-9"
                  disabled={pipelineRunning}
                />
              </div>
              {pipelineRunning ? (
                <Button variant="outline" onClick={stopPipeline}>
                  <X className="h-4 w-4 mr-1.5" /> Stop
                </Button>
              ) : (
                <Button
                  onClick={startPipeline}
                  disabled={!searchQuery.trim() || !hasTavilyKey}
                >
                  <Play className="h-4 w-4 mr-1.5" /> Find Leads
                </Button>
              )}
            </div>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-1.5">
              {SEARCH_SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setSearchQuery(s)}
                  className="text-xs bg-muted border border-border rounded px-2 py-1 hover:border-primary hover:text-primary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Tavily finds relevant pages · AI extracts business contacts · social media presence checked per lead
            </p>
          </CardContent>
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

        {/* Table search + count */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search company, contact, email..."
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
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
            <p className="text-sm">Type a search above and click Find Leads.</p>
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
                          <a href={`mailto:${lead.email}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>
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
                      {selectedLead.contact_role && <span className="text-muted-foreground">· {selectedLead.contact_role}</span>}
                    </div>
                  )}
                  {selectedLead.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <a href={`mailto:${selectedLead.email}`} className="text-primary hover:underline">{selectedLead.email}</a>
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
                      <a href={selectedLead.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
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

                {/* Social media status */}
                {(() => {
                  const raw = (selectedLead.raw_data as Record<string, unknown>) || {}
                  const found = (raw.social_media_found as string[]) || []
                  const missing = (raw.social_media_missing as string[]) || []
                  if (!found.length && !missing.length) return null
                  return (
                    <div className="rounded-lg border p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Social Media</p>
                      {found.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {found.map(p => (
                            <Badge key={p} variant="success" className="text-xs">{p} ✓</Badge>
                          ))}
                        </div>
                      )}
                      {missing.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {missing.map(p => (
                            <Badge key={p} variant="destructive" className="text-xs">{p} ✗</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Tags */}
                <div className="flex gap-2 flex-wrap">
                  {selectedLead.enrichment_source && (
                    <Badge variant={
                      selectedLead.enrichment_source === "no-website" ? "destructive"
                      : selectedLead.enrichment_source === "outdated-website" ? "warning"
                      : selectedLead.enrichment_source === "scraper" ? "success"
                      : "outline"
                    }>
                      {selectedLead.enrichment_source === "no-website" ? "no website"
                        : selectedLead.enrichment_source === "outdated-website" ? "outdated site"
                        : selectedLead.enrichment_source}
                    </Badge>
                  )}
                  {selectedLead.lead_category && <Badge variant="secondary">{selectedLead.lead_category}</Badge>}
                </div>

                {/* Google Maps fallback when no contact info */}
                {!selectedLead.email && !selectedLead.phone && selectedLead.company_name && (
                  <div className="rounded-lg border border-dashed p-3 flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="space-y-1.5 flex-1">
                      <p className="text-xs text-muted-foreground">
                        No contact info found. The phone number is usually visible on their Google Maps listing.
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
                          <MapPin className="h-3 w-3 mr-1.5" /> Find on Google Maps
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
