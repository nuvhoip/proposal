import type {
  Env, ProposalRow, ServiceRow, Session,
  ScopeItemRow, FeeRowRow, PricingFootnoteRow, TermsRow, AttachmentRow,
} from '../types'
import { ok, err } from '../lib/response'
import { ulid, randomToken } from '../lib/ulid'
import {
  createRegistryProposal, updateRegistryProposal, reserveNpId, RegistryError,
  createEngagement, updateEngagement, toRegistryServiceLine, getHotelGroup,
  listPropertiesByHgid,
  type RegistryProposalStatus, type RegistryEngagementStatus,
} from '../lib/registry'
import { formatNpIdLocal } from '../lib/npId'
import {
  sendMailViaGraph, createClientTeam, findTeamByName, addExistingTeamMember,
  createOrUpdateHotelGroupChannel,
  addStandardChannelTabs, hotelGroupChannelOwnerIds, HOTEL_GROUP_CHANNEL_OWNERS,
  sendChannelMessage,
} from '../lib/graph'

/* ─── List proposals ───────────────────────────────────────── */
export async function listProposals(request: Request, env: Env, session: Session): Promise<Response> {
  const url    = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit  = parseInt(url.searchParams.get('limit') || '50')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  let query = 'SELECT p.*, GROUP_CONCAT(DISTINCT ps.code) as service_codes, MIN(prl.prop_id) as prop_id FROM proposals p LEFT JOIN proposal_services ps ON ps.proposal_id = p.id LEFT JOIN proposal_registry_links prl ON prl.proposal_id = p.id'
  const binds: any[] = []

  if (status) {
    query += ' WHERE p.status = ?'
    binds.push(status)
  }
  query += ' GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
  binds.push(limit, offset)

  const stmt = env.DB.prepare(query)
  const { results } = await stmt.bind(...binds).all()
  return ok({ proposals: results, limit, offset })
}

/**
 * Nests each service's scope items, fee rows, and footnotes (Scope/Pricing
 * wizard steps) back onto its row, translated into the camelCase shape the
 * frontend wizard expects (see lib/types.ts DraftServiceLine). Shared by the
 * internal getProposal and the public getPublicProposal so both return
 * identical document data — buildDocModelFromProposal (frontend) depends on
 * this exact shape to render the same document either place.
 */
async function attachServiceChildren(env: Env, services: ServiceRow[]) {
  return Promise.all(services.map(async (svc) => {
    const [{ results: scopeItems }, { results: feeRows }, { results: footnotes }] = await Promise.all([
      env.DB.prepare('SELECT * FROM proposal_scope_items WHERE proposal_service_id = ? ORDER BY sort_order')
        .bind(svc.id).all<ScopeItemRow>(),
      env.DB.prepare('SELECT * FROM proposal_fee_rows WHERE proposal_service_id = ? ORDER BY sort_order')
        .bind(svc.id).all<FeeRowRow>(),
      env.DB.prepare('SELECT * FROM proposal_pricing_footnotes WHERE proposal_service_id = ? ORDER BY sort_order')
        .bind(svc.id).all<PricingFootnoteRow>(),
    ])
    return {
      ...svc,
      scope_items: scopeItems.map(i => ({
        id: i.id, sectionHeading: i.section_heading, text: i.text,
        enabled: !!i.enabled, isCustom: !!i.is_custom,
      })),
      fee_rows: feeRows.map(r => ({
        id: r.id, component: r.component, feeType: r.fee_type,
        fee: r.fee ?? '', term: r.term ?? '', note: r.note || '',
      })),
      footnotes: footnotes.map(f => ({ id: f.id, text: f.text })),
    }
  }))
}

/** Maps a proposal_terms row into the camelCase shape the frontend expects
 *  (ProposalDocModel / documentModel.ts) — shared by getProposal and
 *  getPublicProposal so the public Quote Approval section always matches
 *  what staff configured internally. */
function mapTermsRow(termsRow: TermsRow | null) {
  if (!termsRow) return null
  return {
    clauses:              JSON.parse(termsRow.clauses_json || '[]'),
    validityDays:         termsRow.validity_days,
    governingEntityCode:  termsRow.governing_entity_code || '',
    signatureRequired:  !!termsRow.signature_required,
    signatureMethod:    termsRow.signature_method || 'type',
    signatoryName:      termsRow.signatory_name || '',
    signatoryTitle:     termsRow.signatory_title || '',
    signatureDataUrl:   termsRow.signature_data_url || '',
    signatureMessage:   termsRow.signature_message || '',
    // NUVCL-131
    pageBreaks:             JSON.parse(termsRow.page_breaks_json || '{}'),
    clientSignatoryName:    termsRow.client_signatory_name || '',
    clientSignatoryTitle:   termsRow.client_signatory_title || '',
    clientSignatureMethod:  termsRow.client_signature_method || 'type',
    clientSignatureDataUrl: termsRow.client_signature_data_url || '',
    clientSignedAt:         termsRow.client_signed_at || '',
  }
}

/* ─── Get single proposal ──────────────────────────────────── */
export async function getProposal(proposalId: string, env: Env, session: Session): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return err('Proposal not found', 404)

  const { results: services } = await env.DB.prepare(
    'SELECT * FROM proposal_services WHERE proposal_id = ?'
  ).bind(proposalId).all<ServiceRow>()

  const servicesWithChildren = await attachServiceChildren(env, services)

  const sender = await env.DB.prepare('SELECT * FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first()

  // hgid/entity_code/prop_id aren't columns on `proposals` itself (they live
  // in proposal_registry_links) — pull them from the first linked row so the
  // edit wizard can pre-fill Step 1. All bundled service lines share the
  // same hotel group AND (since the 2026-08-31 fix) the same registry
  // Proposal record/prop_id, so any row's values are correct.
  const registryLink = await env.DB.prepare(
    'SELECT hgid, entity_code, prop_id, sync_error FROM proposal_registry_links WHERE proposal_id = ? LIMIT 1'
  ).bind(proposalId).first<{ hgid: string; entity_code: string; prop_id: string | null; sync_error: string | null }>()

  const termsRow = await env.DB.prepare('SELECT * FROM proposal_terms WHERE proposal_id = ?')
    .bind(proposalId).first<TermsRow>()
  const terms = mapTermsRow(termsRow ?? null)

  // Attachments (wizard Step 5 — Sender) — metadata only, bytes stay in R2
  const { results: attachmentRows } = await env.DB.prepare(
    'SELECT id, filename, content_type, size_bytes FROM proposal_attachments WHERE proposal_id = ? ORDER BY sort_order'
  ).bind(proposalId).all<Pick<AttachmentRow, 'id' | 'filename' | 'content_type' | 'size_bytes'>>()
  const attachments = attachmentRows.map(a => ({
    id: a.id, filename: a.filename, contentType: a.content_type, sizeBytes: a.size_bytes,
  }))

  // Engagement ID (EID) sync status per bundled service line — the
  // registry-issued ENG-{GEO}-{SVC}-{YYYY}-{SEQ4} id, distinct from the
  // proposal's own np_id (see registry.ts's Engagements section). Often
  // null: creating one requires an already-registered property (pid),
  // which most proposals don't have yet (NUVCL-122's Property selector is
  // still pending) — eid_sync_error explains why for the ones that failed.
  const { results: registryLinks } = await env.DB.prepare(
    'SELECT service_line, prop_id, eid, eid_display, eid_sync_error FROM proposal_registry_links WHERE proposal_id = ?'
  ).bind(proposalId).all<{
    service_line: string; prop_id: string | null
    eid: string | null; eid_display: string | null; eid_sync_error: string | null
  }>()

  return ok({
    ...proposal, services: servicesWithChildren, sender, terms, attachments,
    hgid: registryLink?.hgid ?? null,
    entity_code: registryLink?.entity_code ?? null,
    // Registry runbook (2026-08-31): the canonical "Proposal ID" shown to
    // users is now the Master Registry's own PROP-{GEO}-{YYYY}-{SEQ4} record
    // (prop_id) — one per bundled document — not the locally-generated
    // np_id. prop_id_sync_error explains a null prop_id.
    prop_id: registryLink?.prop_id ?? null,
    prop_id_sync_error: registryLink?.sync_error ?? null,
    registryLinks,
  })
}

