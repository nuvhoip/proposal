// Proxies real HubSpot CRM calls for the proposal wizard's Step 1 "HubSpot"
// section — the client-vs-CRM check Ody asked for, kept separate from the
// Nuvho Master Registry hotel-group lookup in routes/registry.ts (that's a
// different system: hgid/entityCode vs. HubSpot company/contact ids).
// Mirrors the read-only proxy pattern in registry.ts so HUBSPOT_API_KEY
// never reaches the browser.

import type { Env } from '../types'
import { ok, err } from '../lib/response'
import { getHotelGroup } from '../lib/registry'
import {
  type DealEvent, getDealPipelines, normalizeRegion, pipelineIdFor, sentStageIdFor,
  regionForPipelineId, firstOpenStage,
} from '../lib/hubspotPipelines'

const HUBSPOT_BASE = 'https://api.hubapi.com'

interface HubspotSearchResult {
  id:   string
  type: 'company' | 'contact'
  name: string
  sub:  string
  hgid: string | null
  pid:  string | null
}

// NUVCL-123: HubSpot Deal linking on Hotel Details.
interface HubspotDealResult {
  id:     string
  name:   string
  amount: string | null
  stage:  string | null
}

async function hubspotFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${env.HUBSPOT_API_KEY}`,
      'Content-Type':  'application/json',
      ...(init.headers || {}),
    },
  })
}

async function searchObjectType(
  env: Env,
  objectType: 'companies' | 'contacts',
  filterGroups: { filters: { propertyName: string; operator: string; value: string }[] }[],
  properties: string[]
): Promise<any[]> {
  const res = await hubspotFetch(env, `/crm/v3/objects/${objectType}/search`, {
    method: 'POST',
    body: JSON.stringify({ filterGroups, properties, limit: 10 }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error(`[HubSpot search] ${objectType} failed:`, res.status, detail)
    return []
  }
  const data = await res.json() as { results?: any[] }
  return data.results || []
}

/* ─── GET /hubspot/search?q=... ──────────────────────────────────────────
 * Searches HubSpot companies (by name) and contacts (by email/first/last
 * name) for a simple free-text query, returning a normalized flat list the
 * frontend can render directly.
 */
export async function searchHubspotObjects(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const q   = (url.searchParams.get('q') || '').trim()
  if (q.length < 2) return err('q must be at least 2 characters.')
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)

  const [companies, contacts] = await Promise.all([
    searchObjectType(
      env, 'companies',
      [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: q }] }],
      // hgid/pid included so the wizard can tell whether a matching HubSpot
      // company is already linked to the Master Registry without a second
      // round-trip — see the hgid/pid reconciliation flow in the frontend.
      ['name', 'domain', 'hgid', 'pid'],
    ),
    searchObjectType(
      env, 'contacts',
      [
        { filters: [{ propertyName: 'email',     operator: 'CONTAINS_TOKEN', value: q }] },
        { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: q }] },
        { filters: [{ propertyName: 'lastname',  operator: 'CONTAINS_TOKEN', value: q }] },
      ],
      ['firstname', 'lastname', 'email', 'phone'],
    ),
  ])

  const results: HubspotSearchResult[] = [
    ...companies.map(c => ({
      id:   c.id as string,
      type: 'company' as const,
      name: c.properties?.name || '(unnamed company)',
      sub:  c.properties?.domain || '',
      hgid: c.properties?.hgid || null,
      pid:  c.properties?.pid  || null,
    })),
    ...contacts.map(c => ({
      id:   c.id as string,
      type: 'contact' as const,
      name: [c.properties?.firstname, c.properties?.lastname].filter(Boolean).join(' ') || '(unnamed contact)',
      sub:  c.properties?.email || '',
      hgid: null,
      pid:  null,
    })),
  ]

  return ok({ results })
}

/* ─── PATCH /hubspot/companies/:id ────────────────────────────────────────
 * Writes hgid/pid onto an existing Company — used once the Master Registry
 * side of a hotel group/property is resolved (created or matched) and the
 * link needs to be pushed back onto HubSpot.
 */
export async function updateHubspotCompany(request: Request, env: Env, companyId: string): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }

  const hgid = typeof body?.hgid === 'string' ? body.hgid.trim() : ''
  const pid  = typeof body?.pid === 'string' ? body.pid.trim() : ''
  if (!hgid && !pid) return err('hgid or pid is required.')
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)

  const properties: Record<string, string> = {}
  if (hgid) properties.hgid = hgid
  if (pid) properties.pid = pid

  const res = await hubspotFetch(env, `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[HubSpot] company update failed:', res.status, detail)
    return err('Could not update the HubSpot company.', 502)
  }

  return ok({ companyId, hgid: hgid || null, pid: pid || null })
}

