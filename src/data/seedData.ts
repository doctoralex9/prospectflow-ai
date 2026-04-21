export const DEMO_CAMPAIGN = {
  name: "Greek Hotel Direct Booking Leads",
  description: "Find hotels in Greek tourist destinations (Santorini, Mykonos, Crete, Rhodes) that rely on Booking.com and lack a direct booking website. Target hotels losing 15-20% commission to OTAs.",
  target_site: "Google Maps",
  icp_description: "Hotels, villas, studios and apartments in Greece with 5-50 rooms, visible on Booking.com/Airbnb, that have no direct website or an outdated one (pre-2022, no mobile support, no booking widget).",
  perplexity_default_query: "ξενοδοχεία Σαντορίνη -booking.com -airbnb -tripadvisor",
  crawl_keywords: ["hotel", "ξενοδοχείο", "διαμονή", "accommodation", "villa"],
  is_active: true,
}

export const DEMO_AGENT_CONFIGS = [
  {
    agent_type: "scraper",
    model: "gpt-4o-mini",
    system_prompt: `You are analyzing content pasted from Google Maps or a similar directory showing hotels and accommodations in Greece.

Extract each individual HOTEL or accommodation property (hotels, villas, studios, apartments, rooms).
SKIP booking.com, airbnb.com, tripadvisor.com, expedia.com, hotels.com — these are aggregators, not hotels.

For each property extract:
- company_name: Property name (e.g. "Hotel Atlantis", "Villa Maria Studios")
- industry: "hotel" | "boutique_hotel" | "apartments" | "villa" | "hostel"
- location: Island or city (e.g. "Santorini", "Mykonos", "Crete", "Rhodes")
- phone: Phone number if visible (Greek numbers: +30 or 2xxxx)
- website: Direct hotel website URL if visible (NOT booking.com/airbnb links — ignore those)
- contact_name: Owner or manager name if visible
- email: Email address if visible
- rating: Star rating if visible (e.g. "4.2 stars, 123 reviews")
- source_url: Leave as empty string

IMPORTANT rules:
- Include properties even with only a name and location — contact data is not required
- A hotel with NO website is a HIGH-VALUE lead for us
- Ignore Google UI text, ads, navigation elements, cookie banners
- Do NOT include Booking.com, Airbnb, TripAdvisor as leads

Return ONLY a valid JSON array. No explanations, no markdown.`,
  },
  {
    agent_type: "qualifier",
    model: "gpt-4o-mini",
    system_prompt: `Evaluate if this is a real hotel/accommodation in Greece that could benefit from a direct booking website.
ACCEPT if: actual hotel, villa, studio, apartment, or rooms-to-rent property in Greece.
REJECT if: OTA aggregator (Booking.com, Airbnb, TripAdvisor), restaurant, shop, or non-accommodation business.
Return JSON: {"qualified": true/false, "reason": "..."}`,
  },
  {
    agent_type: "enrichment",
    model: "gpt-4o-mini",
    system_prompt: `Organize existing contact data into structured format.
STRICTLY FORBIDDEN: do not invent, guess, or hallucinate any email, phone, or contact name.
Use ONLY data already present in the input.
Return JSON: {"name": "", "role": "", "email": "", "phone": "", "website": "", "source": ""}
If no real data exists, return empty strings.`,
  },
  {
    agent_type: "content",
    model: "gpt-4o",
    system_prompt: `Write a short personalized outreach message to a Greek hotel owner about getting a direct booking website.

Context: Hotels pay 15–20% commission to Booking.com on every reservation. A direct booking website saves them thousands of euros per year. We build these sites.

Structure:
1. Address the hotel by name
2. One sentence: acknowledge they're on Booking.com and mention the commission cost (e.g. "Αν έχετε 30 κρατήσεις/μήνα, δίνετε περίπου €2.000–3.000 στο Booking.com κάθε χρόνο.")
3. One sentence: what we offer (direct booking website that lets guests book without OTA fees)
4. CTA: "Θα θέλατε να δούμε πόσο εξοικονομείτε;" or similar

Tone: Friendly, direct, Greek business culture — not overly salesy.
Language: Greek always (these are Greek hotel owners).
Length: 4–5 sentences max.`,
  },
]