/* ─── Create proposal ──────────────────────────────────────── */
export async function createProposal(request: Request, env: Env, session: Session, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json() as any
  const { hotel, sender, cover, regionSettings } = body
  // Services are optional — the wizard's Services/Scope/Pricing steps are
  // explicitly skippable (SKIPPABLE_STEPS in the frontend), so a proposal
  // with zero service lines must still be creatable. Default to [] rather
  // than requiring at least one.
  const services: any[] = Array.isArray(body.services) ? body.services : []

  if (!hotel?.name)         return err('Hotel name required')
  if (!hotel?.contactEmail) return err('Contact email required')
  if (!sender?.staffId)     return err('Sender staff required')
  if (!hotel?.hgid)         return err('Hotel group (select from registry lookup) required')
  if (!hotel?.entityCode)   return err('Entity code (resolved from the selected hotel group) required')

  // Verify sender staff exists
  const staff = await env.DB.prepare('SELECT * FROM staff WHERE id = ?')
    .bind(sender.staffId).first()
  if (!staff) return err('Staff member not found')

  const proposalId    = ulid()
  const signingToken  = randomToken(24)
  const expiresAt     = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()  // 30 days
  const geo           = (hotel.region || 'au').toUpperCase()

  // Reserve the client-facing "Proposal ID" (NP-{REGION}-{YYMMDD}-{6RAND}) from
  // the Master Registry — one per bundled proposal, not per service line (see
  // registry/routes/npIds.js). Never let registry downtime block a save: fall
  // back to a locally-generated id in the exact same format.
  let npId: string
  try {
    const reserved = await reserveNpId(env, geo, hotel.hgid)
    npId = reserved.np_id
  } catch (e) {
    console.error('[NP-ID] registry reservation failed, falling back to local generation:', e)
    npId = formatNpIdLocal(geo)
  }

  // Insert proposal
  await env.DB.prepare(`
    INSERT INTO proposals (
      id, np_id, hotel_name, contact_name, contact_email, contact_phone, contact_title,
      property_address, region, nuvho_address, company_name, about_nuvho, footer_text, currency,
      status, sender_staff_id, account_manager_stf_id, sender_message, sender_cc, sender_bcc,
      sender_subject, cover_url, hubspot_deal_id, signing_token, expires_at, valid_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    proposalId, npId,
    hotel.name, hotel.contactName, hotel.contactEmail,
    hotel.contactPhone || null, hotel.contactTitle || null,
    hotel.propertyAddress || null, hotel.region || 'au',
    regionSettings?.address || null, regionSettings?.companyName || null,
    regionSettings?.aboutNuvho || null, regionSettings?.footerText || null,
    regionSettings?.currency || 'AUD',
    sender.staffId, sender.accountManagerId || null, sender.message || null,
    sender.cc || null, sender.bcc || null,
    sender.subject || null,
    cover?.coverUrl || null, hotel.hubspotDealId || null,
    signingToken, expiresAt, expiresAt,
  ).run()

  // Insert services (+ per-service scope items, fee rows, and footnotes from
  // the wizard's Scope/Pricing steps)
  for (const svc of services) {
    const serviceRowId = ulid()
    await env.DB.prepare(`
      INSERT INTO proposal_services (id, proposal_id, code, monthly_fee, setup_fee, term_months)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      serviceRowId, proposalId, svc.code,
      svc.monthlyFee || 0, svc.setupFee || 0, svc.term || 12
    ).run()
    await insertServiceChildren(env, serviceRowId, svc)
  }

  // Persist Terms & Conditions (Step 7 of the wizard) — one row per proposal
  await upsertTerms(env, proposalId, body.terms)

  // Register ONE canonical registry Proposal record for the whole bundled
  // document (Master Registry runbook, Workflow 2 default: a single
  // PROP-{GEO}-{YYYY}-{SEQ4} id per document, regardless of how many
  // service lines it bundles — replaces the old one-record-per-line
  // behaviour). Pick the first bundled service line with a valid registry
  // mapping as the record's required (single) service_line — per the
  // runbook, which one is chosen doesn't matter, since the real per-line
  // detail lives on each line's own Engagement record below. AND (if a
  // property is linked) create an Engagement (EID) per bundled service
  // line, each pointing back at this one shared prop_id via
  // signed_proposal_id. Partial failures are recorded per-row in
  // proposal_registry_links rather than blocking the local proposal — see
  // syncRegistryStatus()/syncEngagementStatus() for the retry-on-status-
  // change path.
  let propId: string | null = null
  let propSyncedAt: string | null = null
  let propSyncError: string | null = null
  const representativeSvc = services
    .map(svc => ({ svc, registrySvcLine: toRegistryServiceLine(svc.code) }))
    .find(x => x.registrySvcLine)
  if (representativeSvc) {
    try {
      const record = await createRegistryProposal(env, {
        hgid: hotel.hgid,
        entity_code: hotel.entityCode,
        service_line: representativeSvc.registrySvcLine!,
        geo,
        status: 'draft',
        expires_at: expiresAt,
        hubspot_deal_id: hotel.hubspotDealId || null,
      })
      propId = record.prop_id
      propSyncedAt = new Date().toISOString()
    } catch (e) {
      propSyncError = e instanceof RegistryError
        ? `${e.code}: ${e.message}`
        : (e instanceof Error ? e.message : 'Unknown registry error')
      console.error('[Registry sync] proposal create failed:', propSyncError)
    }
  } else if (services.length) {
    propSyncError = `No registry service_line mapping for any bundled service (${services.map(s => s.code).join(', ')})`
  }

  for (const svc of services) {
    // registry.service_line_codes only accepts the new 8-code list (AD/CR/
    // ES/MM/MS/RD/SM/SY as of the 2026-08-14 migration) — svc.code is this
    // app's own scheme (RM/SM/CR/MK/...), so it must be translated before
    // it ever reaches the registry. See toRegistryServiceLine's comment in
    // registry.ts for the mapping and why it exists.
    const registrySvcLine = toRegistryServiceLine(svc.code)

    // Engagement (EID) creation additionally requires an already-registered
    // Property (pid) — hotel.pid is only set once a hotel-group property has
    // actually been selected (NUVCL-122's Property selector is still
    // pending for the free-text case), so this is expected to be skipped
    // for many proposals today rather than treated as an error.
    let eid: string | null = null
    let eidDisplay: string | null = null
    let eidSyncedAt: string | null = null
    let eidSyncError: string | null = null
    if (!registrySvcLine) {
      eidSyncError = `No registry service_line mapping for '${svc.code}'`
    } else if (!hotel.pid) {
      eidSyncError = 'No linked property (pid) — link a registered property to enable an Engagement ID'
    } else if (!propId) {
      eidSyncError = 'The shared registry Proposal record failed to create — see the Proposal ID sync error'
    } else {
      try {
        const record = await createEngagement(env, {
          pid: hotel.pid,
          hgid: hotel.hgid,
          entity_code: hotel.entityCode,
          service_line: registrySvcLine,
          geo,
          status: 'prospect',
          hubspot_deal_id: hotel.hubspotDealId || null,
          signed_proposal_id: propId,
        })
        eid = record.eid
        eidDisplay = record.display_id ?? null
        eidSyncedAt = new Date().toISOString()
      } catch (e) {
        eidSyncError = e instanceof RegistryError
          ? `${e.code}: ${e.message}`
          : (e instanceof Error ? e.message : 'Unknown registry error')
        console.error('[Registry sync] engagement create failed:', svc.code, eidSyncError)
      }
    }

    // Not wrapping this write meant a missing/out-of-date proposal_registry_links
    // table (e.g. a deploy that shipped before the matching D1 migration ran)
    // took down the entire "save draft" request with a generic 500, even though
    // the proposal row above had already been created successfully. Bookkeeping
    // writes must never be able to fail the primary create.
    try {
      await env.DB.prepare(`
        INSERT INTO proposal_registry_links (
          id, proposal_id, service_line, hgid, entity_code, geo, prop_id, status, sync_error, synced_at,
          pid, eid, eid_display, eid_sync_error, eid_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ulid(), proposalId, svc.code, hotel.hgid, hotel.entityCode, geo, propId, propSyncError, propSyncedAt,
        hotel.pid || null, eid, eidDisplay, eidSyncError, eidSyncedAt,
      ).run()
    } catch (e) {
      console.error('[Registry sync] failed to write proposal_registry_links row:', svc.code, e)
    }
  }

  // Audit log
  await auditLog(env, proposalId, 'created', session.email, { hotelName: hotel.name })

  // Trigger background automations (non-blocking)
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposalId, 'created', env))
  }

  return ok({ id: proposalId, signingToken }, 201)
}

/* ─── Registry sync helper ──────────────────────────────────── */
/**
 * Pushes a status transition to every linked registry proposal record
 * (one per bundled service_line). Failures are recorded per-row in
 * proposal_registry_links.sync_error and do not block the caller — a
 * proposal can be sent/signed locally even if the registry is unreachable.
 */
async function syncRegistryStatus(
  env: Env,
  proposalId: string,
  status: RegistryProposalStatus,
  extra: { sent_at?: string; signed_at?: string } = {}
): Promise<void> {
  const { results: links } = await env.DB.prepare(
    `SELECT id, prop_id FROM proposal_registry_links WHERE proposal_id = ? AND prop_id IS NOT NULL`
  ).bind(proposalId).all<{ id: string; prop_id: string }>()

  for (const link of links) {
    try {
      await updateRegistryProposal(env, link.prop_id, { status, ...extra })
      await env.DB.prepare(
        `UPDATE proposal_registry_links SET status = ?, synced_at = ?, sync_error = NULL WHERE id = ?`
      ).bind(status, new Date().toISOString(), link.id).run()
    } catch (e) {
      const message = e instanceof RegistryError
        ? `${e.code}: ${e.message}`
        : (e instanceof Error ? e.message : 'Unknown registry error')
      console.error('[Registry sync] status update failed:', link.prop_id, message)
      await env.DB.prepare(
        `UPDATE proposal_registry_links SET sync_error = ? WHERE id = ?`
      ).bind(message, link.id).run()
    }
  }
}

/**
 * Mirrors syncRegistryStatus() above but for each linked Engagement (eid)
 * instead of the Proposal (prop_id) record — the two are independent rows
 * in the registry (see registry.ts's Engagements section), so this is a
 * separate loop rather than folded into syncRegistryStatus. Called at
 * signing to move each engagement from 'proposal' to 'active' and record
 * signed_date. A proposal with no linked eid (no property was registered at
 * generation time) simply has nothing to update here — not an error.
 */
async function syncEngagementStatus(
  env: Env,
  proposalId: string,
  status: RegistryEngagementStatus,
  extra: { signed_date?: string; start_date?: string } = {}
): Promise<void> {
  const { results: links } = await env.DB.prepare(
    `SELECT id, eid FROM proposal_registry_links WHERE proposal_id = ? AND eid IS NOT NULL`
  ).bind(proposalId).all<{ id: string; eid: string }>()

  for (const link of links) {
    try {
      await updateEngagement(env, link.eid, { status, ...extra })
      await env.DB.prepare(
        `UPDATE proposal_registry_links SET eid_synced_at = ?, eid_sync_error = NULL WHERE id = ?`
      ).bind(new Date().toISOString(), link.id).run()
    } catch (e) {
      const message = e instanceof RegistryError
        ? `${e.code}: ${e.message}`
        : (e instanceof Error ? e.message : 'Unknown registry error')
      console.error('[Registry sync] engagement status update failed:', link.eid, message)
      await env.DB.prepare(
        `UPDATE proposal_registry_links SET eid_sync_error = ? WHERE id = ?`
      ).bind(message, link.id).run()
    }
  }
}

/* ─── Delete proposal ──────────────────────────────────────── */
// Restricted to status === 'draft' — the same gate the frontend already
// applies to Edit/Send (canSend) — so a proposal that has been sent or
// signed (a real record with its own audit trail, and once signed, an
// executed contract) can never be silently erased. Deleting the proposals
// row cascades (ON DELETE CASCADE, schema.sql) to proposal_services (and
// its scope_items/fee_rows/footnotes children), proposal_terms,
// proposal_registry_links, engagements, sharepoint_folders, and audit_log.
//
// Known gap: createProposal() already registers each bundled service line
// as a canonical record in the Nuvho Master Registry (prop_id, stored in
// proposal_registry_links) at draft-creation time. RegistryProposalStatus
// (lib/registry.ts) only defines 'draft' | 'sent' | 'signed' | 'declined' |
// 'expired' — there is no 'cancelled'/'deleted' state — so this does not
// retract those registry records; they're left as orphaned 'draft' rows
// there. Adding a cancelled state would require a coordinated change in
// nuvho_master_registry and wasn't assumed here.
export async function deleteProposal(proposalId: string, env: Env, session: Session): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT status FROM proposals WHERE id = ?')
    .bind(proposalId).first<{ status: string }>()
  if (!proposal) return err('Proposal not found', 404)
  if (proposal.status !== 'draft') {
    return err('Only draft proposals can be deleted. Sent, signed, or expired proposals are kept as a permanent record.', 409)
  }

  await env.DB.prepare('DELETE FROM proposals WHERE id = ?').bind(proposalId).run()
  return ok({ deleted: true })
}

/* ─── Retry Teams workspace automation ────────────────────────
 * Ad-hoc re-run of triggerTeamsWorkspace() for an EXISTING proposal. Added
 * 2026-09-18: several proposals (Retreat East, Nuvho Test 4, ...) have a
 * stale ms_team_error from before a graph.ts/proposals.ts fix shipped, and
 * there was previously no way to re-trigger the automation for them short
 * of creating a throwaway new proposal (triggerTeamsWorkspace only runs on
 * the 'created' automation event). This lets staff retry an existing
 * proposal directly once the underlying bug is fixed and deployed.
 *
 * Safe to call repeatedly / on an already-succeeded proposal:
 * createClientTeam/findTeamByName and createOrUpdateHotelGroupChannel are
 * both find-or-create/reuse, so this never creates duplicate Teams or
 * channels — at worst it refreshes a channel's description and re-tries
 * adding any owners that previously failed.
 */
export async function retryTeamsWorkspace(proposalId: string, env: Env, session: Session): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return err('Proposal not found', 404)

  await triggerTeamsWorkspace(proposal, env, false) // full retry budget: this is a synchronous request, not a backgrounded waitUntil() task

  const updated = await env.DB.prepare(
    'SELECT ms_team_id, ms_channel_id, ms_channel_web_url, ms_team_error FROM proposals WHERE id = ?'
  ).bind(proposalId).first<{
    ms_team_id: string | null
    ms_channel_id: string | null
    ms_channel_web_url: string | null
    ms_team_error: string | null
  }>()

  return ok({
    retried:            true,
    ms_team_id:         updated?.ms_team_id ?? null,
    ms_channel_id:      updated?.ms_channel_id ?? null,
    ms_channel_web_url: updated?.ms_channel_web_url ?? null,
    ms_team_error:      updated?.ms_team_error ?? null,
  })
}

/* ─── Scheduled sweep: finish half-created Teams workspaces ───
 * Added 2026-09-18 (bug #10). A brand-new Microsoft Team takes the Teams
 * service 1-3 minutes to finish provisioning before channels can be added
 * to it, which is far longer than Cloudflare will let a backgrounded
 * ctx.waitUntil() task run (observed live: force-cancelled ~30-45s after
 * the HTTP response, mid-retry, with nothing written to D1). So for any
 * NEW Hotel Group the channels simply cannot be created in the same
 * invocation that creates the Team — the create-time automation now gives
 * up fast (fastMode) and records why, and this cron-driven sweep finishes
 * the job a few minutes later when Microsoft is actually ready.
 *
 * Runs with the FULL retry budget (fastMode = false): a scheduled handler
 * is not a backgrounded continuation of a request, so it isn't subject to
 * that cancellation window.
 *
 * Scope is deliberately narrow:
 *   - only proposals with no ms_channel_id yet (nothing to do otherwise),
 *   - only the last 7 days, so this never churns through old history,
 *   - skips anything already diagnosed as permanently stuck, since those
 *     need a human to delete the broken Team in Entra ID first and would
 *     otherwise burn the whole sweep budget failing every 5 minutes,
 *   - a small batch per run, so one bad Hotel Group can't starve the rest.
 * triggerTeamsWorkspace is find-or-create throughout, so re-running it is
 * always safe and never duplicates a Team or channel.
 */
const TEAMS_SWEEP_BATCH_SIZE = 3

/* Marks an ms_team_error that a RETRY CANNOT CLEAR — it needs a person to
 * do something first (link a Hotel Group in the wizard, delete a broken
 * Team in Entra ID). Added 2026-09-18 after a "Vision Gazi" proposal with
 * no hgid would otherwise have been re-attempted by the cron sweep every 5
 * minutes for a week, failing identically each time and burning a slot in
 * the batch that a genuinely-pending proposal could have used. Anything
 * NOT wearing this prefix is treated as transient and worth retrying.
 * Note the prefix is matched with SQL LIKE below — square brackets are not
 * wildcards in SQLite, so it matches literally. */
export const BLOCKED_PREFIX = '[BLOCKED] '

export async function sweepPendingTeamsWorkspaces(env: Env): Promise<{ attempted: string[] }> {
  const { results } = await env.DB.prepare(`
    SELECT * FROM proposals
    WHERE ms_channel_id IS NULL
      AND created_at >= datetime('now', '-7 days')
      AND (ms_team_error IS NULL OR (
            ms_team_error NOT LIKE '[BLOCKED]%'
        AND ms_team_error NOT LIKE '%appears permanently stuck%'
      ))
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(TEAMS_SWEEP_BATCH_SIZE).all<ProposalRow>()

  const attempted: string[] = []
  for (const proposal of results || []) {
    attempted.push(proposal.id)
    try {
      await triggerTeamsWorkspace(proposal, env, false)
    } catch (e: any) {
      // triggerTeamsWorkspace records its own errors to ms_team_error and
      // has its own outer backstop; this is only here so one proposal's
      // failure can't abandon the rest of the batch.
      console.error(`[Teams sweep] Unexpected error finishing proposal ${proposal.id}:`, e)
    }
  }

  if (attempted.length) {
    console.log(`[Teams sweep] Attempted ${attempted.length} pending proposal(s): ${attempted.join(', ')}`)
  }
  return { attempted }
}

/* ─── Attachments (wizard Step 5 — Sender) ───────────────────
 * Bytes live in R2 (env.STORAGE); proposal_attachments is just the pointer
 * + metadata the wizard's attachment list needs. Uploaded any time a
 * proposal already has an id (a fresh proposal only gets one once the
 * wizard's Save Draft / Generate & Send calls createProposal(), so the
 * frontend defers upload of newly-picked files until then). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024   // 10MB per file
const MAX_ATTACHMENTS      = 5                  // per proposal
// NOTE: these limits pre-date the Graph sendMail migration and can combine
// to a payload (5 files × 10MB, base64-inlined) well past Graph's ~4MB
// practical ceiling for the simple JSON sendMail call — see the size-limit
// note on sendMailViaGraph() in lib/graph.ts. Large multi-attachment sends
// may need to move to Graph's upload-session API; not yet done here.

export async function uploadAttachment(
  proposalId: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT id FROM proposals WHERE id = ?')
    .bind(proposalId).first<{ id: string }>()
  if (!proposal) return err('Proposal not found', 404)

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM proposal_attachments WHERE proposal_id = ?'
  ).bind(proposalId).first<{ n: number }>()
  if ((countRow?.n ?? 0) >= MAX_ATTACHMENTS) {
    return err(`Maximum ${MAX_ATTACHMENTS} attachments per proposal`, 413)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('Expected multipart/form-data with a "file" field')
  }
  // @cloudflare/workers-types declares FormDataEntryValue's File branch as an
  // interface, not a constructable class, so `instanceof File` fails to
  // typecheck under this project's `lib: ["ES2022"]` tsconfig (no DOM lib) —
  // duck-type it instead (a real uploaded file always has these fields).
  const entry = form.get('file')
  const file = entry as { name?: string; size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> } | null
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') {
    return err('No file provided')
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return err(`"${file.name}" is too large — ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit per file`, 413)
  }

  const attachmentId = ulid()
  const r2Key = `attachments/${proposalId}/${attachmentId}-${file.name}`
  await env.STORAGE.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })

  const maxOrderRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM proposal_attachments WHERE proposal_id = ?'
  ).bind(proposalId).first<{ m: number }>()
  const sortOrder = (maxOrderRow?.m ?? -1) + 1

  await env.DB.prepare(`
    INSERT INTO proposal_attachments (id, proposal_id, filename, content_type, size_bytes, r2_key, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(attachmentId, proposalId, file.name, file.type || null, file.size, r2Key, sortOrder).run()

  return ok({ id: attachmentId, filename: file.name, contentType: file.type || null, sizeBytes: file.size }, 201)
}

export async function deleteAttachment(
  proposalId: string, attachmentId: string, env: Env, session: Session
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT r2_key FROM proposal_attachments WHERE id = ? AND proposal_id = ?'
  ).bind(attachmentId, proposalId).first<{ r2_key: string }>()
  if (!row) return err('Attachment not found', 404)

  await env.STORAGE.delete(row.r2_key)
  await env.DB.prepare('DELETE FROM proposal_attachments WHERE id = ?').bind(attachmentId).run()
  return ok({ deleted: true })
}

/* ─── Cover photo (wizard Step 5 — Cover Image "Upload custom image") ───
 * A single custom cover photo per proposal, stored in R2 under a STABLE key
 * (covers/{proposalId}) so re-uploading a new photo overwrites the old one
 * in place instead of accumulating orphaned objects. Unlike attachments,
 * this is served back PUBLICLY (GET, no auth, wired in index.ts's public
 * routes section) — the branded Split cover on the public Accept & Sign
 * page (/p/:token) needs to display it in a browser that was never signed
 * in, and a plain <img>/CSS background-image request never carries the
 * app's session cookie anyway.
 *
 * Before this, picking "Upload custom image" just embedded a browser-local
 * `blob:` URL straight into cover_url (see Step5Cover in
 * app/(app)/proposals/new/page.tsx). That URL only ever resolves inside the
 * exact browser tab that created it — dead on reload, dead on the Proposal
 * Details page in a different tab, and (the reported bug) dead on the
 * public sign page, which is always a different browser context. This
 * gives the photo a real, durable URL instead. */
const MAX_COVER_PHOTO_BYTES = 10 * 1024 * 1024   // 10MB

export async function uploadCoverPhoto(
  proposalId: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT id FROM proposals WHERE id = ?')
    .bind(proposalId).first<{ id: string }>()
  if (!proposal) return err('Proposal not found', 404)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('Expected multipart/form-data with a "file" field')
  }
  // Same duck-typing rationale as uploadAttachment above.
  const entry = form.get('file')
  const file = entry as { name?: string; size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> } | null
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') {
    return err('No file provided')
  }
  if (file.size > MAX_COVER_PHOTO_BYTES) {
    return err(`Cover photo is too large — ${MAX_COVER_PHOTO_BYTES / 1024 / 1024}MB limit`, 413)
  }

  const r2Key = `covers/${proposalId}`
  await env.STORAGE.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })

  // Relative path only — the frontend already knows its own
  // NEXT_PUBLIC_WORKER_URL and builds the absolute URL it actually stores
  // in cover_url from that, the same way every other worker call does.
  return ok({ path: `/proposals/${proposalId}/cover-photo` }, 201)
}

