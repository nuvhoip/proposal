import type { Env, EntitySettingsRow, FeeConfigurationRow, ServiceCategoryRow, Session } from '../types'
import { ulid } from '../lib/ulid'
import { ok, err } from '../lib/response'
import { listEntities, RegistryError } from '../lib/registry'

const REGION_ORDER = ['au', 'uk', 'ie'] as const
const REGION_FALLBACK_CURRENCY: Record<string, string> = { au: 'AUD', uk: 'GBP', ie: 'EUR' }

function operatingEntityCodeForRegion(region: string): string {
  return `NVH-${region.toUpperCase()}-OPS`
}

/* ─── Get all entities, merged with this app's own settings (Settings →
 * Entities) ──────────────────────────────────────────────────────────────
 * Legal identity (legal_name/jurisdiction/role/is_active/is_data_controller)
 * is read live from the Nuvho Master Registry — the source of truth for
 * which legal entities exist; this app never stores or edits that. Address/
 * about/footer/currency/T&Cs are this app's own data (entity_settings),
 * merged in here by entity_code. Every active entity the registry returns
 * is included, not just the 3 client-facing "operating" ones.
 */
export async function getEntitySettings(env: Env, session: Session): Promise<Response> {
  let entities
  try {
    entities = await listEntities(env)
  } catch (e) {
    if (e instanceof RegistryError) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Registry lookup failed', 502)
  }

  const { results } = await env.DB.prepare('SELECT * FROM entity_settings').all<EntitySettingsRow>()
  const byCode = new Map(results.map(r => [r.entity_code, r]))

  const data = entities.map(e => {
    const row = byCode.get(e.entity_code)
    return {
      entityCode:       e.entity_code,
      legalName:        e.legal_name,
      jurisdiction:     e.jurisdiction,
      role:             e.role,
      isDataController: e.is_data_controller,
      isActive:         e.is_active,
      address:          row?.address ?? '',
      aboutNuvho:       row?.about_nuvho ?? '',
      footerText:       row?.footer_text ?? '',
      currency:         row?.currency ?? 'AUD',
      clauses:          JSON.parse(row?.clauses_json || '[]'),
    }
  })

  return ok(data)
}

/* ─── Update one entity's settings (address/about/footer/currency/T&Cs) ───
 * entity_code isn't re-validated against the live registry here — the
 * Settings → Entities UI only ever submits an entity_code it just fetched
 * from GET /settings/entities, so an extra round-trip per save would be
 * pure overhead. */
export async function updateEntitySettings(
  entityCode: string, request: Request, env: Env, session: Session
): Promise<Response> {
  if (!entityCode) return err('entity_code is required', 404)

  const body = await request.json() as {
    address?:    string
    aboutNuvho?: string
    footerText?: string
    currency?:   string
    clauses?:    { id: string; heading: string; text: string; enabled: boolean }[]
  }

  await env.DB.prepare(`
    INSERT INTO entity_settings (entity_code, address, about_nuvho, footer_text, currency, clauses_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entity_code) DO UPDATE SET
      address      = excluded.address,
      about_nuvho  = excluded.about_nuvho,
      footer_text  = excluded.footer_text,
      currency     = excluded.currency,
      clauses_json = excluded.clauses_json,
      updated_at   = datetime('now')
  `).bind(
    entityCode,
    body.address ?? '',
    body.aboutNuvho ?? '',
    body.footerText ?? '',
    body.currency ?? 'AUD',
    JSON.stringify(body.clauses ?? []),
  ).run()

  return ok({ updated: true })
}

/* ─── Region settings — computed, read-only feed for the proposal wizard ───
 * Settings → Region Settings no longer exists as an editable page (see
 * Settings → Entities instead) — this endpoint is kept ONLY so the wizard's
 * Hotel Details step (Step1HotelDetails / applyRegionSettings in
 * frontend/app/(app)/proposals/new/page.tsx) keeps working completely
 * unchanged. For each region it resolves that region's client-facing
 * operating entity (NVH-{GEO}-OPS), pulls that entity's settings from
 * entity_settings, and its legal name live from the registry — exactly the
 * entity a hotel group in that geo is actually contracted under.
 */
