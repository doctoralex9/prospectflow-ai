export const DEMO_CAMPAIGN = {
  name: "Athens Corporate Catering Leads",
  description: "Find restaurants and catering businesses in Athens that can serve corporate clients (office lunches, business events, team catering)",
  target_site: "Google Maps + business directories",
  icp_description: "Restaurants, catering companies, and food delivery services in Athens that have capacity for corporate/B2B orders (min 10+ people)",
  perplexity_default_query: 'catering Athens corporate site:google.com/maps OR site:e-food.gr OR site:foody.gr OR "delivery" "Athens" "corporate" | εστιατόριο catering Αθήνα εταιρικά γεύματα επικοινωνία email τηλέφωνο',
  crawl_keywords: ["catering", "εστιατόριο", "delivery", "corporate", "εταιρικά"],
  is_active: true,
}

export const DEMO_AGENT_CONFIGS = [
  {
    agent_type: "scraper",
    model: "gpt-4o-mini",
    system_prompt: `Extract restaurants and catering businesses from this page that could serve corporate clients.
For each business extract:
- company_name: Business name
- industry: "restaurant" | "catering" | "food_delivery" | "bakery_catering"
- location: Area in Athens (e.g. Kolonaki, Marousi, Glyfada)
- capacity_hint: Any mention of group capacity, corporate service, or delivery range
- contact_name: Owner/manager name if visible
- email: Contact email if present
- phone: Phone number if present
- website: Website URL if present
- source_url: Page URL
Return ONLY a JSON array. Include businesses even if only name and location are found.`,
  },
  {
    agent_type: "qualifier",
    model: "gpt-4o-mini",
    system_prompt: `Evaluate if this business is a good lead for corporate catering sales.
ACCEPT if: restaurant or catering business with physical presence in Athens, capacity for groups, not a fast-food chain (McDonald's, KFC etc.)
REJECT if: fast food chain, foreign restaurant with no delivery, closed/permanently shut
Return JSON: {"qualified": true/false, "reason": "..."}`,
  },
  {
    agent_type: "enrichment",
    model: "gpt-4o-mini",
    system_prompt: `You organize existing contact data into structured format.
STRICTLY FORBIDDEN: do not invent, guess, or hallucinate any email, phone, or contact name.
Use ONLY data from the scraper or Apollo API.
Return JSON: {"name": "", "role": "", "email": "", "phone": "", "website": "", "source": ""}
If no real data exists, return empty strings.`,
  },
  {
    agent_type: "content",
    model: "gpt-4o",
    system_prompt: `Write a short, personalized B2B outreach email on behalf of a corporate meal planning service.
Context: We connect Athens businesses with quality restaurants and caterers for office lunches, team events, and corporate catering.
Structure:
1. Reference the specific restaurant/catering business by name
2. One line about why they're a good fit for corporate clients
3. CTA: propose a quick call or send menu options
Tone: Professional, direct, 3-4 sentences max.
Language: Greek if business name sounds Greek, English if international.`,
  },
]
