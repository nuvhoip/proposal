// ─── Fuzzy name matching for "Did you mean…?" account suggestions ────────────
//
// Used by routes/accountSuggest.ts when the Hotel Details account search finds
// no exact hit in the Master Registry or HubSpot. Dependency-free (Workers
// bundle size) and tuned for hotel-group / company names: generic words like
// "Hotel", "Group", "Pty Ltd" are ignored for scoring so "Harbour Hotels
// Group" and "Harbor Hotel" still line up.

const GENERIC_WORDS = new Set([
  'the', 'and', 'of', 'at', 'by',
  'hotel', 'hotels', 'group', 'groups', 'resort', 'resorts', 'collection',
  'hospitality', 'holdings', 'management', 'company', 'co',
  'pty', 'ltd', 'limited', 'inc', 'llc', 'plc', 'gmbh', 'sa', 'bv',
])

/** lowercase, strip accents, "&" → "and", punctuation → space, collapse spaces. */
export function normalizeName(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Distinctive tokens — generic words removed (falls back to all tokens if that leaves nothing). */
export function coreTokens(normalized: string): string[] {
  const all = normalized ? normalized.split(' ') : []
  const core = all.filter(t => !GENERIC_WORDS.has(t))
  return core.length ? core : all
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aM = new Array<boolean>(la).fill(false)
  const bM = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb)
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue
      aM[i] = bM[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const m = matches
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3
  let prefix = 0
  while (prefix < 4 && prefix < la && prefix < lb && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `
  const out = new Map<string, number>()
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3)
    out.set(g, (out.get(g) || 0) + 1)
  }
  return out
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0
  const ta = trigrams(a), tb = trigrams(b)
  let inter = 0, total = 0
  ta.forEach((n, g) => { inter += Math.min(n, tb.get(g) || 0); total += n })
  tb.forEach(n => { total += n })
  return total ? (2 * inter) / total : 0
}

/** "intl" → "international": same first letter, every char appears in order. */
function isAbbreviation(q: string, c: string): boolean {
  if (q.length < 3 || q.length >= c.length || q[0] !== c[0]) return false
  let j = 0
  for (const ch of c) if (ch === q[j] && ++j === q.length) return true
  return false
}

/** Best similarity of one query token against any candidate token. */
function tokenScore(q: string, cands: string[]): number {
  let best = 0
  for (const c of cands) {
    if (q === c) return 1
    // Typing a prefix ("marr" → "marriott") is a strong signal.
    if (q.length >= 3 && c.startsWith(q)) best = Math.max(best, 0.92)
    else if (isAbbreviation(q, c)) best = Math.max(best, 0.85)
    const jw = jaroWinkler(q, c)
    // Short tokens give noisy Jaro-Winkler scores — require a tighter match.
    const floor = Math.min(q.length, c.length) <= 3 ? 0.9 : 0.82
    if (jw >= floor) best = Math.max(best, jw)
  }
  return best
}

/**
 * 0..1 similarity between what was typed and a candidate account name.
 * Takes the best of: token-by-token fuzzy match, whole-string trigram
 * overlap, substring containment, and acronym match ("IHG").
 */
export function nameSimilarity(query: string, candidate: string): number {
  const qn = normalizeName(query), cn = normalizeName(candidate)
  if (!qn || !cn) return 0
  if (qn === cn) return 1

  const qt = coreTokens(qn), ct = coreTokens(cn)
  const qCore = qt.join(''), cCore = ct.join('')

  // Token match — mostly the average over the query's tokens (every word
  // typed counts), blended with the single best token so "Sofitel Sydney"
  // still surfaces "Sofitel Brisbane".
  const perToken = qt.map(t => tokenScore(t, ct))
  const avg = perToken.reduce((a, b) => a + b, 0) / perToken.length
  const tokenAvg = 0.6 * avg + 0.4 * Math.max(...perToken)

  // Whole-string trigram overlap on the core (spaces removed) — catches
  // spacing differences ("Sea Breeze" vs "Seabreeze") and transpositions.
  const tri = dice(qCore, cCore)

  // Containment — "marriott" inside "marriottinternational".
  let contain = 0
  if (qCore.length >= 3 && cCore.length >= 3 && (cCore.includes(qCore) || qCore.includes(cCore))) {
    contain = 0.8 + 0.15 * (Math.min(qCore.length, cCore.length) / Math.max(qCore.length, cCore.length))
  }

  // Acronym — "ihg" vs InterContinental Hotels Group (generic words count here).
  let acronym = 0
  if (!qn.includes(' ') && qn.length >= 2 && qn.length <= 6) {
    const initials = cn.split(' ').map(t => t[0]).join('')
    if (initials === qn) acronym = 0.85
  }

  return Math.min(1, Math.max(tokenAvg, tri, contain, acronym))
}

/** Distinctive query tokens worth sending to a remote prefix search (HubSpot). */
export function searchStems(query: string, max = 4): string[] {
  const toks = coreTokens(normalizeName(query)).filter(t => t.length >= 3)
  const stems = new Set<string>()
  for (const t of toks) {
    // A short stem tolerates typos later in the word ("marriot" → "marr*").
    stems.add(t.slice(0, Math.min(4, t.length)))
    if (stems.size >= max) break
  }
  return Array.from(stems)
}
