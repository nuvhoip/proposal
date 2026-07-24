// Proxies read-only Nuvho Master Registry lookups for the proposal wizard so
// the browser never receives REGISTRY_API_KEY. Both routes require an
// authenticated staff session (wired in index.ts alongside the other
// authenticated routes).

import type { Env } from '../types'
import { ok, err } from '../lib/response'
import {
  hotelGroupTypeahead,
  getHotelGroup,
  createHotelGroup,
  listEntities,
  updateHotelGroup,
  searchHotelGroupsByHubspotId,
  propertyTypeahead,
  listPropertiesByHgid,
  getProperty,
  createProperty,
  getMarkets,
  RegistryError,
} from '../lib/registry'

export async function handleHotelGroupTypeahead(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const q   = (url.searchParams.get('q') || '').trim()
  const geo = url.searchParams.get('geo')?.trim() || undefined

  if (q.length < 2) return err('q must be at least 2 characters.')

  try {
    const results = await hotelGroupTypeahead(env, q, geo)
    return ok({ results })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

export async function handleGetHotelGroup(env: Env, hgid: string): Promise<Response> {
  try {
    const hotelGroup = await getHotelGroup(env, hgid)
    return ok({ hotelGroup })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

// Creates a new hotel group when the wizard search finds no existing match.
// entity_code/group_name/geo are required by the registry validator; status
// defaults to 'prospect' but the caller may explicitly choose 'onboarding'
// (the only two statuses the registry allows at creation).
const CREATE_STATUSES = ['prospect', 'onboarding'] as const

export async function handleCreateHotelGroup(request: Request, env: Env): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }

  const entity_code   = typeof body?.entity_code === 'string' ? body.entity_code.trim() : ''
  const group_name    = typeof body?.group_name === 'string' ? body.group_name.trim() : ''
  const trading_name  = typeof body?.trading_name === 'string' ? body.trading_name.trim() : undefined
  const geo           = typeof body?.geo === 'string' ? body.geo.trim().toUpperCase() : ''
  const statusRaw     = typeof body?.status === 'string' ? body.status.trim() : ''
  const status        = (CREATE_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as 'prospect' | 'onboarding')
    : undefined

  if (!entity_code || !group_name || !geo) {
    return err('entity_code, group_name, and geo are required.')
  }
  if (statusRaw && !status) {
    return err(`status must be one of: ${CREATE_STATUSES.join(', ')}`)
  }

  // Build the payload without explicit `undefined` keys — createHotelGroup()
  // spreads this over a `{ status: 'prospect', ... }` default, and a present-
  // but-undefined key would silently override that default to undefined.
  const payload: { entity_code: string; group_name: string; geo: string; trading_name?: string; status?: 'prospect' | 'onboarding' } =
    { entity_code, group_name, geo }
  if (trading_name) payload.trading_name = trading_name
  if (status) payload.status = status

  try {
    const hotelGroup = await createHotelGroup(env, payload)
    return ok({ hotelGroup })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry create failed', 502)
  }
}

// Active legal entities, used to populate the "legal entity" choice in the
// Add Hotel Group form.
export async function handleListEntities(env: Env): Promise<Response> {
  try {
    const entities = await listEntities(env)
    return ok({ entities })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

// Writes hubspot_id back onto a registry hotel group once it's been linked
// to (or matched against) a HubSpot Company — see the hgid/pid sync flow in
// routes/hubspot.ts. Only hubspot_id is accepted here; other updatable
// fields (group_name, trading_name, status) go through the same endpoint
// if ever needed but aren't exercised by the wizard yet.
export async function handleUpdateHotelGroup(request: Request, env: Env, hgid: string): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }
  const hubspot_id = typeof body?.hubspot_id === 'string' ? body.hubspot_id.trim() : undefined
  if (!hubspot_id) return err('hubspot_id is required.')

  try {
    const hotelGroup = await updateHotelGroup(env, hgid, { hubspot_id })
    return ok({ hotelGroup })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry update failed', 502)
  }
}

// Reverse lookup — given a HubSpot company id, is there already a registry
// hotel group linked to it? Used to detect "in HubSpot but not (yet) in the
// registry" without relying on name-matching.
export async function handleSearchHotelGroupsByHubspotId(env: Env, hubspotId: string): Promise<Response> {
  try {
    const hotelGroups = await searchHotelGroupsByHubspotId(env, hubspotId)
    return ok({ hotelGroups })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

// Properties (issue pid, scoped to a parent hgid) — mirrors the hotel-group
// typeahead/create pattern above.
export async function handlePropertyTypeahead(request: Request, env: Env): Promise<Response> {
  const url  = new URL(request.url)
  const q    = (url.searchParams.get('q') || '').trim()
  const geo  = url.searchParams.get('geo')?.trim() || undefined
  const hgid = url.searchParams.get('hgid')?.trim() || undefined

  if (q.length < 2) return err('q must be at least 2 characters.')

  try {
    const results = await propertyTypeahead(env, q, { geo, hgid })
    return ok({ results })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

export async function handleListPropertiesByHgid(env: Env, hgid: string): Promise<Response> {
  try {
    const properties = await listPropertiesByHgid(env, hgid)
    return ok({ properties })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

export async function handleGetProperty(env: Env, pid: string): Promise<Response> {
  try {
    const property = await getProperty(env, pid)
    return ok({ property })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}

// Creates a new property under an existing hgid and issues its pid. Used
// when the wizard's selected/created hotel group has no property yet (the
// common "new prospect" case), or when adding an additional property to an
// existing group.
export async function handleCreateProperty(request: Request, env: Env): Promise<Response> {
  let body: any
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body.')
  }

  const hgid          = typeof body?.hgid === 'string' ? body.hgid.trim() : ''
  const entity_code   = typeof body?.entity_code === 'string' ? body.entity_code.trim() : ''
  const property_name = typeof body?.property_name === 'string' ? body.property_name.trim() : ''
  const geo           = typeof body?.geo === 'string' ? body.geo.trim().toUpperCase() : ''
  const market        = typeof body?.market === 'string' ? body.market.trim().toUpperCase() : ''
  const statusRaw     = typeof body?.status === 'string' ? body.status.trim() : ''
  const status        = statusRaw === 'onboarding' ? 'onboarding' : statusRaw === 'prospect' ? 'prospect' : undefined

  if (!hgid || !entity_code || !property_name || !geo || !market) {
    return err('hgid, entity_code, property_name, geo, and market are required.')
  }
  if (statusRaw && !status) {
    return err('status must be one of: prospect, onboarding')
  }

  const payload: { hgid: string; entity_code: string; property_name: string; geo: string; market: string; status?: 'prospect' | 'onboarding' } =
    { hgid, entity_code, property_name, geo, market }
  if (status) payload.status = status

  try {
    const property = await createProperty(env, payload)
    return ok({ property })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry create failed', 502)
  }
}

// Active markets for a geo — populates the Market picker required by
// property creation (the registry validates market against the property's
// geo, same pattern as entity_code against the hotel-group's geo).
export async function handleGetMarkets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const geo = url.searchParams.get('geo')?.trim() || undefined
  try {
    const markets = await getMarkets(env, geo)
    return ok({ markets })
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }
}