/* ─── POST /hubspot/clients ───────────────────────────────────────────────
 * Creates a new Company (and, if contact details are present, a Contact
 * associated to it) when the wizard search above finds no existing match.
 * Uses HubSpot's v4 default-associations endpoint so we don't need to look
 * up a numeric association type id for the simple company↔contact case.
 */
export async function createHubspotClient(request: Request, env: Env): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }

  const companyName  = typeof body?.companyName === 'string' ? body.companyName.trim() : ''
  const contactName  = typeof body?.contactName === 'string' ? body.contactName.trim() : ''
  const contactEmail = typeof body?.contactEmail === 'string' ? body.contactEmail.trim() : ''
  const contactPhone = typeof body?.contactPhone === 'string' ? body.contactPhone.trim() : ''
  // Optional — set directly at creation when the Master Registry hgid/pid are
  // already known (e.g. creating the HubSpot side of an existing registry
  // hotel group/property). Omit to create the company without them.
  const hgid = typeof body?.hgid === 'string' ? body.hgid.trim() : ''
  const pid  = typeof body?.pid === 'string' ? body.pid.trim() : ''

  if (!companyName) return err('companyName is required.')
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)

  const companyRes = await hubspotFetch(env, '/crm/v3/objects/companies', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        name: companyName,
        ...(hgid ? { hgid } : {}),
        ...(pid ? { pid } : {}),
      },
    }),
  })
  if (!companyRes.ok) {
    const detail = await companyRes.text().catch(() => '')
    console.error('[HubSpot] company create failed:', companyRes.status, detail)
    return err('Could not create HubSpot company.', 502)
  }
  const company: { id: string } = await companyRes.json()
  const companyId = company.id

  let contactId: string | null = null
  if (contactEmail || contactName) {
    const [firstname, ...rest] = contactName.split(' ')
    const lastname = rest.join(' ')
    const contactRes = await hubspotFetch(env, '/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          ...(firstname ? { firstname } : {}),
          ...(lastname ? { lastname } : {}),
          ...(contactEmail ? { email: contactEmail } : {}),
          ...(contactPhone ? { phone: contactPhone } : {}),
        },
      }),
    })
    if (!contactRes.ok) {
      const detail = await contactRes.text().catch(() => '')
      console.error('[HubSpot] contact create failed:', contactRes.status, detail)
      // The company was still created successfully — don't fail the whole request.
    } else {
      const contact: { id: string } = await contactRes.json()
      contactId = contact.id

      const assocRes = await hubspotFetch(
        env,
        `/crm/v4/objects/companies/${companyId}/associations/default/contacts/${contactId}`,
        { method: 'PUT' },
      )
      if (!assocRes.ok) {
        const detail = await assocRes.text().catch(() => '')
        console.error('[HubSpot] company↔contact association failed:', assocRes.status, detail)
      }
    }
  }

  return ok({ companyId, contactId }, 201)
}
/* ─── GET /hubspot/deals/search?q=... ─────────────────────────────────────
 * NUVCL-123: searches HubSpot deals by name for the Hotel Details "link an
 * existing Deal" affordance. Mirrors searchHubspotObjects()'s pattern above.
 */
export async function searchHubspotDeals(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const q   = (url.searchParams.get('q') || '').trim()
  if (q.length < 2) return err('q must be at least 2 characters.')
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)

  const deals = await searchObjectType(
    env, 'deals' as 'companies' | 'contacts', // same generic search shape as companies/contacts
    [{ filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: q }] }],
    ['dealname', 'amount', 'dealstage'],
  )

  const results: HubspotDealResult[] = deals.map(d => ({
    id:     d.id as string,
    name:   d.properties?.dealname || '(unnamed deal)',
    amount: d.properties?.amount ?? null,
    stage:  d.properties?.dealstage ?? null,
  }))

  return ok({ results })
}

