export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      campaigns: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          target_site: string
          icp_description: string
          perplexity_default_query: string | null
          crawl_keywords: string[] | null
          system_prompt: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          target_site: string
          icp_description: string
          perplexity_default_query?: string | null
          crawl_keywords?: string[] | null
          system_prompt?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          target_site?: string
          icp_description?: string
          perplexity_default_query?: string | null
          crawl_keywords?: string[] | null
          system_prompt?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      agent_configs: {
        Row: {
          id: string
          campaign_id: string
          agent_type: string
          instance_name: string | null
          model: string
          system_prompt: string
        }
        Insert: {
          id?: string
          campaign_id: string
          agent_type: string
          instance_name?: string | null
          model?: string
          system_prompt: string
        }
        Update: {
          id?: string
          campaign_id?: string
          agent_type?: string
          instance_name?: string | null
          model?: string
          system_prompt?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          campaign_id: string
          company_name: string | null
          contact_name: string | null
          contact_role: string | null
          email: string | null
          phone: string | null
          source_url: string | null
          raw_data: Json | null
          qualified: boolean
          qualification_reason: string | null
          enriched_data: Json | null
          outreach_message: string | null
          lead_category: string | null
          enrichment_source: string | null
          status: string
          notes: string | null
          created_at: string
          location?: string | null
        }
        Insert: {
          id?: string
          campaign_id: string
          company_name?: string | null
          contact_name?: string | null
          contact_role?: string | null
          email?: string | null
          phone?: string | null
          source_url?: string | null
          raw_data?: Json | null
          qualified?: boolean
          qualification_reason?: string | null
          enriched_data?: Json | null
          outreach_message?: string | null
          lead_category?: string | null
          enrichment_source?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          location?: string | null
        }
        Update: {
          id?: string
          campaign_id?: string
          company_name?: string | null
          contact_name?: string | null
          contact_role?: string | null
          email?: string | null
          phone?: string | null
          source_url?: string | null
          raw_data?: Json | null
          qualified?: boolean
          qualification_reason?: string | null
          enriched_data?: Json | null
          outreach_message?: string | null
          lead_category?: string | null
          enrichment_source?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          location?: string | null
        }
        Relationships: []
      }
      scrape_jobs: {
        Row: {
          id: string
          campaign_id: string
          target_url: string
          status: string
          pages_scraped: number
          pages_rejected: number
          leads_found: number
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          target_url: string
          status?: string
          pages_scraped?: number
          pages_rejected?: number
          leads_found?: number
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          target_url?: string
          status?: string
          pages_scraped?: number
          pages_rejected?: number
          leads_found?: number
          error_message?: string | null
          created_at?: string
        }
        Relationships: []
      }
      agent_memory: {
        Row: {
          id: string
          campaign_id: string
          agent_type: string
          session_id: string
          role: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          agent_type: string
          session_id: string
          role: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          agent_type?: string
          session_id?: string
          role?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
      chat_sessions: {
        Row: {
          id: string
          campaign_id: string | null
          user_id: string | null
          agent_type: string
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id?: string | null
          user_id?: string | null
          agent_type: string
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string | null
          user_id?: string | null
          agent_type?: string
          created_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          id: string
          session_id: string
          role: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          role: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          role?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"]
export type AgentConfig = Database["public"]["Tables"]["agent_configs"]["Row"]
export type Lead = Database["public"]["Tables"]["leads"]["Row"]
export type ScrapeJob = Database["public"]["Tables"]["scrape_jobs"]["Row"]
export type ChatSession = Database["public"]["Tables"]["chat_sessions"]["Row"]
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"]
