/** Structured client address captured on wizard Step 1 (migration 0019).
 *  Stored as proposals.property_address_json; proposals.property_address
 *  keeps the formatted multi-line text the document and Word export render. */
export interface PostalAddress {
  line1:    string
  line2:    string
  suburb:   string
  city:     string
  state:    string
  postcode: string
  country:  string
}

export const EMPTY_ADDRESS: PostalAddress = {
  line1: '', line2: '', suburb: '', city: '', state: '', postcode: '', country: '',
}

/** Letter format, one part per line: line 1 / line 2 / suburb /
 *  "city state postcode" / country. Empty parts are skipped. Must match the
 *  worker's formatAddress (worker/src/routes/proposals.ts). */
export function formatAddress(a: PostalAddress | null | undefined): string {
  if (!a) return ''
  const t = (v: string) => (v || '').trim()
  const cityLine = [t(a.city), t(a.state), t(a.postcode)].filter(Boolean).join(' ')
  return [t(a.line1), t(a.line2), t(a.suburb), cityLine, t(a.country)].filter(Boolean).join('\n')
}

/** Read a saved proposal's address: the structured JSON when present, else
 *  the legacy free-text property_address dropped into Address line 1. */
export function parseSavedAddress(json: string | null | undefined, legacy: string | null | undefined): PostalAddress {
  if (json) {
    try {
      const v = JSON.parse(json)
      if (v && typeof v === 'object') {
        const out = { ...EMPTY_ADDRESS }
        for (const k of Object.keys(EMPTY_ADDRESS) as (keyof PostalAddress)[]) {
          if (typeof v[k] === 'string') out[k] = v[k]
        }
        return out
      }
    } catch { /* fall through to legacy */ }
  }
  return { ...EMPTY_ADDRESS, line1: (legacy || '').replace(/\s*\n\s*/g, ', ') }
}

/** Saved proposal's ticked properties: pids_json, else the legacy single pid. */
export function parseSavedPids(json: string | null | undefined, legacyPid?: string | null): string[] {
  if (json) {
    try {
      const v = JSON.parse(json)
      if (Array.isArray(v)) return v.filter((p): p is string => typeof p === 'string' && !!p)
    } catch { /* fall through */ }
  }
  return legacyPid ? [legacyPid] : []
}

/** "A" · "A & B" · "A, B & C" — the document name for a proposal whose
 *  engagement ID covers several properties. */
export function joinPropertyNames(names: string[]): string {
  const n = names.map(s => s.trim()).filter(Boolean)
  if (n.length <= 1) return n[0] || ''
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`
}