/* ─── POST /hubspot/deals ──────────────────────────────────────────────────
 * NUVCL-123: creates a new Deal when the search above finds no match, and
 * associates it to the given Company/Contact (whichever ids are known at
 * this point in Hotel Details) via the v4 default-associations endpoint —
 * same pattern as createHubspotClient()'s company↔contact association.
 */
export async function createHubspotDeal(request: Request, env: Env): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }

  const dealName   = typeof body?.dealName === 'string' ? body.dealName.trim() : ''
  const companyId  = typeof body?.companyId === 'string' ? body.companyId.trim() : ''
  const contactId  = typeof body?.contactId === 'string' ? body.contactId.trim() : ''
  const region     = typeof body?.region === 'string' ? body.region.trim() : ''

  if (!dealName) return err('dealName is required.')
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)

  const dealId = await createDealRecord(env, { dealName, companyId, contactId, region: region || null })
  if (!dealId) return err('Could not create HubSpot deal.', 502)
  return ok({ dealId, dealName }, 201)
}

/* ═══ 2026-10-14: automatic deal linking ═══════════════════════════════════
 * The wizard already knows the hotel group (hgid → registry hubspot_id =
 * HubSpot Company) and the property name(s), so it can suggest the deal
 * instead of making staff search for it:
 *   - GET /hubspot/deals/suggest  → open deals on the group's Company
 *     (plus open deals whose name matches the property), ranked by name match.
 *     Staff confirm the suggestion in Step 1 — nothing is linked silently.
 *   - ensureProposalDeal()       → on save, when no deal is linked, create one
 *     (associated to the Company/Contact) so every proposal lands in HubSpot.
 *   - syncDealForProposalEvent() → stage/amount updates with logged failures,
 *     configurable stage ids, and no moving a deal backwards in its pipeline.
 */

// 2026-10-20: one pipeline per geo (UK / AU / EU), ids from
// HUBSPOT_PIPELINE_ID / HUBSPOT_STAGE_SENT — see lib/hubspotPipelines.ts.

/** Creates a Deal and associates it to the Company/Contact when given.
 *  Returns the new deal id, or null on failure (logged). */
