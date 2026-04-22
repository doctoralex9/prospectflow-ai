import { useState, useRef, useEffect } from "react"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import type { Campaign } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Send, Bot, User, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
  loading?: boolean
}

export default function ChatPage() {
  const { user } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("")
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user) {
      supabase.from("campaigns").select("*").eq("user_id", user.id).then(({ data }) => {
        if (data) setCampaigns(data)
      })
    }
  }, [user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || sending) return

    const userMsg = input.trim()
    setInput("")
    setSending(true)

    setMessages(prev => [...prev, { role: "user", content: userMsg }, { role: "assistant", content: "", loading: true }])

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token || supabaseKey

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          message: userMsg,
          session_id: sessionId,
          campaign_id: selectedCampaignId || null,
          user_id: user?.id,
          agent_type: "assistant",
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const newSessionId = response.headers.get("x-session-id")
      if (newSessionId && !sessionId) setSessionId(newSessionId)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let fullContent = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6))
              const content = data.choices?.[0]?.delta?.content || ""
              if (content) {
                fullContent += content
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === "assistant") {
                    updated[updated.length - 1] = { ...last, content: fullContent, loading: false }
                  }
                  return updated
                })
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: "Sorry, something went wrong. Please try again.", loading: false }
        }
        return updated
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b p-4 flex items-center gap-3">
        <Bot className="h-5 w-5 text-primary" />
        <h1 className="font-semibold">AI Assistant</h1>
        <div className="ml-auto">
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-52 h-8 text-sm">
              <SelectValue placeholder="Select campaign (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No campaign</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Ask me anything about your leads, campaigns, or outreach strategies.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>
              {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn(
              "max-w-[70%] rounded-lg px-4 py-2 text-sm",
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>
              {msg.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <form
          onSubmit={e => { e.preventDefault(); sendMessage() }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your leads..."
            disabled={sending}
            className="flex-1"
          />
          <Button type="submit" disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
