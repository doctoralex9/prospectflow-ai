import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { ScrapeJob } from "@/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import {
  Users, Mail, Phone, Clock, CheckCircle2, XCircle, Loader2,
  BookSearch, Settings, ChevronDown, Play, LogOut,
} from "lucide-react"
import StarField from "@/components/StarField"
import RobotCharacter from "@/components/RobotCharacter"

interface LeadStats {
  total: number
  withEmail: number
  withPhone: number
  byEnrichmentSource: Record<string, number>
}

const COLORS = ["#294551", "#528ba3", "#393B81", "#754195", "#D1B8E0"]

export default function DashboardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const selectedCampaignId = "all"
  const [stats, setStats] = useState<LeadStats | null>(null)
  const [recentJobs, setRecentJobs] = useState<(ScrapeJob & { campaigns?: { name: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [robotPos, setRobotPos] = useState({ x: 78, y: 58 })

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wander = () => {
      setRobotPos({
        x: 8 + Math.random() * 76,
        y: 8 + Math.random() * 68,
      })
      t = setTimeout(wander, 3200 + Math.random() * 3800)
    }
    t = setTimeout(wander, 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (user) loadRecentJobs()
  }, [user])

  useEffect(() => {
    if (user) loadStats()
  }, [user, selectedCampaignId])

  async function loadStats() {
    setLoading(true)
    let query = supabase.from("leads").select("*")

    if (selectedCampaignId === "all") {
      const { data: userCampaigns } = await supabase
        .from("campaigns")
        .select("id")
        .eq("user_id", user!.id)
      const ids = userCampaigns?.map(c => c.id) || []
      if (ids.length === 0) {
        setStats({ total: 0, withEmail: 0, withPhone: 0, byEnrichmentSource: {} })
        setLoading(false)
        return
      }
      query = query.in("campaign_id", ids)
    } else {
      query = query.eq("campaign_id", selectedCampaignId)
    }

    const { data: leads } = await query
    if (!leads) { setLoading(false); return }

    const byEnrichmentSource: Record<string, number> = {}
    for (const lead of leads) {
      const src = lead.enrichment_source || "unknown"
      byEnrichmentSource[src] = (byEnrichmentSource[src] || 0) + 1
    }

    setStats({
      total: leads.length,
      withEmail: leads.filter(l => l.email).length,
      withPhone: leads.filter(l => l.phone).length,
      byEnrichmentSource,
    })
    setLoading(false)
  }

  async function loadRecentJobs() {
    const { data: userCampaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", user!.id)
    const ids = userCampaigns?.map(c => c.id) || []
    if (ids.length === 0) return

    const { data } = await supabase
      .from("scrape_jobs")
      .select("*, campaigns(name)")
      .in("campaign_id", ids)
      .order("created_at", { ascending: false })
      .limit(10)

    if (data) {
      const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const staleIds = data
        .filter(j => j.status === "running" && j.created_at < staleThreshold)
        .map(j => j.id)

      if (staleIds.length > 0) {
        await supabase.from("scrape_jobs").update({ status: "failed" }).in("id", staleIds)
        setRecentJobs(
          data.map(j => staleIds.includes(j.id) ? { ...j, status: "failed" } : j) as (ScrapeJob & { campaigns?: { name: string } })[]
        )
      } else {
        setRecentJobs(data as (ScrapeJob & { campaigns?: { name: string } })[])
      }
    }
  }

  const sourceChartData = stats
    ? Object.entries(stats.byEnrichmentSource).map(([name, value]) => ({ name, value }))
    : []

  const statCards = [
    { title: "Total Leads", value: stats?.total ?? 0, icon: Users, desc: "across all campaigns" },
    {
      title: "With Email",
      value: stats ? `${Math.round((stats.withEmail / Math.max(stats.total, 1)) * 100)}%` : "0%",
      icon: Mail,
      desc: `${stats?.withEmail ?? 0} leads`,
    },
    {
      title: "With Phone",
      value: stats ? `${Math.round((stats.withPhone / Math.max(stats.total, 1)) * 100)}%` : "0%",
      icon: Phone,
      desc: `${stats?.withPhone ?? 0} leads`,
    },
  ]

  const handleSignOut = async () => {
    await signOut()
    navigate("/auth")
  }

  return (
    <div className="page-enter">

      {/* ── Minimal top-right controls ──────────────────────── */}
      <div className="fixed top-0 right-0 z-20 flex items-center gap-2 p-4">
        <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[180px]">{user?.email}</span>
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* ══════════════════════════════════════════════════════
          Section 1 — Hero
      ══════════════════════════════════════════════════════ */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 relative bg-[#04060f] overflow-hidden">

        {/* Star field — fills the section */}
        <StarField />

        {/* Robot — wanders around the hero */}
        <div
          className="absolute opacity-60 pointer-events-none select-none"
          style={{
            left: `${robotPos.x}%`,
            top: `${robotPos.y}%`,
            transition: "left 2.8s ease-in-out, top 2.8s ease-in-out",
          }}
        >
          <div className="-translate-x-1/2 -translate-y-1/2">
            <RobotCharacter />
          </div>
        </div>

        {/* Main content — above stars and robot */}
        <div className="relative z-10 text-center space-y-6 max-w-2xl mx-auto">
          <div className="bg-primary/10 rounded-2xl p-5 w-fit mx-auto border border-primary/20">
            <BookSearch className="h-12 w-12 text-primary" />
          </div>

          <div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">PROSPECTFLOW AI</h1>
            <p className="text-lg md:text-xl text-muted-foreground mt-4 leading-relaxed">
              AI-powered B2B lead generation.<br className="hidden sm:block" />
              Search, extract, and reach the right businesses — all in one place.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link to="/leads">
              <Button size="lg" className="gap-2 w-full sm:w-auto">
                <Play className="h-4 w-4" /> Run Pipeline
              </Button>
            </Link>
            <Link to="/settings">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                <Settings className="h-4 w-4" /> Settings
              </Button>
            </Link>
          </div>
        </div>

        {/* How it works */}
        <div className="relative z-10 mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto w-full">
          {[
            { step: "01", title: "AI Search", desc: "Type a query — Tavily finds the right businesses across the web" },
            { step: "02", title: "Extract & Enrich", desc: "Pipeline pulls contacts, checks websites, and scans Google for social media gaps" },
            { step: "03", title: "Send Outreach", desc: "Personalized messages targeting exactly what each business is missing" },
          ].map(item => (
            <div
              key={item.step}
              className="bg-card/40 backdrop-blur-sm border border-white/5 rounded-xl p-5 text-left"
            >
              <span className="text-xs font-mono text-primary tracking-widest">{item.step}</span>
              <h3 className="font-semibold mt-2 text-sm">{item.title}</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 z-10 text-muted-foreground/40 animate-bounce">
          <ChevronDown className="h-5 w-5" />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          Section 2 — Stats
      ══════════════════════════════════════════════════════ */}
      <section className="min-h-screen flex flex-col justify-center px-6 py-20 bg-[#04060f] relative overflow-hidden">
        <StarField />
        <div className="relative z-10 max-w-4xl mx-auto w-full space-y-10">
          <div>
            <p className="text-xs font-mono text-primary uppercase tracking-widest">Your Numbers</p>
            <h2 className="text-3xl font-bold mt-1">Pipeline Overview</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 stagger-children">
              {statCards.map(card => (
                <Card key={card.title} className="bg-card/40 backdrop-blur-sm border-white/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription>{card.title}</CardDescription>
                      <card.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold">{card.value}</div>
                    <p className="text-xs text-muted-foreground mt-1">{card.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          Section 3 — Enrichment Sources
      ══════════════════════════════════════════════════════ */}
      <section className="min-h-screen flex flex-col justify-center px-6 py-20 bg-[#04060f] relative overflow-hidden">
        <StarField />
        <div className="relative z-10 max-w-4xl mx-auto w-full space-y-10">
          <div>
            <p className="text-xs font-mono text-primary uppercase tracking-widest">Breakdown</p>
            <h2 className="text-3xl font-bold mt-1">Enrichment Sources</h2>
          </div>

          <Card className="bg-card/40 backdrop-blur-sm border-white/5">
            <CardContent className="pt-6">
              {sourceChartData.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">No data yet</div>
              ) : (
                <>
                  {/* Mobile: total count */}
                  <div className="flex flex-col items-center justify-center py-8 md:hidden">
                    <span className="text-6xl font-bold">{stats?.total ?? 0}</span>
                    <span className="text-sm text-muted-foreground mt-2">total leads</span>
                  </div>
                  {/* Desktop: pie chart */}
                  <div className="hidden md:block">
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie
                          data={sourceChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={75}
                          outerRadius={115}
                          paddingAngle={3}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                          labelLine={false}
                        >
                          {sourceChartData.map((_, index) => (
                            <Cell key={index} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          Section 4 — Recent Pipeline Runs
      ══════════════════════════════════════════════════════ */}
      <section className="min-h-screen flex flex-col justify-center px-6 py-20 bg-[#04060f] relative overflow-hidden">
        <StarField />
        <div className="relative z-10 max-w-4xl mx-auto w-full space-y-10">
          <div>
            <p className="text-xs font-mono text-primary uppercase tracking-widest">Activity</p>
            <h2 className="text-3xl font-bold mt-1">Recent Pipeline Runs</h2>
          </div>

          <Card className="bg-card/40 backdrop-blur-sm border-white/5">
            <CardContent className="pt-6">
              {recentJobs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No pipeline runs yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-3 font-medium">Campaign</th>
                        <th className="text-left pb-3 font-medium">Status</th>
                        <th className="text-left pb-3 font-medium">Pages</th>
                        <th className="text-left pb-3 font-medium">Leads</th>
                        <th className="text-left pb-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentJobs.map(job => (
                        <tr key={job.id} className="border-b last:border-0">
                          <td className="py-3">{job.campaigns?.name || "—"}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-1.5">
                              {job.status === "completed" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                              {job.status === "failed" && <XCircle className="h-3 w-3 text-destructive" />}
                              {job.status === "running" && <Loader2 className="h-3 w-3 text-primary animate-spin" />}
                              {job.status === "pending" && <Clock className="h-3 w-3 text-muted-foreground" />}
                              <Badge variant={job.status === "completed" ? "success" : job.status === "failed" ? "destructive" : "secondary"}>
                                {job.status}
                              </Badge>
                            </div>
                          </td>
                          <td className="py-3">{job.pages_scraped}</td>
                          <td className="py-3">{job.leads_found}</td>
                          <td className="py-3 text-muted-foreground text-xs">
                            {new Date(job.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

    </div>
  )
}
