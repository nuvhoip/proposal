// GET /accounts/similar?q=... — "Did you mean…?" suggestions for the wizard's
// Hotel Details → Hotel group / account search.
//
// The frontend only calls this when the exact searches (registry typeahead +
// /hubspot/search) both come back empty. It fuzzy-ranks:
//   - Registry: the full hotel-group list (the typeahead is substring-only and
//     can't tolerate typos), cached per isolate for a few minutes.
//   - HubSpot: a wider candidate pool pulled with prefix-wildcard stems of the
//     query ("marr*"), then scored locally with the same matcher.
// Either side failing just yields an empty list for that side — suggestions
// are best-effort and must never block the wizard.

import type { Env } from '../types'
import { ok, err } from '../lib/response'
import { listAllHotelGroups, type RegistryHotelGroupSummary } from '../lib/registry'
import { nameSimilarity, searchStems } from '../lib/fuzzy'

const MIN_SCORE = 0.55
const MAX_PER_SOURCE = 6
const REGISTRY_CACHE_MS = 5 * 60 * 1000

let registryCache: { at: number; groups: RegistryHotelGroupSummary[] } | null = null

async function registryGroups(env: Env): Promise<RegistryHotelGroupSummary[]> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) return registryCache.groups
  const groups = await listAllHotelGroups(env)
  registryCache = { at: Date.now(), groups }
  return groups
}

async function registrySuggestions(env: Env, q: string) {
  try {
    const groups = await registryGroups(env)
    return groups
      // Same exclusion as the registry typeahead — churned groups stay hidden.
      .filter(g => (g.status || '').toLowerCase() !== 'churned')
      .map(g => ({
        ...g,
        score: Math.max(
          nameSimilarity(q, g.group_name),
          g.trading_name ? nameSimilarity(q, g.trading_name) : 0,
        ),
      }))
      .filter(g => g.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_SOURCE)
  } catch (e) {
    console.error('[accounts/similar] registry lookup failed:', e instanceof Error ? e.message : e)
    return []
  }
}

async function hubspotSuggestions(env: Env, q: string) {
  if (!env.HUBSPOT_API_KEY) return []
  const stems = searchStems(q)
  if (!stems.length) return []
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.HUBSPOT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // filterGroups are OR'd — any company with a name token starting with any stem.
        filterGroups: stems.map(s => ({
          filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: `${s}*` }],
        })),
        properties: ['name', 'domain', 'hgid', 'pid'],
        limit: 100,
      }),
    })
    if (!res.ok) {
      console.error('[accounts/similar] HubSpot search failed:', res.status, await res.text().catch(() => ''))
      return []
    }
    const data = await res.json() as { results?: any[] }
    return (data.results || [])
      .map(c => {
        const name = c.properties?.name || '(unnamed company)'
        return {
          id:   String(c.id),
          type: 'company' as const,
          name,
          sub:  c.properties?.domain || '',
          hgid: c.properties?.hgid || null,
          pid:  c.properties?.pid  || null,
          score: nameSimilarity(q, name),
        }
      })
      .filter(r => r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_SOURCE)
  } catch (e) {
    console.error('[accounts/similar] HubSpot search threw:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function handleSimilarAccounts(request: Request, env: Env): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') || '').trim()
  if (q.length < 2) return err('q must be at least 2 characters.')
  const [registry, hubspot] = await Promise.all([registrySuggestions(env, q), hubspotSuggestions(env, q)])
  return ok({ registry, hubspot })
}
