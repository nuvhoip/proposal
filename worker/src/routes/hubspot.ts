// Proxies real HubSpot CRM calls for the proposal wizard's Step 1 "HubSpot"
// section — the client-vs-CRM check Ody asked for, kept separate from the
// Nuvho Master Registry hotel-group lookup in routes/registry.ts (that's a
// different system: hgid/entityCode vs. HubSpot company/contact ids).
// Mirrors the read-only proxy pattern in registry.ts so HUBSPOT_API_KEY
// never reaches the browser.

import type { Env } from '../types'
import { ok, err } from '../lib/response'

const HUBSPOT_BASE = 'https://api.hubapi.com'

interface HubspotSearchResult {
  id:   string
  type: 'company' | 'contact'
  name: string
  sub:  string
  hgid: string | null
  pid:  string | null
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
