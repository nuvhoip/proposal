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