export async function createDealRecord(
  env: Env,
  opts: { dealName: string; companyId?: string | null; contactId?: string | null; region?: string | null; amount?: number | null },
): Promise<string | null> {
  const properties: Record<string, string> = { dealname: opts.dealName }
  // New deals go into the proposal region's pipeline (UK / AU / EU), at that
  // pipeline's first open stage. HubSpot needs a stage that belongs to the
  // pipeline, so if the pipeline can't be read the deal is NOT created in
  // some other geo's pipeline — it's skipped and logged instead.
  if (opts.region) {
    const region = normalizeRegion(opts.region)
    const pipelineId = pipelineIdFor(env, region)
    if (!pipelineId) {
      console.error(`[HubSpot] HUBSPOT_PIPELINE_ID has no pipeline for ${region.toUpperCase() === 'IE' ? 'EU' : region.toUpperCase()} — deal not created`)
      return null
    }
    const pipeline = (await getDealPipelines(env)).find(p => p.id === pipelineId)
    const stage = firstOpenStage(pipeline)
    if (!stage) {
      console.error(`[HubSpot] pipeline ${pipelineId} (${region}) not found in HubSpot — deal not created. Check GET /hubspot/pipelines.`)
      return null
    }
    properties.pipeline  = pipelineId
    properties.dealstage = stage.id
  }
  if (typeof opts.amount === 'number' && Number.isFinite(opts.amount) && opts.amount > 0) {
    properties.amount = String(opts.amount)
  }

  const dealRes = await hubspotFetch(env, '/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  })
  if (!dealRes.ok) {
    const detail = await dealRes.text().catch(() => '')
    console.error('[HubSpot] deal create failed:', dealRes.status, detail)
    return null
  }
  const deal: { id: string } = await dealRes.json()
  const dealId = deal.id

  for (const [objType, objId] of [['companies', opts.companyId], ['contacts', opts.contactId]] as const) {
    if (!objId) continue
    const assocRes = await hubspotFetch(
      env,
      `/crm/v4/objects/deals/${dealId}/associations/default/${objType}/${objId}`,
      { method: 'PUT' },
    )
    if (!assocRes.ok) {
      const detail = await assocRes.text().catch(() => '')
      console.error(`[HubSpot] deal↔${objType} association failed:`, assocRes.status, detail)
      // Don't fail the whole request — the deal itself was created successfully.
    }
  }
  return dealId
}

/** The hotel group's HubSpot Company id, from the Master Registry. */
export async function resolveCompanyIdForHgid(env: Env, hgid: string | null | undefined): Promise<string | null> {
  if (!hgid) return null
  try {
    const hg = await getHotelGroup(env, hgid)
    return hg.hubspot_id || null
  } catch (e) {
    console.error('[HubSpot] could not resolve company for hgid', hgid, e)
    return null
  }
}

interface SuggestedDeal extends HubspotDealResult {
  score:  number
  source: 'company' | 'name'
  closed: boolean          // 2026-10-20: closed deals are now included (labelled, listed last)
  won:    boolean
  createdAt: string | null
}

const STOP_WORDS = new Set(['the', 'hotel', 'hotels', 'and', 'resort', 'group', 'by', 'at', 'of', '&', '-', 'pty', 'ltd'])

function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

/** 0–1: share of the target's significant words that appear in the deal name. */
function matchScore(dealName: string, targets: string[]): number {
  const dealSet = new Set(nameTokens(dealName))
  let best = 0
  for (const t of targets) {
    const toks = nameTokens(t)
    if (!toks.length) continue
    const hits = toks.filter(x => dealSet.has(x)).length
    best = Math.max(best, hits / toks.length)
  }
  return Math.round(best * 100) / 100
}

const DEAL_PROPS = ['dealname', 'amount', 'dealstage', 'pipeline', 'hs_is_closed', 'hs_is_closed_won', 'createdate']

async function readDeals(env: Env, ids: string[]): Promise<any[]> {
  if (!ids.length) return []
  const res = await hubspotFetch(env, '/crm/v3/objects/deals/batch/read', {
    method: 'POST',
    body: JSON.stringify({ inputs: ids.slice(0, 100).map(id => ({ id })), properties: DEAL_PROPS }),
  })
  if (!res.ok) {
    console.error('[HubSpot] deal batch read failed:', res.status, await res.text().catch(() => ''))
    return []
  }
  const data = await res.json() as { results?: any[] }
  return data.results || []
}

async function dealIdsForCompany(env: Env, companyId: string): Promise<string[]> {
  const res = await hubspotFetch(env, `/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/deals?limit=100`)
  if (!res.ok) {
    console.error('[HubSpot] company→deals lookup failed:', res.status, await res.text().catch(() => ''))
    return []
  }
  const data = await res.json() as { results?: { toObjectId: number | string }[] }
  return (data.results || []).map(r => String(r.toObjectId))
}

async function searchDealsByText(env: Env, text: string): Promise<any[]> {
  if (text.trim().length < 3) return []
  const res = await hubspotFetch(env, '/crm/v3/objects/deals/search', {
    method: 'POST',
    body: JSON.stringify({ query: text.trim().slice(0, 200), properties: DEAL_PROPS, limit: 10 }),
  })
  if (!res.ok) {
    console.error('[HubSpot] deal text search failed:', res.status, await res.text().catch(() => ''))
    return []
  }
  const data = await res.json() as { results?: any[] }
  return data.results || []
}

/** 2026-10-20: EVERY deal whose name contains all of the property name's
 *  significant words (e.g. "Sofitel Brisbane Central" → sofitel* AND
 *  brisbane* AND central*), open or closed, newest first — paginated, not the
 *  10-result full-text search above. Falls back to that full-text search
 *  only when the strict word match finds nothing. */
const DEAL_NAME_PAGE_SIZE = 100
const DEAL_NAME_MAX_PAGES = 3   // up to 300 deals per property name

async function searchDealsByPropertyName(env: Env, propertyName: string): Promise<any[]> {
  // HubSpot allows at most 6 filters per filterGroup — keep the longest words.
  const toks = [...new Set(nameTokens(propertyName))].sort((a, b) => b.length - a.length).slice(0, 6)
  if (!toks.length) return []
  const out: any[] = []
  let after: string | undefined
  for (let page = 0; page < DEAL_NAME_MAX_PAGES; page++) {
    const res = await hubspotFetch(env, '/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: toks.map(t => ({ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: `${t}*` })),
        }],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        properties: DEAL_PROPS,
        limit: DEAL_NAME_PAGE_SIZE,
        ...(after ? { after } : {}),
      }),
    })
    if (!res.ok) {
      console.error('[HubSpot] deal property-name search failed:', res.status, await res.text().catch(() => ''))
      break
    }
    const data = await res.json() as { results?: any[]; paging?: { next?: { after?: string } } }
    out.push(...(data.results || []))
    after = data.paging?.next?.after
    if (!after) break
  }
  return out.length ? out : searchDealsByText(env, propertyName)
}