export async function getRegionSettings(env: Env, session: Session): Promise<Response> {
  let entities: Awaited<ReturnType<typeof listEntities>> = []
  try {
    entities = await listEntities(env)
  } catch {
    // Wizard defaults degrade to blank company names rather than fail the
    // whole Hotel Details step if the registry is briefly unreachable.
  }
  const byCode = new Map(entities.map(e => [e.entity_code, e]))

  const { results } = await env.DB.prepare('SELECT * FROM entity_settings').all<EntitySettingsRow>()
  const settingsByCode = new Map(results.map(r => [r.entity_code, r]))

  const data = REGION_ORDER.map(region => {
    const entityCode = operatingEntityCodeForRegion(region)
    const entity = byCode.get(entityCode)
    const row = settingsByCode.get(entityCode)
    return {
      region,
      address:     row?.address ?? '',
      companyName: entity?.legal_name ?? '',
      aboutNuvho:  row?.about_nuvho ?? '',
      footerText:  row?.footer_text ?? '',
      currency:    row?.currency ?? REGION_FALLBACK_CURRENCY[region] ?? 'AUD',
      clauses:     JSON.parse(row?.clauses_json || '[]'),
    }
  })

  return ok(data)
}

/* ─── Service Categories (Settings → Body Configuration) ─────────────
 * Main service-line categories offered on Step 2 (Services) of the proposal
 * wizard. Fully staff-editable (add/rename/reorder/deactivate/delete) —
 * `code` is a stable identifier also stored on proposal_services.code, so
 * deleting a category here does not touch any proposal that already
 * referenced its code; it just stops being offered on new proposals.
 */
export async function getServiceCategories(env: Env, session: Session): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM service_categories ORDER BY sort_order, label'
  ).all<ServiceCategoryRow>()

  // Default fee rows per service line, from the Settings → Default fees
  // mapping (migration 0021), in mapping order. Tolerates the migration not
  // having run yet — every service line then just has no mapped defaults and
  // the wizard falls back to its built-in catalog rows.
  const feesByCode = new Map<string, ReturnType<typeof feeConfigDto>[]>()
  try {
    const { results: mapped } = await env.DB.prepare(`
      SELECT m.service_code, f.* FROM service_line_fee_configurations m
      JOIN fee_configurations f ON f.id = m.fee_configuration_id
      WHERE f.active = 1
      ORDER BY m.service_code, m.sort_order, f.name
    `).all<FeeConfigurationRow & { service_code: string }>()
    for (const row of mapped) {
      const list = feesByCode.get(row.service_code) || []
      list.push(feeConfigDto(row))
      feesByCode.set(row.service_code, list)
    }
  } catch { /* migration 0021 not applied yet */ }

  const data = results.map(r => ({
    code:             r.code,
    label:            r.label,
    description:      r.description,
    sortOrder:        r.sort_order,
    active:           !!r.active,
    defaultScope:     JSON.parse(r.default_scope_json || '[]'),
    defaultFootnotes: JSON.parse(r.default_footnotes_json || '[]'),
    defaultFees:      feesByCode.get(r.code) || [],
  }))

  return ok(data)
}

function slugifyCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
}

export async function createServiceCategory(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as {
    code?: string; label?: string; description?: string
    defaultScope?: { id: string; heading: string; items: { id: string; text: string }[] }[]
    defaultFootnotes?: { id: string; text: string }[]
  }
  const label = (body.label ?? '').trim()
  if (!label) return err('Label is required.')

  const code = slugifyCode(body.code?.trim() || label)
  if (!code) return err('Could not derive a valid code from that label — try a simpler code.')

  const existing = await env.DB.prepare(
    'SELECT code FROM service_categories WHERE code = ?'
  ).bind(code).first()
  if (existing) return err(`A service category with code "${code}" already exists.`, 409)

  const { results } = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM service_categories'
  ).all<{ max_order: number }>()
  const nextOrder = (results[0]?.max_order ?? 0) + 1
  const defaultScope = body.defaultScope ?? []
  const defaultFootnotes = body.defaultFootnotes ?? []

  await env.DB.prepare(`
    INSERT INTO service_categories (code, label, description, sort_order, active, default_scope_json, default_footnotes_json, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `).bind(code, label, body.description ?? '', nextOrder, JSON.stringify(defaultScope), JSON.stringify(defaultFootnotes)).run()

  return ok({ code, label, description: body.description ?? '', sortOrder: nextOrder, active: true, defaultScope, defaultFootnotes })
}

export async function updateServiceCategory(
  code: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT * FROM service_categories WHERE code = ?'
  ).bind(code).first<ServiceCategoryRow>()
  if (!existing) return err('Unknown service category.', 404)

  const body = await request.json() as {
    label?: string; description?: string; active?: boolean
    defaultScope?: { id: string; heading: string; items: { id: string; text: string }[] }[]
    defaultFootnotes?: { id: string; text: string }[]
  }

  await env.DB.prepare(`
    UPDATE service_categories
    SET label = ?, description = ?, active = ?, default_scope_json = ?, default_footnotes_json = ?, updated_at = datetime('now')
    WHERE code = ?
  `).bind(
    body.label !== undefined ? body.label : existing.label,
    body.description !== undefined ? body.description : existing.description,
    body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
    body.defaultScope !== undefined ? JSON.stringify(body.defaultScope) : existing.default_scope_json,
    body.defaultFootnotes !== undefined ? JSON.stringify(body.defaultFootnotes) : existing.default_footnotes_json,
    code,
  ).run()

  return ok({ updated: true })
}