/** Public — no auth. Streams the cover photo's bytes straight from R2. */
export async function getCoverPhoto(proposalId: string, env: Env): Promise<Response> {
  const obj = await env.STORAGE.get(`covers/${proposalId}`)
  if (!obj) return err('Cover photo not found', 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      // Short, not "immutable" — the same key gets overwritten whenever staff
      // re-upload a different photo for this proposal (see uploadCoverPhoto).
      'Cache-Control': 'public, max-age=300',
    },
  })
}

/* Base64-encodes an ArrayBuffer in fixed-size chunks — spreading a whole
 * large Uint8Array into String.fromCharCode(...) at once can blow the call
 * stack, so this walks it 32KB at a time instead. Used by
 * sendProposalEmail() to inline attachment bytes as Graph fileAttachment
 * contentBytes, which (like most email APIs) expects attachment content as
 * base64 rather than as a separate multipart body. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/* ─── Send proposal ────────────────────────────────────────── */
export async function sendProposal(proposalId: string, env: Env, session: Session, ctx: ExecutionContext): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return err('Proposal not found', 404)
  if (proposal.status === 'signed') return err('Proposal already signed')

  // Generate PDF URL (stub — real impl uses puppeteer via DO or pre-rendered HTML→PDF)
  const pdfKey = `pdfs/${proposalId}.pdf`
  const publicUrl = `${env.FRONTEND_URL}/p/${proposal.signing_token}`

  await env.DB.prepare(`
    UPDATE proposals SET status = 'sent', sent_at = datetime('now'),
    pdf_url = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(pdfKey, proposalId).run()

  // Send email — failures here must not roll back the status flip above
  // (the proposal record is already the source of truth), but they must
  // also not be swallowed silently, which is what let "sent" proposals go
  // out with no email ever actually delivered. Surface the failure in both
  // the audit log and the API response so staff can see it and use Resend.
  let emailError: string | null = null
  try {
    await sendProposalEmail(proposal, publicUrl, env)
  } catch (e) {
    emailError = e instanceof Error ? e.message : 'Unknown email error'
    console.error('[sendProposal] email send failed:', proposalId, emailError)
  }

  await auditLog(env, proposalId, 'sent', session.email, {
    to: proposal.contact_email, ...(emailError ? { emailError } : {}),
  })

  // Sync status to every linked registry proposal record (best-effort)
  await syncRegistryStatus(env, proposalId, 'sent', { sent_at: new Date().toISOString() })

  // Trigger A1/A2 automations
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposalId, 'sent', env))
  }

  return ok({
    status: 'sent', publicUrl, emailSent: !emailError,
    ...(emailError ? { emailError } : {}),
  })
}

/* ─── Resend proposal email ──────────────────────────────────
 * Re-sends the signing-link email for a proposal that has already gone out
 * at least once. Lets staff override/extend the To/CC/BCC recipients for
 * just this send (e.g. looping in an extra stakeholder, or retrying after
 * the original send silently failed) without re-running the full send flow
 * or touching proposal status/sent_at. Whatever CC/BCC list is submitted is
 * persisted back onto the proposal row — sender_cc/sender_bcc are already
 * staff-editable post-send (see ALWAYS_ALLOWED_FIELDS in updateProposal) —
 * so the next resend or edit view starts from the latest list. */
export async function resendProposal(
  proposalId: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return err('Proposal not found', 404)
  if (!proposal.signing_token) return err('Proposal has not been sent yet', 409)

  const body = await request.json().catch(() => ({})) as { to?: string; cc?: string; bcc?: string }
  const to  = (body.to ?? proposal.contact_email ?? '').trim()
  const cc  = (body.cc  ?? proposal.sender_cc  ?? '') || ''
  const bcc = (body.bcc ?? proposal.sender_bcc ?? '') || ''
  if (!to) return err('At least one recipient (To) is required')

  const publicUrl = `${env.FRONTEND_URL}/p/${proposal.signing_token}`

  try {
    await sendProposalEmail(proposal, publicUrl, env, { to, cc, bcc })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown email error'
    await auditLog(env, proposalId, 'resend_failed', session.email, { to, cc, bcc, error: message })
    return err(`Failed to send email: ${message}`, 502)
  }

  // Best-effort — a failure to persist the recipient list shouldn't make an
  // otherwise-successful resend look like it failed.
  try {
    await env.DB.prepare(
      `UPDATE proposals SET sender_cc = ?, sender_bcc = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(cc || null, bcc || null, proposalId).run()
  } catch (e) {
    console.error('[resendProposal] failed to persist cc/bcc:', proposalId, e)
  }

  await auditLog(env, proposalId, 'resent', session.email, { to, cc, bcc })
  return ok({ resent: true, to, cc, bcc })
}

