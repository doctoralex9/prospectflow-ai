// Quick logic test — no API keys needed
// Run: node test-instagram-logic.js

const GREEK_TO_LATIN = {
  'α':'a','ά':'a','β':'v','γ':'g','δ':'d','ε':'e','έ':'e','ζ':'z','η':'i','ή':'i','θ':'th',
  'ι':'i','ί':'i','ϊ':'i','ΐ':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','ό':'o',
  'π':'p','ρ':'r','σ':'s','ς':'s','τ':'t','υ':'y','ύ':'y','ϋ':'y','ΰ':'y','φ':'f','χ':'h',
  'ψ':'ps','ω':'o','ώ':'o'
}

function toLatinTokens(text) {
  const latin = text.toLowerCase().split('').map(c => GREEK_TO_LATIN[c] ?? c).join('')
  return latin.replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(t => t.length >= 4)
}

const CITY_ALIASES = {
  athens:       ['athens','αθηνα','αθήνα','attica','αττικη','αττική'],
  thessaloniki: ['thessaloniki','θεσσαλονικη','θεσσαλονίκη','salonica','salonika'],
  heraklion:    ['heraklion','herakleio','iraklion','ηρακλειο','ηράκλειο'],
  piraeus:      ['piraeus','πειραιας','πειραιάς','pireus'],
  patras:       ['patras','πατρα','πάτρα'],
  kolonaki:     ['kolonaki','κολωνακι','κολωνάκι'],
  glyfada:      ['glyfada','γλυφαδα','γλυφάδα'],
  kifisia:      ['kifisia','kifissia','κηφισια','κηφισιά'],
  pagkrati:     ['pagkrati','pangrati','παγκρατι','παγκράτι'],
  kallithea:    ['kallithea','καλλιθεα','καλλιθέα'],
  peristeri:    ['peristeri','περιστερι','περιστέρι'],
  halandri:     ['halandri','χαλανδρι','χαλάνδρι'],
}

function getCitySearchTerms(cityName) {
  const key = cityName.toLowerCase().replace(/[^a-z]/g, '')
  const terms = new Set([cityName.toLowerCase()])
  for (const aliases of Object.values(CITY_ALIASES)) {
    if (aliases.some(a => a.replace(/[^a-z]/g, '') === key)) {
      aliases.forEach(a => terms.add(a.toLowerCase()))
      break
    }
  }
  toLatinTokens(cityName).forEach(t => terms.add(t))
  return [...terms]
}

function handleMatchesBusiness(handle, businessName, websiteDomain) {
  const normHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nameTokens = toLatinTokens(businessName)
  const matchesHandle = (t) => normHandle.includes(t) || normHandle.includes(t.replace(/y/g, 'u'))
  if (nameTokens.some(matchesHandle)) return true
  if (websiteDomain) {
    const domainBase = websiteDomain.replace(/\.[a-z]{2,}$/, '').replace(/[^a-z0-9]/g, '')
    if (domainBase.length >= 4 && (normHandle.includes(domainBase) || normHandle.includes(domainBase.replace(/y/g, 'u')))) return true
  }
  return false
}

function handleContainsCity(handle, location) {
  if (!location) return false
  const normHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
  return getCitySearchTerms(location).some(term => {
    const normTerm = term.replace(/[^a-z0-9]/g, '')
    return normTerm.length >= 4 && normHandle.includes(normTerm)
  })
}

const INSTAGRAM_PROFILE = /instagram\.com\/(?!p\/|reel\/|tv\/|stories\/|explore\/|accounts\/|_n\/)[a-zA-Z0-9_.]{3,}/i

function check(lead, tavilyResults) {
  const { name, location, website } = lead
  let websiteDomain = ''
  try { if (website) websiteDomain = new URL(website).hostname.replace(/^www\./, '') } catch {}

  const matchedItem = tavilyResults.find(item => {
    const url = item.url || ''
    if (!INSTAGRAM_PROFILE.test(url)) return false
    const handleMatch = url.match(/instagram\.com\/([a-zA-Z0-9_.]{3,})/)
    if (!handleMatch) return false
    const handle = handleMatch[1]

    // Identity: handle must match business name — required, no fallback
    if (!handleMatchesBusiness(handle, name, websiteDomain)) return false

    // Location: when bio snippet available, city must be in bio OR in handle
    if (location && item.content && item.content.length > 10) {
      const cityInBio = getCitySearchTerms(location).some(term => item.content.toLowerCase().includes(term))
      const cityInHandle = handleContainsCity(handle, location)
      if (!cityInBio && !cityInHandle) return false
    }

    return true
  })
  return matchedItem ? 'HAS_INSTAGRAM' : 'NO_INSTAGRAM'
}