export async function deleteServiceCategory(code: string, env: Env, session: Session): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT code FROM service_categories WHERE code = ?'
  ).bind(code).first()
  if (!existing) return err('Unknown service category.', 404)

  await env.DB.prepare('DELETE FROM service_categories WHERE code = ?').bind(code).run()
  return ok({ deleted: true })
}

/* Bulk reorder — accepts the full ordered list of codes (as dragged/reordered
 * in the Settings UI) and rewrites sort_order to match array index. */
export async function reorderServiceCategories(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as { codes?: string[] }
  const codes = Array.isArray(body.codes) ? body.codes : []
  if (!codes.length) return err('codes array is required.')

  const stmts = codes.map((code, i) =>
    env.DB.prepare(`UPDATE service_categories SET sort_order = ?, updated_at = datetime('now') WHERE code = ?`)
      .bind(i + 1, code)
  )
  await env.DB.batch(stmts)

  return ok({ reordered: true })
}

/* ─── Default fee configuration (Settings → Default fees, migration 0021) ──
 * A library of reusable default fee rows (fee_configurations) linked to
 * service lines through the service_line_fee_configurations mapping table
 * (many-to-many, ordered per service line). New proposals pre-fill a service
 * line's Pricing rows from its mapped, active configurations. Templates only:
 * editing or deleting one never touches an existing proposal's fee rows.
 */
function feeConfigDto(r: FeeConfigurationRow) {
  return {
    id:        r.id,
    name:      r.name,
    component: r.component,
    feeType:   r.fee_type,
    setupFee:  r.setup_fee ?? '',
    fee:       r.fee ?? '',
    term:      r.term ?? '',
    active:    !!r.active,
  }
}

type FeeConfigBody = {
  name?: string; component?: string; feeType?: string
  setupFee?: number | string | null; fee?: number | string | null; term?: number | string | null
  active?: boolean; serviceCodes?: string[]
}

/** '' / null / undefined → NULL; anything else must be a finite number ≥ 0. */
function amount(value: unknown, field: string): number | null {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a number of 0 or more.`)
  return n
}

async function validServiceCodes(env: Env, codes: unknown): Promise<string[]> {
  if (!Array.isArray(codes)) return []
  const unique = Array.from(new Set(codes.filter((c): c is string => typeof c === 'string' && c.trim() !== '')))
  if (!unique.length) return []
  const { results } = await env.DB.prepare(
    `SELECT code FROM service_categories WHERE code IN (${unique.map(() => '?').join(',')})`
  ).bind(...unique).all<{ code: string }>()
  const known = new Set(results.map(r => r.code))
  const missing = unique.filter(c => !known.has(c))
  if (missing.length) throw new Error(`Unknown service line(s): ${missing.join(', ')}`)
  return unique
}

/** Replace a configuration's service-line links. Lines it was already on keep
 *  their position; newly linked lines get it appended at the end. */
async function setFeeConfigMapping(env: Env, id: string, codes: string[]) {
  const { results: current } = await env.DB.prepare(
    'SELECT service_code FROM service_line_fee_configurations WHERE fee_configuration_id = ?'
  ).bind(id).all<{ service_code: string }>()
  const have = new Set(current.map(r => r.service_code))
  const want = new Set(codes)
  const stmts: D1PreparedStatement[] = []
  for (const code of have) if (!want.has(code)) {
    stmts.push(env.DB.prepare('DELETE FROM service_line_fee_configurations WHERE service_code = ? AND fee_configuration_id = ?').bind(code, id))
  }
  for (const code of want) if (!have.has(code)) {
    stmts.push(env.DB.prepare(`
      INSERT INTO service_line_fee_configurations (service_code, fee_configuration_id, sort_order)
      VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM service_line_fee_configurations WHERE service_code = ?))
    `).bind(code, id, code))
  }
  if (stmts.length) await env.DB.batch(stmts)
}

async function feeConfigWithMapping(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM fee_configurations WHERE id = ?').bind(id).first<FeeConfigurationRow>()
  if (!row) return null
  const { results } = await env.DB.prepare(
    'SELECT service_code FROM service_line_fee_configurations WHERE fee_configuration_id = ? ORDER BY service_code'
  ).bind(id).all<{ service_code: string }>()
  return { ...feeConfigDto(row), serviceCodes: results.map(r => r.service_code) }
}

export async function listFeeConfigurations(env: Env, session: Session): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM fee_configurations ORDER BY name').all<FeeConfigurationRow>()
  const { results: links } = await env.DB.prepare(
    'SELECT service_code, fee_configuration_id, sort_order FROM service_line_fee_configurations ORDER BY service_code, sort_order'
  ).all<{ service_code: string; fee_configuration_id: string; sort_order: number }>()
  const byConfig = new Map<string, string[]>()
  const byService: Record<string, string[]> = {}
  for (const l of links) {
    byConfig.set(l.fee_configuration_id, [...(byConfig.get(l.fee_configuration_id) || []), l.service_code])
    ;(byService[l.service_code] ||= []).push(l.fee_configuration_id)
  }
  return ok({
    configurations: results.map(r => ({ ...feeConfigDto(r), serviceCodes: byConfig.get(r.id) || [] })),
    // Ordered configuration ids per service line — the mapping table as-is.
    mapping: byService,
  })
}

export async function createFeeConfiguration(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as FeeConfigBody
  const name = (body.name ?? '').trim() || (body.component ?? '').trim()
  if (!name) return err('Name or component is required.')
  let setupFee: number | null, fee: number | null, term: number | null, codes: string[]
  try {
    setupFee = amount(body.setupFee, 'Setup fee'); fee = amount(body.fee, 'Fee'); term = amount(body.term, 'Terms')
    codes = await validServiceCodes(env, body.serviceCodes)
  } catch (e) { return err(e instanceof Error ? e.message : 'Invalid fee configuration.') }
  const id = `feecfg_${ulid()}`
  await env.DB.prepare(`
    INSERT INTO fee_configurations (id, name, component, fee_type, setup_fee, fee, term, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(id, name, (body.component ?? '').trim(), (body.feeType ?? 'monthly').trim() || 'monthly',
    setupFee, fee, term === null ? null : Math.round(term), body.active === false ? 0 : 1).run()
  await setFeeConfigMapping(env, id, codes)
  return ok(await feeConfigWithMapping(env, id), 201)
}