/* ─── GET /hubspot/deals/suggest?hgid=&companyId=&name=&group= ─────────────
 * Open deals for this proposal, best match first. Company-associated deals
 * come first; deals found only by property-name search are included with
 * source 'name' so staff can still confirm them.
 */
export async function suggestHubspotDeals(request: Request, env: Env): Promise<Response> {
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)
  const url   = new URL(request.url)
  const hgid  = (url.searchParams.get('hgid') || '').trim()
  // `name` may repeat — the document's property name plus each ticked
  // registry property's own name (multi-property proposals).
  const names = [...new Set(url.searchParams.getAll('name').map(n => n.trim()).filter(Boolean))].slice(0, 4)
  const group = (url.searchParams.get('group') || '').trim()
  let companyId = (url.searchParams.get('companyId') || '').trim()
  if (!companyId) companyId = (await resolveCompanyIdForHgid(env, hgid)) || ''

  const targets = [...names, group].filter(Boolean)
  const byId = new Map<string, SuggestedDeal>()

  const toSuggestion = (d: any, source: 'company' | 'name'): SuggestedDeal | null => {
    const dealName = d.properties?.dealname || '(unnamed deal)'
    return {
      id:     String(d.id),
      name:   dealName,
      amount: d.properties?.amount ?? null,
      stage:  d.properties?.dealstage ?? null,
      score:  matchScore(dealName, targets),
      source,
      closed: d.properties?.hs_is_closed === 'true',
      won:    d.properties?.hs_is_closed_won === 'true',
      createdAt: d.properties?.createdate ?? null,
    }
  }

  if (companyId) {
    for (const d of await readDeals(env, await dealIdsForCompany(env, companyId))) {
      const s = toSuggestion(d, 'company')
      if (s) byId.set(s.id, s)
    }
  }
  for (const name of names) {
    for (const d of await searchDealsByPropertyName(env, name)) {
      if (byId.has(String(d.id))) continue
      const s = toSuggestion(d, 'name')
      // Name-only hits must actually look like this property (the strict
      // word filter already guarantees it; this guards the full-text fallback).
      if (s && s.score >= 0.5) byId.set(s.id, s)
    }
  }

  // Open before closed → best property-name match → this group's own deals
  // before name-only hits → newest first.
  const results = [...byId.values()].sort((a, b) =>
    Number(a.closed) - Number(b.closed)
    || b.score - a.score
    || (a.source === b.source ? 0 : a.source === 'company' ? -1 : 1)
    || (b.createdAt || '').localeCompare(a.createdAt || ''))

  return ok({ companyId: companyId || null, results })
}

/** On save: when the proposal has no deal linked, create one so it is tracked
 *  in HubSpot. Never throws — a HubSpot problem must not block a save. */
export async function ensureProposalDeal(
  env: Env,
  opts: { dealId?: string | null; dealName: string; hgid?: string | null; companyId?: string | null; contactId?: string | null; region?: string | null },
): Promise<{ dealId: string | null; created: boolean }> {
  if (opts.dealId) return { dealId: opts.dealId, created: false }
  if (!env.HUBSPOT_API_KEY || !opts.dealName.trim()) return { dealId: null, created: false }
  try {
    const companyId = opts.companyId || await resolveCompanyIdForHgid(env, opts.hgid)
    const dealId = await createDealRecord(env, {
      dealName:  opts.dealName.trim(),
      companyId,
      contactId: opts.contactId || null,
      region:    opts.region || 'au',
    })
    return { dealId, created: !!dealId }
  } catch (e) {
    console.error('[HubSpot] auto-create deal failed:', e)
    return { dealId: null, created: false }
  }
}