const tests = [
  // ✅ Should detect Instagram (business really has it)
  {
    desc: 'Greek name + Greek city in bio',
    lead: { name: 'Ταβέρνα Κώστας', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/tavernakostas/', content: 'Παραδοσιακή ταβέρνα 📍 Αθήνα' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Greek name + English city in bio',
    lead: { name: 'Ταβέρνα Κώστας', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/tavernakostas/', content: 'Traditional greek food - Athens, Greece' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'UPPERCASE city in bio',
    lead: { name: 'Καφέ Νίκος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/cafenikos_gr/', content: 'Espresso & vibes | ATHENS 🇬🇷' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Lead location in Greek, bio in English',
    lead: { name: 'Καφέ Μαρία', location: 'Αθήνα', website: '' },
    results: [{ url: 'https://instagram.com/cafemaria/', content: 'Best coffee in Athens ☕' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Website domain match (handle does not match name)',
    lead: { name: 'Εστιατόριο Μαρία', location: 'Athens', website: 'https://mariasrestaurant.gr' },
    results: [{ url: 'https://instagram.com/mariasrestaurant/', content: 'Το εστιατόριο μας 📍 Αθήνα' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Neighbourhood Kolonaki in lead + Greek bio',
    lead: { name: 'Κούτσουρο Bar', location: 'Kolonaki', website: '' },
    results: [{ url: 'https://instagram.com/koutsourokol/', content: 'Κλασικό bar στο Κολωνάκι 🥂' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'No snippet available - falls back to handle match only',
    lead: { name: 'Ταβέρνα Σπύρος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/tavernaspirou/', content: '' }],
    expect: 'HAS_INSTAGRAM'
  },

  // ❌ Should NOT detect Instagram (wrong business / wrong city)
  {
    desc: 'Same name, different city (Thessaloniki instead of Athens)',
    lead: { name: 'Καφέ Νίκος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/cafenikos/', content: 'Καλύτερος καφές στη Θεσσαλονίκη 🔥' }],
    expect: 'NO_INSTAGRAM'
  },
  {
    desc: 'Unrelated business handle returned by Tavily',
    lead: { name: 'Ταβέρνα Σπύρος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/mycoffeebar_athens/', content: 'Coffee bar Athens' }],
    expect: 'NO_INSTAGRAM'
  },
  {
    desc: 'Instagram post URL (not a profile)',
    lead: { name: 'Καφέ Αγγελική', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/p/ABC123xyz/', content: 'Καφέ Αγγελική Athens' }],
    expect: 'NO_INSTAGRAM'
  },
  {
    desc: 'Handle matches but no city in snippet',
    lead: { name: 'Εστιατόριο Νίκος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/estiatorionikos/', content: 'Good food and great times 🍽️' }],
    expect: 'NO_INSTAGRAM'
  },
  {
    desc: 'Reel URL rejected',
    lead: { name: 'Πιτσαρία Δήμος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/reel/ABC123/', content: 'Athens pizza reel' }],
    expect: 'NO_INSTAGRAM'
  },

  // namelocation style handles — the main new case
  {
    desc: 'namelocation handle: "pizzaathina" — display name in title catches it',
    lead: { name: 'Πιτσαρία Κώστας', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/pizzaathina/', title: 'Πιτσαρία Κώστας (@pizzaathina) • Instagram photos and videos', content: 'Πιτσαρία Κώστας 📍 Αθήνα 🍕' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'namelocation handle: "tavernaathens" — city in handle + name in title',
    lead: { name: 'Ταβέρνα Σπύρος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/tavernaathens/', title: 'Ταβέρνα Σπύρος (@tavernaathens) • Instagram', content: 'Traditional food Athens 🇬🇷' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Greeklish handle with no name match but display name in title',
    lead: { name: 'Εστιατόριο Παπαδόπουλος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/estiatorio_pap/', title: 'Εστιατόριο Παπαδόπουλος (@estiatorio_pap) • Instagram', content: '📍 Αθήνα | Ελληνική κουζίνα' }],
    expect: 'HAS_INSTAGRAM'
  },
  {
    desc: 'Wrong business — different name in title, city matches only',
    lead: { name: 'Καφέ Νίκος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/athinabar/', title: 'Athens Bar (@athinabar) • Instagram', content: 'The best cocktail bar in Athens 🍹' }],
    expect: 'NO_INSTAGRAM'
  },
  {
    desc: 'Wrong business — different name in title, different city',
    lead: { name: 'Πιτσαρία Μάνος', location: 'Athens', website: '' },
    results: [{ url: 'https://instagram.com/manosthess/', title: 'Manos Pizza (@manosthess) • Instagram', content: 'Pizza in Thessaloniki 🍕' }],
    expect: 'NO_INSTAGRAM'
  },
]

console.log('=== Instagram Logic Test ===\n')
let passed = 0, failed = 0
tests.forEach(t => {
  const result = check(t.lead, t.results)
  const ok = result === t.expect
  if (ok) passed++; else failed++
  console.log((ok ? '✅' : '❌') + ' ' + t.desc)
  if (!ok) {
    console.log('   Expected: ' + t.expect + ' | Got: ' + result)
    // Debug info
    const lead = t.lead
    const nameTokens = toLatinTokens(lead.name)
    console.log('   Name tokens:', nameTokens)
    t.results.forEach(item => {
      const hm = item.url.match(/instagram\.com\/([a-zA-Z0-9_.]{3,})/)
      if (hm) {
        console.log('   Handle:', hm[1], '| handleMatch:', handleMatchesBusiness(hm[1], lead.name, ''))
        if (lead.location && item.content) {
          const terms = getCitySearchTerms(lead.location)
          const snippet = item.content.toLowerCase()
          console.log('   City terms:', terms.slice(0, 5).join(', '))
          console.log('   Snippet:', snippet)
          console.log('   City found:', terms.some(t => snippet.includes(t)))
        }
      }
    })
  }
})

console.log('\n--- Results: ' + passed + '/' + (passed + failed) + ' passed ---\n')

console.log('City term expansion:')
console.log('  "Athens"      ->', getCitySearchTerms('Athens').join(', '))
console.log('  "Αθήνα"       ->', getCitySearchTerms('Αθήνα').join(', '))
console.log('  "Thessaloniki" ->', getCitySearchTerms('Thessaloniki').join(', '))
console.log('  "Kolonaki"    ->', getCitySearchTerms('Kolonaki').join(', '))