export async function updateFeeConfiguration(id: string, request: Request, env: Env, session: Session): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM fee_configurations WHERE id = ?').bind(id).first<FeeConfigurationRow>()
  if (!existing) return err('Unknown fee configuration.', 404)
  const body = await request.json() as FeeConfigBody
  let setupFee = existing.setup_fee, fee = existing.fee, term = existing.term
  let codes: string[] | null = null
  try {
    if ('setupFee' in body) setupFee = amount(body.setupFee, 'Setup fee')
    if ('fee' in body) fee = amount(body.fee, 'Fee')
    if ('term' in body) { const t = amount(body.term, 'Terms'); term = t === null ? null : Math.round(t) }
    if (body.serviceCodes !== undefined) codes = await validServiceCodes(env, body.serviceCodes)
  } catch (e) { return err(e instanceof Error ? e.message : 'Invalid fee configuration.') }
  const name = body.name !== undefined ? body.name.trim() : existing.name
  if (!name) return err('Name is required.')
  await env.DB.prepare(`
    UPDATE fee_configurations
    SET name = ?, component = ?, fee_type = ?, setup_fee = ?, fee = ?, term = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    name,
    body.component !== undefined ? body.component.trim() : existing.component,
    body.feeType !== undefined ? (body.feeType.trim() || 'monthly') : existing.fee_type,
    setupFee, fee, term,
    body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
    id,
  ).run()
  if (codes) await setFeeConfigMapping(env, id, codes)
  return ok(await feeConfigWithMapping(env, id))
}

export async function deleteFeeConfiguration(id: string, env: Env, session: Session): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id FROM fee_configurations WHERE id = ?').bind(id).first()
  if (!existing) return err('Unknown fee configuration.', 404)
  // Mapping rows go explicitly too, in case foreign-key cascades are off.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM service_line_fee_configurations WHERE fee_configuration_id = ?').bind(id),
    env.DB.prepare('DELETE FROM fee_configurations WHERE id = ?').bind(id),
  ])
  return ok({ deleted: true })
}

/** Reorder one service line's mapped default fees — body { ids: [...] } in
 *  the new order (ids not currently mapped to that line are ignored). */
export async function reorderServiceLineFees(code: string, request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids.filter(i => typeof i === 'string') : []
  if (!ids.length) return err('ids array is required.')
  await env.DB.batch(ids.map((id, i) => env.DB.prepare(
    'UPDATE service_line_fee_configurations SET sort_order = ? WHERE service_code = ? AND fee_configuration_id = ?'
  ).bind(i + 1, code, id)))
  return ok({ reordered: true })
}
