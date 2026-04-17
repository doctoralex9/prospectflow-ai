import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Campaign, ScrapeJob } from "@/types/database"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer
} from "recharts"
import { Users, Mail, Phone, TrendingUp, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react"

interface LeadStats {
  total: number
  withEmail: number
  withPhone: number
  converted: number
  byStatus: Record<string, number>
  byEnrichmentSource: Record<string, number>
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]

export default function DashboardPage() {
  const { user } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all")
  const [stats, setStats] = useState<LeadStats | null>(null)
  const [recentJobs, setRecentJobs] = useState<(ScrapeJob & { campaigns?: { name: string } })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadCampaigns()
      loadRecentJobs()
    }
  }, [user])

  useEffect(() => {
    if (user) loadStats()
  }, [user, selectedCampaignId])

  async function loadCampaigns() {
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", user!.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
    if (data) setCampaigns(data)
  }

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
        setStats({ total: 0, withEmail: 0, withPhone: 0, converted: 0, byStatus: {}, byEnrichmentSource: {} })
        setLoading(false)
        return
      }
      query = query.in("campaign_id", ids)
    } else {
      query = query.eq("campaign_id", selectedCampaignId)
    }

    const { data: leads } = await query

    if (!leads) {
      setLoading(false)
      return
    }

    const byStatus: Record<string, number> = {}
    const byEnrichmentSource: Record<string, number> = {}

    for (const lead of leads) {
      const status = lead.status || "new"
      byStatus[status] = (byStatus[status] || 0) + 1

      const src = lead.enrichment_source || "unknown"
      byEnrichmentSource[src] = (byEnrichmentSource[src] || 0) + 1
    }

    setStats({
      total: leads.length,
      withEmail: leads.filter(l => l.email).length,
      withPhone: leads.filter(l => l.phone).length,
      converted: byStatus["qualified"] || 0,
      byStatus,
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

    if (data) setRecentJobs(data as (ScrapeJob & { campaigns?: { name: string } })[])
  }

  const sourceChartData = stats
    ? Object.entries(stats.byEnrichmentSource).map(([name, value]) => ({ name, value }))
    : []

  const statusChartData = stats
    ? Object.entries(stats.byStatus).map(([name, value]) => ({ name, value }))
    : []

  const statCards = [
    {
      title: "Total Leads",
      value: stats?.total ?? 0,
      icon: Users,
      desc: "across all campaigns",
    },
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
    {
      title: "Qualified",
      value: stats?.converted ?? 0,
      icon: TrendingUp,
      desc: "marked as qualified",
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {campaigns.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map(card => (
              <Card key={card.title}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription>{card.title}</CardDescription>
                    <card.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{card.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{card.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Enrichment Sources</CardTitle>
              </CardHeader>
              <CardContent>
                {sourceChartData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={sourceChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
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
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lead Status</CardTitle>
              </CardHeader>
              <CardContent>
                {statusChartData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={statusChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent pipeline runs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Pipeline Runs</CardTitle>
            </CardHeader>
            <CardContent>
              {recentJobs.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">No pipeline runs yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 font-medium">Campaign</th>
                      <th className="text-left pb-2 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium">Pages</th>
                      <th className="text-left pb-2 font-medium">Leads</th>
                      <th className="text-left pb-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map(job => (
                      <tr key={job.id} className="border-b last:border-0">
                        <td className="py-2">{job.campaigns?.name || "—"}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            {job.status === "completed" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                            {job.status === "failed" && <XCircle className="h-3 w-3 text-destructive" />}
                            {job.status === "running" && <Loader2 className="h-3 w-3 text-primary animate-spin" />}
                            {job.status === "pending" && <Clock className="h-3 w-3 text-muted-foreground" />}
                            <Badge variant={job.status === "completed" ? "success" : job.status === "failed" ? "destructive" : "secondary"}>
                              {job.status}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-2">{job.pages_scraped}</td>
                        <td className="py-2">{job.leads_found}</td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(job.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