/* ─── Update proposal ──────────────────────────────────────── */
// Full-edit fields (hotel/contact/sender/cover) are only ever sent by the
// wizard in edit mode, and only while the proposal is still a draft — once
// sent/signed, the document is the record of truth and must not silently
// change under a live signing link or an already-delivered PDF. `status`
// transitions themselves go through sendProposal()/signProposal(), not here.
const FULL_EDIT_FIELDS = [
  'hotel_name', 'contact_name', 'contact_email', 'contact_phone', 'contact_title',
  'property_address', 'region', 'nuvho_address', 'company_name', 'about_nuvho', 'footer_text', 'currency',
  'sender_staff_id', 'account_manager_stf_id', 'sender_message', 'sender_cc', 'sender_bcc', 'sender_subject', 'cover_url',
  'hubspot_deal_id',
]
const ALWAYS_ALLOWED_FIELDS = ['sender_message', 'sender_cc', 'sender_bcc', 'sender_subject', 'cover_url', 'hubspot_deal_id']

export async function updateProposal(
  proposalId: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const body = await request.json() as Partial<ProposalRow> & { services?: ServiceRow[]; terms?: any }

  const current = await env.DB.prepare('SELECT status FROM proposals WHERE id = ?')
    .bind(proposalId).first<{ status: string }>()
  if (!current) return err('Proposal not found', 404)

  const editingFullFields = FULL_EDIT_FIELDS.some(f => f in body && !ALWAYS_ALLOWED_FIELDS.includes(f))
    || Array.isArray(body.services)
  if (editingFullFields && current.status !== 'draft') {
    return err('This proposal has already been sent — hotel, contact, and service details can no longer be edited', 409)
  }

  const allowed = ['status', ...FULL_EDIT_FIELDS]
  const updates: string[] = []
  const values:  any[]    = []

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`)
      values.push((body as any)[key])
    }
  }

  if (updates.length) {
    updates.push("updated_at = datetime('now')")
    values.push(proposalId)
    await env.DB.prepare(
      `UPDATE proposals SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run()
  }

  // Replace service lines wholesale when provided — simplest correct
  // behaviour for a wizard-driven edit (it always resubmits the full list).
  // ON DELETE CASCADE on proposal_scope_items/proposal_fee_rows/
  // proposal_pricing_footnotes takes the old children with it.
  if (Array.isArray(body.services)) {
    await env.DB.prepare('DELETE FROM proposal_services WHERE proposal_id = ?')
      .bind(proposalId).run()
    for (const svc of body.services as any[]) {
      const serviceRowId = ulid()
      await env.DB.prepare(`
        INSERT INTO proposal_services (id, proposal_id, code, monthly_fee, setup_fee, term_months)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        serviceRowId, proposalId, svc.code,
        svc.monthlyFee || 0, svc.setupFee || 0, svc.term || 12
      ).run()
      await insertServiceChildren(env, serviceRowId, svc)
    }
  }

  // Terms & Conditions can be edited independently of the draft-only gate
  // above (it's a proposal-level upsert, not part of FULL_EDIT_FIELDS).
  if (body.terms) {
    await upsertTerms(env, proposalId, body.terms)
  }

  if (!updates.length && !Array.isArray(body.services) && !body.terms) {
    return err('No valid fields to update')
  }

  await auditLog(env, proposalId, 'edited', session.email, { fields: Object.keys(body) })

  return ok({ updated: true })
}

/* ─── Dashboard stats ──────────────────────────────────────── */
export async function getDashboardStats(env: Env, session: Session): Promise<Response> {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [total, sentMonth, signedMonth, pending] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as c FROM proposals').first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM proposals WHERE status='sent' AND sent_at >= ?").bind(start).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM proposals WHERE status='signed' AND signed_at >= ?").bind(start).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM proposals WHERE status='sent'").first<{ c: number }>(),
  ])

  const revenueRow = await env.DB.prepare(`
    SELECT SUM(ps.monthly_fee * ps.term_months + ps.setup_fee) as total
    FROM proposal_services ps
    JOIN proposals p ON p.id = ps.proposal_id
    WHERE p.status = 'sent'
  `).first<{ total: number | null }>()

  const sentTotal   = total?.c || 0
  const signedTotal = signedMonth?.c || 0
  const conversion  = sentTotal > 0 ? Math.round((signedTotal / sentTotal) * 1000) / 10 : 0

  return ok({
    totalProposals:      sentTotal,
    sentThisMonth:       sentMonth?.c || 0,
    signedThisMonth:     signedTotal,
    conversionRate:      conversion,
    avgResponseDays:     3.2,   // TODO: compute from signed_at - sent_at
    pendingSignature:    pending?.c || 0,
    totalRevenuePending: revenueRow?.total || 0,
  })
}

/* ─── Public: get proposal by signing token ────────────────── */
export async function getPublicProposal(token: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const proposal = await env.DB.prepare(
    'SELECT * FROM proposals WHERE signing_token = ?'
  ).bind(token).first<ProposalRow>()

  if (!proposal) return err('Proposal not found', 404)
  if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
    await env.DB.prepare("UPDATE proposals SET status='expired' WHERE id=?").bind(proposal.id).run()
    return err('Proposal has expired', 410)
  }

  // Increment view count
  await env.DB.prepare(
    "UPDATE proposals SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?"
  ).bind(proposal.id).run()

  // NUVCL: log a detailed activity-log entry for every open of the public
  // Copy Link, so staff can see who looked at a proposal and from where.
  // Cloudflare puts the visitor's real IP on CF-Connecting-IP and rich
  // edge-derived geolocation on request.cf, so no external geo-IP lookup
  // is needed here. Link-preview/unfurl bots (Slack, Teams, Outlook Safe
  // Links, etc.) hit this exact same endpoint, so they're recorded under a
  // separate event name ('link_previewed') rather than 'viewed', keeping
  // the human-facing Activity Log meaningful. Reuses the existing
  // audit_log.meta JSON-blob convention rather than adding new columns.
  const ip       = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null
  const ua       = request.headers.get('User-Agent')
  const referer  = request.headers.get('Referer') || request.headers.get('Referrer') || null
  const uaInfo   = classifyUserAgent(ua)
  const cf       = request.cf
  await auditLog(env, proposal.id, uaInfo.isBot ? 'link_previewed' : 'viewed', ip || 'unknown', {
    ip,
    userAgent:  ua,
    browser:    uaInfo.browser,
    os:         uaInfo.os,
    deviceType: uaInfo.deviceType,
    referer,
    country:    cf?.country    ?? null,
    region:     cf?.region     ?? null,
    city:       cf?.city       ?? null,
    postalCode: cf?.postalCode ?? null,
    timezone:   cf?.timezone   ?? null,
    latitude:   cf?.latitude   ?? null,
    longitude:  cf?.longitude  ?? null,
  }, { ctx, proposal })

  const { results: services } = await env.DB.prepare(
    'SELECT * FROM proposal_services WHERE proposal_id = ?'
  ).bind(proposal.id).all<ServiceRow>()
  const servicesWithChildren = await attachServiceChildren(env, services)

  const sender = await env.DB.prepare('SELECT name, email, role FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first()

  // Terms (Quote Approval / signature configuration) — the public document
  // preview needs the exact same shape buildDocModelFromProposal expects, so
  // the client sees the same Fee Structure + Quote Approval sections the
  // internal proposal detail view shows staff.
  const termsRow = await env.DB.prepare('SELECT * FROM proposal_terms WHERE proposal_id = ?')
    .bind(proposal.id).first<TermsRow>()
  const terms = mapTermsRow(termsRow ?? null)

  // Strip internal fields from public response
  const { signing_token: _, ...safe } = proposal
  return ok({ ...safe, services: servicesWithChildren, sender, terms })
}

/* ─── Public: sign proposal ────────────────────────────────── */
export async function signProposal(token: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json() as {
    signerName?:       string   // legacy field — kept for backward compatibility
    signatureMethod?:  'type' | 'draw'
    signatoryName?:    string
    signatoryTitle?:   string
    signatureDataUrl?: string
  }

  // Accept the same signature shapes the internal wizard's Terms &
  // Conditions step produces (SignaturePad draw vs typed name), so the
  // client's e-signature on the public page ends up in the exact same
  // proposal_terms fields that render the document's Quote Approval block —
  // rather than the plain "signer name" text this endpoint used to record.
  const signatoryName = (body.signatoryName ?? body.signerName ?? '').trim()
  const signatureDataUrl = (body.signatureDataUrl || '').trim()
  const signatureMethod: 'type' | 'draw' =
    body.signatureMethod === 'draw' || body.signatureMethod === 'type'
      ? body.signatureMethod
      : (signatureDataUrl ? 'draw' : 'type')

  if (!signatoryName) return err('Signer name required')
  if (signatureMethod === 'draw' && !signatureDataUrl) return err('Please draw a signature, or switch to "Type name"')

  const proposal = await env.DB.prepare(
    'SELECT * FROM proposals WHERE signing_token = ?'
  ).bind(token).first<ProposalRow>()

  if (!proposal)                         return err('Proposal not found', 404)
  if (proposal.status === 'signed')      return err('Proposal already signed')
  if (proposal.status === 'expired')     return err('Proposal has expired', 410)
  if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
    return err('Proposal has expired', 410)
  }

  await env.DB.prepare(`
    UPDATE proposals
    SET status='signed', signer_name=?, signed_at=datetime('now'), updated_at=datetime('now')
    WHERE id=?
  `).bind(signatoryName, proposal.id).run()

  // NUVCL-131: merge the captured signature into the proposal's terms row
  // (preserving whatever clauses/validity/etc. were already configured), but
  // into the dedicated client_* columns — NOT signatoryName/signatureMethod/
  // signatureDataUrl, which are the SENDER's own letter sign-off ("Yours
  // sincerely, ..."). Previously this call reused the sender's own fields
  // for the client's signature, silently overwriting the sender's sign-off
  // with whatever the client typed/drew, and leaving no distinct record of
  // the client's own signature — which is why it never showed up correctly
  // in the generated PDF. mapTermsRow/upsertTerms now round-trip both sets
  // of fields independently; see documentModel.ts's clientSignatoryName etc.
  // and ProposalDocument.tsx's doc-client-acceptance block for the read side.
  const existingTermsRow = await env.DB.prepare('SELECT * FROM proposal_terms WHERE proposal_id = ?')
    .bind(proposal.id).first<TermsRow>()
  const existingTerms = mapTermsRow(existingTermsRow ?? null)
  await upsertTerms(env, proposal.id, {
    clauses:             existingTerms?.clauses ?? [],
    validityDays:        existingTerms?.validityDays ?? 30,
    governingEntityCode: existingTerms?.governingEntityCode ?? '',
    pageBreaks:          existingTerms?.pageBreaks ?? {},
    // Sender's own letter sign-off — untouched, carried forward as-is.
    signatureRequired: existingTerms?.signatureRequired ?? true,
    signatureMethod:   existingTerms?.signatureMethod || 'type',
    signatoryName:     existingTerms?.signatoryName || '',
    signatoryTitle:    existingTerms?.signatoryTitle || '',
    signatureDataUrl:  existingTerms?.signatureDataUrl || '',
    signatureMessage:  existingTerms?.signatureMessage || '',
    // The client's own signature, captured just now.
    clientSignatoryName:    signatoryName,
    clientSignatoryTitle:   body.signatoryTitle?.trim() || '',
    clientSignatureMethod:  signatureMethod,
    clientSignatureDataUrl: signatureMethod === 'draw' ? signatureDataUrl : '',
    clientSignedAt:         new Date().toISOString(),
  })

  await auditLog(env, proposal.id, 'signed', proposal.contact_email, { signatoryName, signatureMethod }, { ctx, proposal })

  // Sync status to every linked registry proposal record (best-effort).
  //
  // The Master Registry enforces a strict state machine on its own Proposal
  // records (nuvho_master_registry/src/services/proposals.js:
  // STATUS_TRANSITIONS = { draft: ['sent','declined','expired'], sent:
  // ['signed','declined','expired'], ... }) — there is NO direct
  // draft -> signed transition. A proposal only reaches 'sent' there via
  // sendProposal() (below) calling syncRegistryStatus(..., 'sent', ...).
  // If a proposal is signed WITHOUT ever going through Send first (this app
  // allows sharing/opening the public /p/{token} link straight from a draft
  // — e.g. while testing), the registry PATCH here would be rejected with
  // INVALID_TRANSITION, and since syncRegistryStatus only records that into
  // proposal_registry_links.sync_error (never surfaced once prop_id already
  // exists — see getProposal's prop_id_sync_error handling), the registry's
  // Proposal record would silently stay stuck on 'draft' forever, even
  // though the local proposal and every linked Engagement update fine
  // (Engagement's own status field has no such transition restriction,
  // which is why "the engagement shows active/signed but the proposal
  // still shows draft" can happen without any error being visible). Bridge
  // through 'sent' first whenever the proposal reached us still in 'draft',
  // so the registry's status machine is always satisfied regardless of
  // whether Send was actually used.
  if (proposal.status === 'draft') {
    await syncRegistryStatus(env, proposal.id, 'sent', { sent_at: new Date().toISOString() })
  }
  await syncRegistryStatus(env, proposal.id, 'signed', { signed_at: new Date().toISOString() })
  // ...and move every linked Engagement from 'proposal' to 'active' too —
  // this is the "update the one in the master registry" half of signing.
  // signed_date is date-only (registry column is DATE, not TIMESTAMP).
  await syncEngagementStatus(env, proposal.id, 'active', {
    signed_date: new Date().toISOString().slice(0, 10),
  })

  // Trigger A3–A9 automations
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposal.id, 'signed', env))
  }

  return ok({ signed: true, message: 'Proposal accepted. Our team will be in touch shortly.' })
}

/* ─── Generate email template (Claude API) ─────────────────── */
export async function generateEmailTemplate(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as {
    staffId?:      string
    contactName?:  string
    contactTitle?: string
    hotelName?:    string
    serviceCodes?: string[]
  }

  if (!body.contactName) return err('Contact name required')
  if (!env.ANTHROPIC_API_KEY) return err('Email generation is not configured', 500)

  let senderName = 'the Nuvho team'
  if (body.staffId) {
    const staff = await env.DB.prepare('SELECT name, role FROM staff WHERE id = ?')
      .bind(body.staffId).first<{ name: string; role: string }>()
    if (staff) senderName = staff.name
  }

  const serviceNames: Record<string, string> = {
    RM: 'Revenue Management', SM: 'Sales Management',
    MK: 'Marketing',          CR: 'Concierge Revenue',
  }
  const services = (body.serviceCodes || []).map(c => serviceNames[c] || c).join(', ')

  const prompt = `Write a short, warm, professional email opening message (3-5 sentences, no subject line, no sign-off) `
    + `from ${senderName} at Nuvho (a hospitality technology company, "Smart Hoteliers") to ${body.contactName}`
    + `${body.contactTitle ? `, ${body.contactTitle}` : ''}${body.hotelName ? ` at ${body.hotelName}` : ''}. `
    + `The email introduces a proposal covering: ${services || 'Nuvho\'s services'}. `
    + `Tone should be friendly and consultative, not salesy. Do not invent specific numbers, dates, or promises. `
    + `Return only the message body text, nothing else.`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':          env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-5',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const detail = await aiRes.text().catch(() => '')
    console.error('[Claude API error]', aiRes.status, detail)
    return err('Failed to generate email template', 502)
  }

  const aiData = await aiRes.json() as { content?: { type: string; text: string }[] }
  const message = aiData.content?.find(c => c.type === 'text')?.text?.trim() || ''

  // Note: no audit_log entry here — audit_log.proposal_id is NOT NULL with a
  // foreign key to proposals(id), and no proposal exists yet at this point in
  // the wizard (this runs during Sender step, before the proposal is created).

  return ok({ message })
}

/* ─── Helpers ─────────────────────────────────────────────── */

/**
 * Persists a service line's scope items, fee rows, and pricing footnotes
 * (Scope + Pricing wizard steps) as child rows of proposal_services.
 * Order in the incoming array is preserved via `sort_order` since these are
 * draggable/reorderable lists in the UI.
 */
async function insertServiceChildren(env: Env, serviceRowId: string, svc: any): Promise<void> {
  if (Array.isArray(svc.scopeItems)) {
    let order = 0
    for (const item of svc.scopeItems) {
      await env.DB.prepare(`
        INSERT INTO proposal_scope_items (id, proposal_service_id, section_heading, text, enabled, is_custom, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ulid(), serviceRowId, item.sectionHeading || '', item.text || '',
        item.enabled === false ? 0 : 1, item.isCustom ? 1 : 0, order++
      ).run()
    }
  }
  if (Array.isArray(svc.feeRows)) {
    let order = 0
    for (const row of svc.feeRows) {
      await env.DB.prepare(`
        INSERT INTO proposal_fee_rows (id, proposal_service_id, component, fee_type, fee, term, note, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ulid(), serviceRowId, row.component || '', row.feeType || 'monthly',
        (row.fee === '' || row.fee === undefined || row.fee === null) ? null : row.fee,
        (row.term === '' || row.term === undefined || row.term === null) ? null : row.term,
        row.note || null, order++
      ).run()
    }
  }
  if (Array.isArray(svc.footnotes)) {
    let order = 0
    for (const fn of svc.footnotes) {
      await env.DB.prepare(`
        INSERT INTO proposal_pricing_footnotes (id, proposal_service_id, text, sort_order)
        VALUES (?, ?, ?, ?)
      `).bind(ulid(), serviceRowId, fn.text || '', order++).run()
    }
  }
}

/**
 * Upserts the single proposal_terms row for a proposal (Terms & Conditions
 * wizard step) — clauses are stored as a JSON blob (clauses_json), following
 * the same pattern as audit_log.meta, since they have no independent
 * relational identity outside their ordered per-proposal list.
 */
async function upsertTerms(env: Env, proposalId: string, terms: any): Promise<void> {
  if (!terms) return
  await env.DB.prepare(`
    INSERT INTO proposal_terms (proposal_id, clauses_json, validity_days, governing_entity_code, signature_required, signature_method, signatory_name, signatory_title, signature_data_url, signature_message, page_breaks_json, client_signatory_name, client_signatory_title, client_signature_method, client_signature_data_url, client_signed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(proposal_id) DO UPDATE SET
      clauses_json          = excluded.clauses_json,
      validity_days         = excluded.validity_days,
      governing_entity_code = excluded.governing_entity_code,
      signature_required    = excluded.signature_required,
      signature_method      = excluded.signature_method,
      signatory_name        = excluded.signatory_name,
      signatory_title       = excluded.signatory_title,
      signature_data_url    = excluded.signature_data_url,
      signature_message     = excluded.signature_message,
      page_breaks_json      = excluded.page_breaks_json,
      -- NUVCL-131: the client_* columns are "sticky" — ordinary Terms-step
      -- saves (createProposal/updateProposal) never pass client fields, so
      -- COALESCE keeps whatever the client already signed with rather than
      -- wiping it to null on the next unrelated save. signProposal() is the
      -- only caller that supplies non-null values here, and does overwrite.
      client_signatory_name      = COALESCE(excluded.client_signatory_name, client_signatory_name),
      client_signatory_title     = COALESCE(excluded.client_signatory_title, client_signatory_title),
      client_signature_method    = COALESCE(excluded.client_signature_method, client_signature_method),
      client_signature_data_url  = COALESCE(excluded.client_signature_data_url, client_signature_data_url),
      client_signed_at           = COALESCE(excluded.client_signed_at, client_signed_at),
      updated_at            = datetime('now')
  `).bind(
    proposalId,
    JSON.stringify(terms.clauses || []),
    terms.validityDays || 30,
    terms.governingEntityCode || null,
    terms.signatureRequired === false ? 0 : 1,
    terms.signatureMethod === 'draw' ? 'draw' : 'type',
    terms.signatoryName || null,
    terms.signatoryTitle || null,
    terms.signatureDataUrl || null,
    terms.signatureMessage || null,
    JSON.stringify(terms.pageBreaks || {}),
    terms.clientSignatoryName || null,
    terms.clientSignatoryTitle || null,
    terms.clientSignatureMethod === 'draw' || terms.clientSignatureMethod === 'type'
      ? terms.clientSignatureMethod
      : null,
    terms.clientSignatureDataUrl || null,
    terms.clientSignedAt || null,
  ).run()
}

/**
 * Lightweight, dependency-free User-Agent classifier for the "viewed"
 * activity-log entries — good enough to show "Chrome · macOS · Desktop"
 * in the Activity Log without pulling in a UA-parsing library. The raw
 * userAgent string is always stored alongside this in audit_log.meta too,
 * so nothing is lost if a case isn't recognized here.
 */
function classifyUserAgent(ua: string | null): {
  browser: string; os: string; deviceType: string; isBot: boolean
} {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown', isBot: false }

  const isBot = /bot|crawl|spider|slurp|facebookexternalhit|Slackbot|TeamsPreview|WhatsApp|LinkedInBot|Discordbot|SkypeUriPreview|Outlook/i.test(ua)

  let browser = 'Unknown'
  if (/Edg\//.test(ua))                                browser = 'Edge'
  else if (/OPR\//.test(ua))                            browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua))                        browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua))   browser = 'Safari'

  let os = 'Unknown'
  if (/Windows/.test(ua))                    os = 'Windows'
  else if (/Mac OS X/.test(ua))               os = 'macOS'
  else if (/Android/.test(ua))                os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua))       os = 'iOS'
  else if (/Linux/.test(ua))                  os = 'Linux'

  const deviceType = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/.test(ua) ? 'Mobile' : 'Desktop'

  return { browser, os, deviceType, isBot }
}

type TeamsProposalRef = Pick<ProposalRow, 'id' | 'np_id' | 'hotel_name' | 'ms_team_id' | 'ms_channel_id'>

const TEAMS_EVENT_LABELS: Record<string, string> = {
  created:       'Proposal created',
  sent:          'Proposal sent',
  resent:        'Proposal re-sent',
  resend_failed: 'Proposal re-send FAILED',
  edited:        'Proposal edited',
  signed:        'Proposal SIGNED',
  viewed:        'Proposal link opened',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Renders one activity-log entry as the HTML body of a Teams channel post.
 * Hotel names, actors and User-Agent-derived strings are all escaped — this
 * content is partly attacker-controlled (a visitor picks their own
 * User-Agent) and Graph renders the body as HTML.
 */
function buildTeamsActivityHtml(
  env: Env, proposal: TeamsProposalRef, event: string, actor: string, meta?: object
): string {
  const label = TEAMS_EVENT_LABELS[event] || event
  const ref   = proposal.np_id || proposal.id
  const lines = [
    `<b>${escapeHtml(label)}</b>`,
    `${escapeHtml(ref)} &mdash; ${escapeHtml(proposal.hotel_name)}`,
  ]

  const m = (meta || {}) as Record<string, unknown>
  const str = (k: string) => (typeof m[k] === 'string' && m[k] ? String(m[k]) : '')

  if (event === 'viewed') {
    const place  = [str('city'), str('region'), str('country')].filter(Boolean).join(', ')
    const device = [str('browser'), str('os'), str('deviceType')].filter(Boolean).join(' &middot; ')
    if (place)        lines.push(`Location: ${escapeHtml(place)}`)
    if (device)       lines.push(`Device: ${escapeHtml(device)}`)
    if (str('ip'))    lines.push(`IP: ${escapeHtml(str('ip'))}`)
    if (str('referer')) lines.push(`Referrer: ${escapeHtml(str('referer'))}`)
  } else if (actor && actor !== 'unknown') {
    lines.push(`By: ${escapeHtml(actor)}`)
  }

  lines.push(`<a href="${env.FRONTEND_URL}/proposals/${encodeURIComponent(proposal.id)}">Open in Proposal System</a>`)
  return lines.join('<br>')
}

/**
 * Mirrors an activity-log entry into the proposal's Teams channel. Always
 * resolves — the audit_log row is the source of truth, so a Graph outage,
 * an expired service-account consent, or a proposal whose Teams workspace
 * hasn't been provisioned yet must never break a proposal flow or the
 * client's public proposal page.
 */
async function mirrorAuditToTeams(
  env: Env, proposalId: string, event: string, actor: string,
  meta: object | undefined, known?: TeamsProposalRef
): Promise<void> {
  try {
    const proposal = known ?? await env.DB.prepare(
      'SELECT id, np_id, hotel_name, ms_team_id, ms_channel_id FROM proposals WHERE id = ?'
    ).bind(proposalId).first<TeamsProposalRef>()

    if (!proposal?.ms_team_id || !proposal?.ms_channel_id) return   // no workspace yet

    await sendChannelMessage(
      env, proposal.ms_team_id, proposal.ms_channel_id,
      buildTeamsActivityHtml(env, proposal, event, actor, meta)
    )
  } catch (e) {
    console.error('Teams activity post failed:', e instanceof Error ? e.message : e)
  }
}

async function auditLog(
  env: Env, proposalId: string, event: string, actor: string, meta?: object,
  opts?: { ctx?: ExecutionContext; proposal?: TeamsProposalRef }
) {
  await env.DB.prepare(
    'INSERT INTO audit_log (id, proposal_id, event, actor, meta) VALUES (?, ?, ?, ?, ?)'
  ).bind(ulid(), proposalId, event, actor, meta ? JSON.stringify(meta) : null).run()

  // Mirror into the proposal's Teams channel. Bot/link-preview opens are
  // deliberately excluded — they're crawler noise, not someone reading the
  // proposal. When a ctx is available the post is backgrounded so it never
  // adds Graph latency to the caller's response.
  if (event === 'link_previewed') return
  const post = mirrorAuditToTeams(env, proposalId, event, actor, meta, opts?.proposal)
  if (opts?.ctx) opts.ctx.waitUntil(post)
  else await post
}

async function sendProposalEmail(
  proposal: ProposalRow, publicUrl: string, env: Env,
  overrides?: { to?: string; cc?: string; bcc?: string }
) {
  // Sends via Microsoft Graph app-only sendMail (see lib/graph.ts) — the
  // organization's own Microsoft 365 tenant, replacing the previous Resend
  // integration (retired: Resend required a separate API key/domain setup
  // this account never actually had, which is why sends were silently
  // failing with a 401 before this migration).
  const sender = await env.DB.prepare('SELECT name, email FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first<{ name: string; email: string }>()

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #28687F; padding: 24px; text-align: center;">
        <h1 style="color: white; font-size: 22px; margin: 0;">Nuvho — Smart Hoteliers</h1>
      </div>
      <div style="padding: 32px 24px;">
        <p>Dear ${proposal.contact_name},</p>
        ${proposal.sender_message ? `<div>${proposal.sender_message}</div>` : ''}
        <p>Please review and accept your proposal for <strong>${proposal.hotel_name}</strong>.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${publicUrl}"
            style="background: #28687F; color: white; padding: 14px 32px;
                   border-radius: 999px; text-decoration: none; font-weight: 600;
                   font-size: 15px;">
            View &amp; Accept Proposal
          </a>
        </div>
        <p style="font-size: 12px; color: #5E6B6C;">
          This proposal expires on
          ${proposal.expires_at ? new Date(proposal.expires_at).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' }) : '30 days from now'}.
        </p>
      </div>
      <div style="background: #28687F; padding: 16px; text-align: center;">
        <p style="color: rgba(255,255,255,0.6); font-size: 11px; margin: 0;">
          © Nuvho Systems Pty Ltd
        </p>
      </div>
    </div>
  `

  // sender_cc/sender_bcc (and now optionally an overridden `to`) are
  // comma-separated strings — split into arrays of addresses, dropping blanks.
  const splitEmails = (value: string | null | undefined) =>
    (value || '').split(',').map(e => e.trim()).filter(Boolean)
  const to  = splitEmails(overrides?.to)
  const cc  = splitEmails(overrides?.cc  ?? proposal.sender_cc)
  const bcc = splitEmails(overrides?.bcc ?? proposal.sender_bcc)

  // Attachments (wizard Step 5 — Sender) — pull bytes from R2 and inline as
  // base64 fileAttachments for the Graph sendMail payload. Best-effort per
  // file: a single missing/unreadable R2 object shouldn't block the whole
  // proposal send.
  const { results: attachmentRows } = await env.DB.prepare(
    'SELECT filename, content_type, r2_key FROM proposal_attachments WHERE proposal_id = ? ORDER BY sort_order'
  ).bind(proposal.id).all<Pick<AttachmentRow, 'filename' | 'content_type' | 'r2_key'>>()

  const attachments: { filename: string; contentType: string; contentBase64: string }[] = []
  for (const row of attachmentRows) {
    try {
      const obj = await env.STORAGE.get(row.r2_key)
      if (!obj) { console.error('[Attachment] R2 object missing:', row.r2_key); continue }
      attachments.push({
        filename:     row.filename,
        contentType:  row.content_type || 'application/octet-stream',
        contentBase64: arrayBufferToBase64(await obj.arrayBuffer()),
      })
    } catch (e) {
      console.error('[Attachment] failed to read from R2:', row.r2_key, e)
    }
  }

  // NUVCL-79: send from the individual sender's own @nuvho.com address
  // (not a shared/group address) for personalization. Falls back to
  // proposals@nuvho.com only if the sender's staff record has no email on
  // file. Unlike the old Resend setup (which only needed the domain
  // verified), the app-only Graph token must actually be allowed to send
  // AS this mailbox — by default an app-only Mail.Send grant can send as
  // any tenant mailbox, but if an ApplicationAccessPolicy has been applied
  // to scope it down, both the individual sender addresses and this
  // proposals@nuvho.com fallback need to be included in that policy.
  const fromEmail = sender?.email || 'proposals@nuvho.com'

  // This call was previously fire-and-forget against Resend — a bad/missing
  // API key, an unverified sender, or a malformed payload would fail and
  // nobody would know: the proposal already shows status='sent' regardless
  // (see sendProposal), so the failure was completely invisible.
  // sendMailViaGraph() throws on any non-2xx Graph response, and that
  // throw is left uncaught here so the caller (sendProposal/resendProposal)
  // can log it, record it in the audit trail, and surface it to staff.
  await sendMailViaGraph(env, fromEmail, {
    subject: proposal.sender_subject || `Your Nuvho Proposal — ${proposal.hotel_name}`,
    html,
    to: to.length ? to : [proposal.contact_email],
    ...(cc.length          ? { cc }              : {}),
    ...(bcc.length         ? { bcc }             : {}),
    ...(sender?.email      ? { replyTo: sender.email } : {}),
    ...(attachments.length ? { attachments }     : {}),
  })
}

/* ─── Automation triggers (A1–A9) ──────────────────────────── */
async function triggerAutomations(proposalId: string, event: string, env: Env) {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return

  const { results: services } = await env.DB.prepare(
    'SELECT * FROM proposal_services WHERE proposal_id = ?'
  ).bind(proposalId).all<ServiceRow>()

  if (event === 'created' || event === 'sent') {
    // A1: HubSpot — update deal stage
    await triggerHubspot(proposal, services, event, env).catch(console.error)
  }

  if (event === 'created') {
    // A6: Teams — create/reuse the Hotel Group's Team, add a private
    // Hotel-Group channel underneath it (2026-09-15: channel scope moved
    // from per-Property to per-Hotel-Group — see triggerTeamsWorkspace).
    // Moved here from 'signed' (2026-09) so the workspace exists as soon as
    // the proposal is generated, not only once it's won — matches the
    // wizard's "Generate & Save" moment.
    await triggerTeamsWorkspace(proposal, env, true).catch(console.error)
  }

  if (event === 'signed') {
    // A2: HubSpot — mark deal as won
    await triggerHubspot(proposal, services, 'won', env).catch(console.error)
    // A3: Asana — create onboarding project
    await triggerAsana(proposal, services, env).catch(console.error)
    // A4: SharePoint — create client folder
    await triggerSharePoint(proposal, env).catch(console.error)
    // A5: Xero — create quote/invoice
    await triggerXero(proposal, services, env).catch(console.error)
  }
}

async function triggerHubspot(proposal: ProposalRow, services: ServiceRow[], event: string, env: Env) {
  if (!proposal.hubspot_deal_id) return

  const stageMap: Record<string, string> = {
    sent:    'presentationscheduled',
    won:     'closedwon',
    created: 'qualifiedtobuy',
  }

  await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${proposal.hubspot_deal_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.HUBSPOT_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      properties: {
        dealstage: stageMap[event] || 'qualifiedtobuy',
        amount:    services.reduce((a, s) => a + s.monthly_fee * s.term_months + s.setup_fee, 0),
      },
    }),
  })
}

async function triggerAsana(proposal: ProposalRow, services: ServiceRow[], env: Env) {
  const serviceNames = services.map(s => s.code).join(', ')
  await fetch('https://app.asana.com/api/1.0/projects', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.ASANA_PAT}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      data: {
        name:      `[Onboarding] ${proposal.hotel_name}`,
        workspace: env.ASANA_WORKSPACE_GID,
        notes:     `New client: ${proposal.hotel_name}\nServices: ${serviceNames}\nContact: ${proposal.contact_name} <${proposal.contact_email}>`,
        color:     'dark-teal',
      },
    }),
  })
}