/** Moves the deal to the stage for this proposal event and updates the amount.
 *  The stage only moves forward, and only to a stage that exists in the
 *  deal's own pipeline; every failure is logged. */
export async function syncDealForProposalEvent(
  env: Env, dealId: string, event: DealEvent, amount: number, regionRaw?: string | null,
): Promise<void> {
  // 2026-10-20: won / lost and other later stages are worked manually in
  // HubSpot — the system never touches a deal on signing.
  if (event === 'won') return

  const properties: Record<string, string> = { amount: String(amount) }

  try {
    if (event === 'sent') {
      const dealRes = await hubspotFetch(env, `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealstage,pipeline`)
      if (!dealRes.ok) {
        console.error(`[HubSpot] deal ${dealId} read failed:`, dealRes.status, await dealRes.text().catch(() => ''))
        return
      }
      const deal = await dealRes.json() as { properties?: { dealstage?: string; pipeline?: string } }
      const dealPipelineId = deal.properties?.pipeline || ''
      // Use the "sent" stage of the pipeline the deal is ACTUALLY in (a deal
      // linked by hand may sit in another geo's pipeline — it's never moved
      // across pipelines).
      const pipeRegion = regionForPipelineId(env, dealPipelineId)
      const proposalRegion = normalizeRegion(regionRaw)
      if (pipeRegion && pipeRegion !== proposalRegion) {
        console.warn(`[HubSpot] deal ${dealId} is in the ${pipeRegion} pipeline but the proposal is ${proposalRegion} — updating it in its own pipeline`)
      }
      const target = pipeRegion ? sentStageIdFor(env, pipeRegion) : null

      if (!target) {
        console.error(`[HubSpot] deal ${dealId}: no HUBSPOT_STAGE_SENT for its pipeline "${dealPipelineId}" — amount only updated`)
      } else {
        // Forward only: never drag a deal back from a later stage someone set
        // manually (e.g. negotiation, closed won/lost).
        const pipe = (await getDealPipelines(env)).find(p => p.id === dealPipelineId)
        const targetS = pipe?.stages.find(st => st.id === target)
        const currS   = pipe?.stages.find(st => st.id === deal.properties?.dealstage)
        if (!pipe || !targetS) {
          console.error(`[HubSpot] stage ${target} not found in pipeline ${dealPipelineId} — amount only updated. Check GET /hubspot/pipelines.`)
        } else if (!currS || targetS.displayOrder > currS.displayOrder) {
          properties.dealstage = target
        }
      }
    }

    const res = await hubspotFetch(env, `/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    })
    if (!res.ok) {
      console.error(`[HubSpot] deal ${dealId} update (${event}) failed:`, res.status, await res.text().catch(() => ''))
    }
  } catch (e) {
    console.error(`[HubSpot] deal ${dealId} sync (${event}) failed:`, e)
  }
}

/* ─── GET /hubspot/pipelines ─────────────────────────────────────────────
 * Diagnostic: which HubSpot pipeline + stages each proposal region resolves
 * to, plus every deal pipeline in the account (ids + names) for setting
 * HUBSPOT_PIPELINES when the defaults don't match.
 */
export async function listResolvedPipelines(env: Env): Promise<Response> {
  if (!env.HUBSPOT_API_KEY) return err('HubSpot is not configured', 500)
  const pipelines = await getDealPipelines(env, true)
  const brief = (x: { id: string; label: string } | null | undefined) => x ? { id: x.id, label: x.label } : null
  const regions = (['uk', 'au', 'ie'] as const).map(region => {
    const pipelineId = pipelineIdFor(env, region)
    const sentId     = sentStageIdFor(env, region)
    const pipe = pipelines.find(p => p.id === pipelineId) || null
    return {
      region, geo: region === 'ie' ? 'EU' : region.toUpperCase(),
      configured: { pipelineId, sentStageId: sentId },
      pipeline:        brief(pipe),                                       // null = id not found in HubSpot
      newDealStage:    brief(firstOpenStage(pipe)),
      sentStage:       brief(pipe?.stages.find(s => s.id === sentId)),    // null = id not in that pipeline
    }
  })
  return ok({
    regions,
    pipelines: pipelines.map(p => ({ id: p.id, label: p.label, stages: p.stages.map(s => ({ id: s.id, label: s.label })) })),
  })
}
