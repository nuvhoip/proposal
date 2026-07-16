// ─── Nuvho Master Registry client (register.nuvho.com) ───────────────────────
//
// Server-side only. REGISTRY_API_KEY (X-Registry-Key) must never be exposed
// to the frontend — routes/registry.ts proxies the read-only lookups the
// wizard needs so the browser never sees the key.
//
// A registry "proposal" record accepts exactly one service_line. A Nuvho
// proposal can bundle several (RM, SM, MK, CR…), so callers create one
// registry proposal per bundled service line and track each in the local
// proposal_registry_links table (see routes/proposals.ts).

import type { Env } from '../types'

const DEFAULT_BASE_URL = 'https://register.nuvho.com'

export class RegistryError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'RegistryError'
    this.status = status
    this.code = code
  }
}

function baseUrl(env: Env): string {
  return (env.REGISTRY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

async function registryFetch<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Registry-Key': env.REGISTRY_API_KEY,
      ...(init.headers as Record<string, string> | undefined),
    },
  })

  let body: any = null
  try { body = await res.json() } catch { /* non-JSON error page from an edge/proxy layer */ }

  if (!res.ok || !body || body.success === false) {
    const code = body?.error?.code || 'REGISTRY_UNKNOWN_ERROR'
    const message = body?.error?.message || `Registry request failed with status ${res.status}`
    throw new RegistryError(res.status, code, message)
  }

  return body.data as T
}

/* ─── Hotel Groups (read-only lookups for the proposal wizard) ────────────── */

export interface RegistryHotelGroupSummary {
  hgid: string
  group_name: string
  trading_name: string | null
  geo: string
  status: string
}

export interface RegistryHotelGroupRecord extends RegistryHotelGroupSummary {
  entity_code: string
  hubspot_id: string | null
  thc_tenant_id: string | null
  asana_tag: string | null
  sharepoint_path: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** GET /v1/hotel-groups/typeahead — q must be >=2 chars. Excludes churned groups, max 10 results. */
export async function hotelGroupTypeahead(
  env: Env, q: string, geo?: string
): Promise<RegistryHotelGroupSummary[]> {
  const params = new URLSearchParams({ q })
  if (geo) params.set('geo', geo)
  return registryFetch<RegistryHotelGroupSummary[]>(env, `/v1/hotel-groups/typeahead?${params.toString()}`)
}

/** GET /v1/hotel-groups/:hgid — full record, used to resolve entity_code after a typeahead selection. */
export async function getHotelGroup(env: Env, hgid: string): Promise<RegistryHotelGroupRecord> {
  return registryFetch<RegistryHotelGroupRecord>(env, `/v1/hotel-groups/${encodeURIComponent(hgid)}`)
}

export interface CreateHotelGroupPayload {
  entity_code: string
  group_name: string
  trading_name?: string
  geo: string
  status?: 'prospect' | 'onboarding'
}

/** POST /v1/hotel-groups — creates a new hotel group in the master registry.
 *  Used by the proposal wizard's "Add Hotel Group" flow when a search turns
 *  up no existing match. Status defaults to 'prospect' (the only sensible
 *  choice for a group being proposed to for the first time — the registry
 *  validator only allows 'prospect'|'onboarding' at creation). */
export async function createHotelGroup(
  env: Env, payload: CreateHotelGroupPayload
): Promise<RegistryHotelGroupRecord> {
  return registryFetch<RegistryHotelGroupRecord>(env, '/v1/hotel-groups', {
    method: 'POST',
    body: JSON.stringify({ status: 'prospect', ...payload }),
  })
}

export interface RegistryEntity {
  entity_code: string
  legal_name: string
  jurisdiction: string
  role: string
  is_data_controller: boolean
  is_active: boolean
}

/** GET /v1/ref/entities — active legal entities, used to populate the "legal
 *  entity" choice when creating a new hotel group from the proposal wizard.
 *  (Entity/geo/market reference data lives under the refRouter's /v1/ref
 *  mount in the master registry — not /v1 directly.) */
export async function listEntities(env: Env): Promise<RegistryEntity[]> {
  return registryFetch<RegistryEntity[]>(env, '/v1/ref/entities')
}

/* ─── Proposals ─────────────────────────────────────────────────────────────── */

export type RegistryServiceLine = 'RM' | 'SM' | 'MK' | 'CR' | 'WA' | 'PO' | 'CO' | 'MS'
export type RegistryProposalStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'expired'

export interface RegistryProposalPayload {
  hgid: string
  entity_code: string
  service_line: RegistryServiceLine
  geo: string
  pid?: string | null
  status?: RegistryProposalStatus
  signed_at?: string | null
  sent_at?: string | null
  expires_at?: string | null
  hubspot_deal_id?: string | null
  sharepoint_path?: string | null
}

export interface RegistryProposalRecord {
  prop_id: string
  hgid: string
  entity_code: string
  service_line: RegistryServiceLine
  geo: string
  status: string
  [key: string]: unknown
}

/** POST /v1/proposals — creates one canonical PROP-{GEO}-{YYYY}-{SEQ4} record for a single service_line. */
export async function createRegistryProposal(
  env: Env, payload: RegistryProposalPayload
): Promise<RegistryProposalRecord> {
  return registryFetch<RegistryProposalRecord>(env, '/v1/proposals', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** PATCH /v1/proposals/:propId — status transitions (sent/signed/declined/expired) and timestamps. */
export async function updateRegistryProposal(
  env: Env, propId: string, patch: Partial<RegistryProposalPayload>
): Promise<RegistryProposalRecord> {
  return registryFetch<RegistryProposalRecord>(env, `/v1/proposals/${encodeURIComponent(propId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/* ─── NP-ID (client-facing "Proposal ID", R1 ID Reference schema v1.3) ────── */

export interface RegistryNpIdRecord {
  np_id: string
  region: string
  issued_to: string | null
  created_at: string
}

/** POST /v1/np-ids — reserves one NP-{REGION}-{YYMMDD}-{6RAND} per bundled
 *  proposal (not per service line — see createProposal in routes/proposals.ts). */
export async function reserveNpId(
  env: Env, region: string, issuedTo?: string
): Promise<RegistryNpIdRecord> {
  return registryFetch<RegistryNpIdRecord>(env, '/v1/np-ids', {
    method: 'POST',
    body: JSON.stringify({ region, issued_to: issuedTo ?? null }),
  })
}