async function triggerSharePoint(proposal: ProposalRow, env: Env) {
  // Stub — real impl uses MS Graph to create folder at
  // /sites/nuvho/Shared Documents/Clients/{hotel_name}
  console.log(`[Automation] SharePoint folder: ${proposal.hotel_name}`)
}

async function triggerXero(proposal: ProposalRow, services: ServiceRow[], env: Env) {
  // Stub — real impl exchanges Xero OAuth tokens then POSTs a quote
  console.log(`[Automation] Xero quote for: ${proposal.hotel_name}`)
}

/**
 * 2026-09-15 REWORK — supersedes the short-lived v2.0 "4 fixed geo Teams,
 * one STANDARD channel per Property" design (2026-09-03, kept in this
 * file's git history only), which never actually went live: the 4 geo
 * Teams were never created, and separately the live tenant turned out not
 * to match that spec's assumed structure at all (see teams-v2-migration.md
 * project-memory notes). Back to one dedicated Team per Hotel Group — but
 * now with a single private channel per Hotel Group (not one channel per
 * Property as the original pre-v2.0 design had), reused across every
 * proposal/property generated under that group, with a fixed standing
 * roster of Nuvho team leaders (HOTEL_GROUP_CHANNEL_OWNERS in lib/graph.ts)
 * as real Graph owners on both the Team and the channel — not just
 * whoever's the sender/account manager on a given proposal.
 *
 * Still fires on 'created' (the wizard's "Generate & Save"), and still
 * re-runs safely if a Team/channel already exists for this Hotel Group —
 * every run REFRESHES the channel's description, so its properties list
 * and engagement-ID list grow as later proposals land against the group.
 *
 * Only requires the proposal to be linked to a Hotel Group (hgid) — unlike
 * the v2.0 design, a registered Property (pid) is NOT required just to
 * create the workspace; pid-derived data (the registry's property list,
 * per-property EIDs) is used opportunistically below to enrich the
 * description, but its absence no longer blocks the automation.
 *
 * Like the other A1–A9 triggers, failures here are caught by the caller
 * (triggerAutomations) and must never block proposal creation itself.
 */
