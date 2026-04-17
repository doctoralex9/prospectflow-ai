import { useState, useEffect, useRef } from "react"
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
  Mail, Phone, Globe, MapPin, User, Building2, X, Link, ChevronDown, ChevronUp
} from "lucide-react"
import * as XLSX from "xlsx"
import { toast } from "@/hooks/use-toast"

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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [loading, setLoading] = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS.map(s => ({ ...s })))
  const [showPipeline, setShowPipeline] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [editingNotes, setEditingNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [showUrlInput, setShowUrlInput] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (user) loadCampaigns()
  }, [user])

  useEffect(() => {
    if (selectedCampaignId) loadLeads()
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
    if (statusFilter !== "all") {
      result = result.filter(l => l.status === statusFilter)
    }
    setFilteredLeads(result)
  }, [leads, search, statusFilter])

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

  function startPipeline() {
    if (!selectedCampaignId) {
      toast({ title: "No campaign selected", variant: "destructive" })
      return
    }

    const urls = parseUrls(urlInput)
    if (urls.length === 0) {
      toast({ title: "No valid URLs", description: "Paste at least one URL starting with http:// or https://", variant: "destructive" })
      return
    }

    setPipelineRunning(true)
    setShowPipeline(true)
    setSteps(INITIAL_STEPS.map(s => ({ ...s })))

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

    abortRef.current = new AbortController()

    fetch(`${supabaseUrl}/functions/v1/agent-pipeline-full`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ campaign_id: selectedCampaignId, user_id: user?.id, urls }),
      signal: abortRef.current.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text()
        toast({ title: "Pipeline failed to start", description: text, variant: "destructive" })
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
              toast({ title: "Pipeline error", description: parsed.message, variant: "destructive" })
              setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s))
              setPipelineRunning(false)
            }
          } catch { /* ignore parse errors */ }
        }
      }
      setPipelineRunning(false)
    }).catch((e) => {
      if (e.name !== "AbortError") {
        toast({ title: "Connection error", description: String(e), variant: "destructive" })
        setPipelineRunning(false)
      }
    })
  }

  function stopPipeline() {
    abortRef.current?.abort()
    setPipelineRunning(false)
  }

  async function updateLeadStatus(leadId: string, status: string) {
    await supabase.from("leads").update({ status }).eq("id", leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l))
    if (selectedLead?.id === leadId) setSelectedLead(prev => prev ? { ...prev, status } : null)
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

  function exportLeads() {
    const data = filteredLeads.map(l => ({
      "Company": l.company_name,
      "Contact": l.contact_name,
      "Role": l.contact_role,
      "Email": l.email,
      "Phone": l.phone,
      "Status": l.status,
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Paste URLs, run the pipeline, get contacts</p>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {/* URL Input Card */}
      <Card className="border-dashed">
        <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowUrlInput(p => !p)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">
                Paste URLs to scrape
                {parsedUrlCount > 0 && !pipelineRunning && (
                  <span className="ml-2 text-primary font-normal">({parsedUrlCount} URL{parsedUrlCount !== 1 ? "s" : ""} ready)</span>
                )}
              </CardTitle>
            </div>
            {showUrlInput ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {showUrlInput && (
          <CardContent className="space-y-3">
            <Textarea
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder={"https://www.e-food.gr/athens/catering\nhttps://www.skroutz.gr/restaurants/athens\n\nOne URL per line, or comma separated"}
              rows={4}
              className="font-mono text-xs resize-none"
              disabled={pipelineRunning}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                One URL per line • up to 20 URLs per run • public pages only
              </p>
              {pipelineRunning ? (
                <Button variant="outline" onClick={stopPipeline} size="sm">
                  <X className="h-3.5 w-3.5 mr-1.5" /> Stop
                </Button>
              ) : (
                <Button onClick={startPipeline} disabled={!selectedCampaignId || parsedUrlCount === 0} size="sm">
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Run Pipeline
                  {parsedUrlCount > 0 && ` (${parsedUrlCount})`}
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
                  variant={parsedUrlCount > 0 ? "default" : "outline"}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {parsedUrlCount > 0 ? `Run Pipeline (${parsedUrlCount} URLs)` : "Add URLs & Run"}
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
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, contact, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
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
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-muted-foreground">Company</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Contact</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
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
                      <Badge variant={lead.enrichment_source === "scraper" ? "success" : "outline"} className="text-xs">
                        {lead.enrichment_source}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <Select value={lead.status || "new"} onValueChange={v => updateLeadStatus(lead.id, v)}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacted">Contacted</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <Badge variant={selectedLead.enrichment_source === "scraper" ? "success" : "outline"}>
                    {selectedLead.enrichment_source}
                  </Badge>
                )}
                {selectedLead.lead_category && (
                  <Badge variant="secondary">{selectedLead.lead_category}</Badge>
                )}
              </div>

              {/* Outreach message */}
              {selectedLead.outreach_message && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium uppercase text-muted-foreground tracking-wide">Outreach Message</Label>
                  <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed border">
                    {selectedLead.outreach_message}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium uppercase text-muted-foreground tracking-wide">Status</Label>
                <Select value={selectedLead.status || "new"} onValueChange={v => updateLeadStatus(selectedLead.id, v)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>

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
                <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving...</> : "Save Notes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