async function triggerTeamsWorkspace(proposal: ProposalRow, env: Env, fastMode = false) {
  const recordError = async (message: string) => {
    console.error(`[Automation] Teams: ${proposal.hotel_name} — ${message}`)
    await env.DB.prepare('UPDATE proposals SET ms_team_error = ? WHERE id = ?')
      .bind(message, proposal.id).run()
  }

  // Outer safety net: confirmed live 2026-09-15 that an uncaught throw
  // ANYWHERE in this function (e.g. an unguarded D1 query) is otherwise
  // swallowed by the caller's `.catch(console.error)` in triggerAutomations,
  // leaving ms_team_id/ms_channel_id/ms_team_error all NULL forever with no
  // visible trace outside `wrangler tail` — a silent, undebuggable failure.
  // Everything below already records specific, actionable errors at each
  // known risk point; this outer try/catch is the last-resort backstop so a
  // step nobody's guarded yet still lands a message in ms_team_error instead
  // of vanishing.
  try {

  // All bundled service lines share the same client/hotel group, so any one
  // row's hgid will do. hgid is NOT NULL on this table (schema.sql), so any
  // registry link row for this proposal carries it.
  const link = await env.DB.prepare(
    'SELECT hgid FROM proposal_registry_links WHERE proposal_id = ? AND hgid IS NOT NULL LIMIT 1'
  ).bind(proposal.id).first<{ hgid: string }>()

  if (!link?.hgid) {
    await recordError(
      BLOCKED_PREFIX +
      'No Hotel Group (hgid) linked to this proposal yet — link/select a Hotel Group in Step 1 ' +
      'before the Teams workspace can be created.'
    )
    return
  }

  let hotelGroupName: string
  try {
    const hg = await getHotelGroup(env, link.hgid)
    hotelGroupName = hg.trading_name || hg.group_name
  } catch (e: any) {
    await recordError(`Could not look up Hotel Group ${link.hgid} from the registry: ${e?.message || e}`)
    return
  }

  const ownerIds = hotelGroupChannelOwnerIds()

  // Find-or-create the dedicated Team for this Hotel Group — reused across
  // every proposal for any property under the group, so findTeamByName is
  // checked first rather than always creating.
  let teamId: string
  let teamOwnerFailures: string[] = []
  try {
    const existingTeam = await findTeamByName(env, hotelGroupName)
    if (existingTeam) {
      teamId = existingTeam.id
      // The fixed owner roster may have grown (or this Team may predate
      // this automation entirely) — addExistingTeamMember is idempotent
      // ("already exists" is treated as success), so converge it every run
      // rather than only at Team-creation time.
      for (const ownerId of ownerIds) {
        try {
          await addExistingTeamMember(env, teamId, ownerId, 'owner')
        } catch (e) {
          console.error(`[Teams] Failed to add/confirm owner ${ownerId} on existing Team ${teamId}:`, e)
          teamOwnerFailures.push(ownerId)
        }
      }
    } else {
      const createdTeam = await createClientTeam(
        env, hotelGroupName, `Nuvho engagement workspace for ${hotelGroupName}`, ownerIds, fastMode
      )
      teamId = createdTeam.teamId
      teamOwnerFailures = createdTeam.failedOwnerIds
    }
  } catch (e: any) {
    await recordError(e?.message || `Could not find or create the Team for Hotel Group "${hotelGroupName}"`)
    return
  }

  // Persist the Team id THE MOMENT we have it, before doing anything else
  // that could be slow (2026-09-18, bug #10). Previously ms_team_id was
  // only written in the single final UPDATE at the very end of this
  // function, AFTER Team provisioning polling and both channel creations —
  // so when Cloudflare cancelled this backgrounded ctx.waitUntil() task
  // partway through (confirmed live: "Frasers Hospitality" test, Team
  // created in Graph but the D1 row left entirely null), the id of the Team
  // we had just created was lost outright. That's exactly how an orphaned,
  // unreferenced Team like "Harbour Hospitality" comes into existence: the
  // Team exists in Microsoft 365, nothing in D1 points at it, and the next
  // run finds it by name in whatever half-provisioned state it was left in.
  // Writing it here means a cancelled run is always resumable — the retry
  // endpoint (or a later run) reuses this exact Team instead of orphaning
  // it. Best-effort: a failure here must never abort channel creation.
  try {
    await env.DB.prepare('UPDATE proposals SET ms_team_id = ? WHERE id = ?')
      .bind(teamId, proposal.id).run()
  } catch (e: any) {
    console.error(`[Teams] Could not persist ms_team_id ${teamId} for proposal ${proposal.id} (non-fatal):`, e)
  }

  // Best-effort, like the property lookup below: an unguarded throw here
  // would silently kill the whole automation before it ever reaches Team/
  // channel creation, with NOTHING written to ms_team_error (the caller's
  // outer .catch(console.error) swallows it) — confirmed live 2026-09-15
  // (Kurrajong Hotel test: ms_team_id/ms_channel_id/ms_team_error all stayed
  // NULL with no automation activity visible at all). Never let a
  // description-only detail abort Team/channel creation.
  let accountManager: { name: string } | null = null
  try {
    accountManager = proposal.account_manager_stf_id
      ? await env.DB.prepare('SELECT name FROM staff WHERE id = ?')
          .bind(proposal.account_manager_stf_id).first<{ name: string }>()
      : null
  } catch (e: any) {
    console.error(`[Teams] Could not look up account manager for proposal ${proposal.id} (non-fatal, description will omit them):`, e)
  }

  // 2026-09-18: the Hotel-Group-named channel was REMOVED at Odysseus's
  // request. The Team is already named after the Hotel Group, so a private
  // channel of the same name sitting inside it was pure duplication in the
  // Teams sidebar ("Rockingham Partners > Rockingham Partners"). A Team now
  // holds only Microsoft's mandatory General channel plus one private
  // channel per PROPERTY. Duplicate group channels created before this
  // change are NOT removed automatically — delete those by hand in Teams.
  // ms_channel_id/ms_channel_web_url consequently now point at the
  // PROPERTY channel, which is the one anybody actually wants to open.
  //
  // One proposal = one property (proposal.hotel_name), independent of
  // whether that property has synced to a registry pid yet — confirmed
  // live 2026-09-15 (Retreat East test): gating this on "pid IS NOT NULL"
  // silently created ZERO property channels whenever the property hadn't
  // finished registry sync, with no error anywhere. pid is used only, when
  // available, to broaden the engagement-ID list across every proposal for
  // that same property (falling back to just this proposal's own EIDs).
  const propertyName = proposal.hotel_name
  try {
    const pidRow = await env.DB.prepare(
      'SELECT pid FROM proposal_registry_links WHERE proposal_id = ? AND pid IS NOT NULL LIMIT 1'
    ).bind(proposal.id).first<{ pid: string }>()

    const eidRows = pidRow?.pid
      ? await env.DB.prepare(
          'SELECT DISTINCT eid_display FROM proposal_registry_links ' +
          'WHERE pid = ? AND eid_display IS NOT NULL ORDER BY eid_display'
        ).bind(pidRow.pid).all<{ eid_display: string }>()
      : await env.DB.prepare(
          'SELECT DISTINCT eid_display FROM proposal_registry_links ' +
          'WHERE proposal_id = ? AND eid_display IS NOT NULL ORDER BY eid_display'
        ).bind(proposal.id).all<{ eid_display: string }>()
    const propertyEids = (eidRows.results || []).map(r => r.eid_display)

    // Engagement IDs (ENG-AU-MM-2026-0137 style) come from the Master
    // Registry, created one per service line at proposal-creation time —
    // but ONLY when the proposal has a linked registry property (pid).
    // Without one, createProposal skips engagement creation entirely and
    // records why on the link row. Surfacing that reason here rather than
    // a bare "(none yet)" means the channel itself tells you what to fix,
    // instead of looking like the automation forgot them (2026-09-18).
    let engagementsLine: string
    if (propertyEids.length) {
      engagementsLine = `Engagements: ${propertyEids.join(', ')}`
    } else {
      let reason = 'none yet'
      try {
        const errRow = await env.DB.prepare(
          'SELECT eid_sync_error FROM proposal_registry_links ' +
          'WHERE proposal_id = ? AND eid_sync_error IS NOT NULL LIMIT 1'
        ).bind(proposal.id).first<{ eid_sync_error: string }>()
        if (errRow?.eid_sync_error) reason = errRow.eid_sync_error
      } catch (e: any) {
        console.error(`[Teams] Could not read eid_sync_error for proposal ${proposal.id} (non-fatal):`, e)
      }
      engagementsLine = `Engagements: (${reason})`
    }

    const propertyDescription = [
      `Property of: ${hotelGroupName} (${link.hgid})`,
      engagementsLine,
      `${pidRow?.pid || 'Not yet registered'} | Account Manager: ${accountManager?.name || 'Unassigned'}`,
    ].join('\n')

    const { channelId, webUrl: channelWebUrl, created, failedOwnerIds: channelOwnerFailures } =
      await createOrUpdateHotelGroupChannel(env, teamId, propertyName, propertyDescription, ownerIds, fastMode)

    // Team/channel creation itself succeeded, but individual owner adds are
    // still best-effort and were previously silent outside wrangler tail —
    // confirmed live 2026-09-15 (Jude Bolger missing as owner on a
    // successful run, no trace of why in D1). Surface any such gaps as a
    // non-fatal warning in ms_team_error rather than clobbering it to NULL,
    // so a partial success is visible from the D1 row alone.
    // Pin the standard apps (SharePoint site + Asana) onto the channel.
    // Best-effort and idempotent: a missing Graph permission or a missing
    // Asana catalog entry becomes a warning on the row, never a failure of
    // the channel itself, which has already been created successfully.
    const tabWarnings = await addStandardChannelTabs(env, teamId, channelId)

    const allFailedIds = [...new Set([...teamOwnerFailures, ...channelOwnerFailures])]
    const warnings = [
      allFailedIds.length
        ? `Could not add these owners to the "${propertyName}" channel (will retry next run): ` +
          allFailedIds.map(id => {
            const owner = HOTEL_GROUP_CHANNEL_OWNERS.find(o => o.graphId === id)
            return owner ? `${owner.name} <${owner.email}>` : id
          }).join(', ')
        : null,
      ...tabWarnings,
    ].filter((w): w is string => !!w)
    const warning = warnings.length ? warnings.join(' | ') : null

    await env.DB.prepare(`
      UPDATE proposals
      SET ms_team_id = ?, ms_channel_id = ?, ms_channel_web_url = ?,
          ms_team_created_at = datetime('now'), ms_team_error = ?
      WHERE id = ?
    `).bind(teamId, channelId, channelWebUrl, warning, proposal.id).run()

    if (warning) console.error(`[Automation] Teams: ${propertyName} — ${warning}`)

    console.log(
      `[Automation] Teams: ${created ? 'created' : 'reused'} property channel "${propertyName}" ` +
      `(${channelId}) in Team ${teamId} for Hotel Group "${hotelGroupName}"`
    )
  } catch (e: any) {
    await recordError(e?.message || `Unknown error creating/updating the "${propertyName}" Teams channel`)
  }

  } catch (e: any) {
    // Backstop for the outer try opened above — should be rare in practice
    // since every known risk point already has its own specific handling,
    // but guarantees this proposal's row always ends up with SOME
    // ms_team_error rather than staying silently NULL forever.
    await recordError(`Unexpected error in Teams automation: ${e?.message || e}`)
  }
}
