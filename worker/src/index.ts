import type { Env, Session } from './types'
import { exchangeGraphAuthCode, GRAPH_DELEGATED_SCOPES } from './lib/graph'
import { err } from './lib/response'
import { requireAuth } from './lib/auth'
import {
  handleAuthCallback,
  handleSignOut,
  handleMe,
} from './routes/auth'
import {
  listProposals,
  getProposal,
  createProposal,
  sendProposal,
  resendProposal,
  updateProposal,
  deleteProposal,
  retryTeamsWorkspace,
  sweepPendingTeamsWorkspaces,
  getDashboardStats,
  getPublicProposal,
  signProposal,
  generateEmailTemplate,
  uploadAttachment,
  deleteAttachment,
  uploadCoverPhoto,
  getCoverPhoto,
} from './routes/proposals'
import { syncM365Staff, getMySignature, updateMySignature, getMyProfile, updateMyProfile } from './routes/staff'
import { submitFeedback } from './routes/feedback'
import {
  getRegionSettings, getEntitySettings, updateEntitySettings,
  getServiceCategories, createServiceCategory, updateServiceCategory,
  deleteServiceCategory, reorderServiceCategories,
} from './routes/settings'
import {
  handleHotelGroupTypeahead,
  handleGetHotelGroup,
  handleCreateHotelGroup,
  handleListEntities,
  handleUpdateHotelGroup,
  handleSearchHotelGroupsByHubspotId,
  handlePropertyTypeahead,
  handleListPropertiesByHgid,
  handleGetProperty,
  handleCreateProperty,
} from './routes/registry'
import {
  searchHubspotObjects,
  createHubspotClient,
  updateHubspotCompany,
  searchHubspotDeals,
  createHubspotDeal,
} from './routes/hubspot'

/* ── Rate limiter ────────────────────────────────────────────── */
async function checkRateLimit(request: Request, env: Env): Promise<boolean> {
  const ip  = request.headers.get('CF-Connecting-IP') || 'unknown'
  const key = `rl:${ip}`
  const raw = await env.RATE_LIMIT.get(key)
  const count = raw ? parseInt(raw) : 0
  if (count >= 120) return false   // 120 req / min per IP
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 60 })
  return true
}

/* ── Strict rate limiter for signing (public, no auth) ───────── */
async function checkSignLimit(token: string, env: Env): Promise<boolean> {
  const key = `sign:${token}`
  const raw = await env.RATE_LIMIT.get(key)
  const count = raw ? parseInt(raw) : 0
  if (count >= 5) return false
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 300 })
  return true
}

/* ── CORS allowed origins ────────────────────────────────────── */
const ALLOWED_ORIGINS = [
  'https://proposals.nuvho.com',
  'http://localhost:3000',
  'http://localhost:3001',
]

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':      allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization, Cookie',
    'Access-Control-Max-Age':           '86400',
  }
}

/* ── Main router ─────────────────────────────────────────────── */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url)
    const path   = url.pathname
    const method = request.method

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    // Rate limiting (skip on OPTIONS)
    const allowed = await checkRateLimit(request, env)
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      })
    }

    // Wrap all responses with CORS headers
    let response: Response

    try {
      response = await route(path, method, request, env, ctx)
    } catch (e: any) {
      console.error('[Worker Error]', e)
      response = err('Internal server error', 500)
    }

    // Merge CORS headers into response
    const headers = new Headers(response.headers)
    for (const [k, v] of Object.entries(corsHeaders(request))) {
      headers.set(k, v)
    }

    return new Response(response.body, {
      status:  response.status,
      headers,
    })
  },

  /* ── Cron trigger ──────────────────────────────────────────────
   * Every 5 minutes (see wrangler.toml's [triggers]), finish any Teams
   * workspace that couldn't be completed at proposal-creation time —
   * almost always a brand-new Hotel Group whose Team was still being
   * provisioned by Microsoft when the create-time automation had to give
   * up (see sweepPendingTeamsWorkspaces for the full reasoning).
   *
   * ctx.waitUntil is used so the handler returns promptly while the sweep
   * finishes; unlike a request-backed waitUntil, a scheduled invocation's
   * context is not cut short by an HTTP response completing.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sweepPendingTeamsWorkspaces(env).catch(e =>
        console.error('[Teams sweep] Sweep failed:', e)
      )
    )
  },
}

/* ── Route dispatcher ────────────────────────────────────────── */
async function route(
  path: string, method: string,
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response> {

  /* ── Public routes (no auth) ──────────────────────────────── */

  // Health check
  if (path === '/health' && method === 'GET') {
    return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // OAuth callback — POST from frontend with { code, state }
  if (path === '/auth/callback' && method === 'POST') {
    return handleAuthCallback(request, env)
  }

  // Sign-out
  if (path === '/auth/signout' && method === 'POST') {
    return handleSignOut(request, env)
  }

  // Public proposal view (by signing token)
  const publicMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)$/)
  if (publicMatch && method === 'GET') {
    // NUVCL: pass the request through so getPublicProposal can log the
    // viewer's IP, browser, and Cloudflare-derived geolocation to the
    // activity log (audit_log) for analytics on the copy-link views.
    return getPublicProposal(publicMatch[1], request, env, ctx)
  }

  // Public: sign proposal
  const signMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)\/sign$/)
  if (signMatch && method === 'POST') {
    const ok = await checkSignLimit(signMatch[1], env)
    if (!ok) return err('Too many signing attempts', 429)
    return signProposal(signMatch[1], request, env, ctx)
  }

  // Public: cover photo bytes (wizard Step 5's "Upload custom image",
  // branded Split template) — unauthenticated because the public Accept &
  // Sign page above needs to display it in a browser that never has an app
  // session, and a plain <img>/CSS background-image request never carries
  // the session cookie anyway. Uploading (POST) still requires staff auth,
  // in the authenticated section below.
  const coverPhotoMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/cover-photo$/)
  if (coverPhotoMatch && method === 'GET') {
    return getCoverPhoto(coverPhotoMatch[1], env)
  }

  // Microsoft's redirect target for the one-time delegated-Graph consent
  // that lets the Worker post Teams channel activity (app-only tokens can't
  // post channel messages — see lib/graph.ts). Unauthenticated by necessity:
  // Microsoft redirects the browser here and a cross-site navigation can't
  // be relied on to carry the session cookie. CSRF-guarded instead by the
  // single-use `state` nonce written to KV when the flow was started.
  if (path === '/admin/graph-consent/callback' && method === 'GET') {
    const url   = new URL(request.url)
    const code  = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (oauthError) return new Response(`Consent failed: ${oauthError}`, { status: 400 })
    if (!code || !state) return new Response('Missing code/state', { status: 400 })

    const pending = await env.SESSIONS.get(`graph:consent:state:${state}`)
    if (!pending) return new Response('Invalid or expired consent state — restart at /admin/graph-consent', { status: 400 })
    await env.SESSIONS.delete(`graph:consent:state:${state}`)

    try {
      const { account } = await exchangeGraphAuthCode(env, code, `${url.origin}/admin/graph-consent/callback`)
      return new Response(
        `Teams channel posting authorized as ${account}. You can close this tab.`,
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      )
    } catch (e) {
      return new Response(`Token exchange failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 })
    }
  }

  /* ── Authenticated routes ─────────────────────────────────── */
  const authResult = await requireAuth(request, env)
  if (authResult instanceof Response) return authResult
  const session: Session = authResult

  // Current user info
  if (path === '/auth/me' && method === 'GET') {
    return handleMe(request, env, session)
  }

  // Starts the one-time delegated-Graph consent for Teams channel posting.
  // Sign in as the service account (not your own account) on the Microsoft
  // page this redirects to — whichever account consents is the account the
  // channel posts will appear as.
  if (path === '/admin/graph-consent' && method === 'GET') {
    const origin = new URL(request.url).origin
    const state  = crypto.randomUUID()
    await env.SESSIONS.put(`graph:consent:state:${state}`, session.email, { expirationTtl: 600 })

    const authorizeUrl = new URL(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/authorize`)
    authorizeUrl.searchParams.set('client_id',     env.AZURE_CLIENT_ID)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('redirect_uri',  `${origin}/admin/graph-consent/callback`)
    authorizeUrl.searchParams.set('response_mode', 'query')
    authorizeUrl.searchParams.set('scope',         GRAPH_DELEGATED_SCOPES)
    authorizeUrl.searchParams.set('state',         state)
    authorizeUrl.searchParams.set('prompt',        'select_account')

    return Response.redirect(authorizeUrl.toString(), 302)
  }

  // Dashboard stats
  if (path === '/dashboard/stats' && method === 'GET') {
    return getDashboardStats(env, session)
  }

  // Staff list
  if (path === '/staff' && method === 'GET') {
    return listStaff(env)
  }

  // Sync all Nuvho users from Microsoft 365 (Graph) into the staff table
  if (path === '/staff/sync-m365' && method === 'POST') {
    return syncM365Staff(request, env, session)
  }

  // NUVCL-117: the signed-in user's own signature (Settings → User Settings;
  // pre-fills, still overridably, the proposal wizard's Signature step)
  if (path === '/staff/me/signature' && method === 'GET') {
    return getMySignature(env, session)
  }
  if (path === '/staff/me/signature' && method === 'PATCH') {
    return updateMySignature(request, env, session)
  }

  // The signed-in user's own profile — currently just role/position,
  // self-editable from Settings → User Settings.
  if (path === '/staff/me' && method === 'GET') {
    return getMyProfile(env, session)
  }
  if (path === '/staff/me' && method === 'PATCH') {
    return updateMyProfile(request, env, session)
  }

  // Platform feedback / report an issue — emails odysseus.ambut@nuvho.com
  // (cc jude.bolger@nuvho.com) via the same Graph sendMail path proposals
  // use; see routes/feedback.ts. Nothing is persisted to D1.
  if (path === '/feedback' && method === 'POST') {
    return submitFeedback(request, env, session)
  }

  // Region Settings — LEGACY read-only feed for the proposal wizard's Hotel
  // Details step ONLY (see routes/settings.ts getRegionSettings for why this
  // is kept); no longer editable via the UI, so there is no PUT here anymore.
  if (path === '/settings/regions' && method === 'GET') {
    return getRegionSettings(env, session)
  }

  // Entities (Settings → Entities) — every legal entity from the Nuvho
  // Master Registry, merged with this app's own address/about/footer/
  // currency/T&Cs settings per entity_code.
  if (path === '/settings/entities' && method === 'GET') {
    return getEntitySettings(env, session)
  }
  const entitySettingsMatch = path.match(/^\/settings\/entities\/([A-Za-z0-9_-]+)$/)
  if (entitySettingsMatch && method === 'PUT') {
    return updateEntitySettings(entitySettingsMatch[1], request, env, session)
  }

  // Service Categories (Settings → Service Lines) — main service-line
  // categories offered on Step 2 (Services) of the proposal wizard.
  if (path === '/settings/service-categories' && method === 'GET') {
    return getServiceCategories(env, session)
  }
  if (path === '/settings/service-categories' && method === 'POST') {
    return createServiceCategory(request, env, session)
  }
  // Reorder must be matched before the generic /:code match below, since
  // that regex would otherwise treat the literal path segment "order" as a
  // code value (same route-ordering gotcha as /registry/hotel-groups/search).
  if (path === '/settings/service-categories/order' && method === 'PUT') {
    return reorderServiceCategories(request, env, session)
  }
  const serviceCategoryMatch = path.match(/^\/settings\/service-categories\/([A-Za-z0-9_-]+)$/)
  if (serviceCategoryMatch && method === 'PUT') {
    return updateServiceCategory(serviceCategoryMatch[1], request, env, session)
  }
  if (serviceCategoryMatch && method === 'DELETE') {
    return deleteServiceCategory(serviceCategoryMatch[1], env, session)
  }

  // Proposals list
  if (path === '/proposals' && method === 'GET') {
    return listProposals(request, env, session)
  }

  // Create proposal
  if (path === '/proposals' && method === 'POST') {
    return createProposal(request, env, session, ctx)
  }

  // Generate email template (Claude API)
  if (path === '/proposals/generate-email-template' && method === 'POST') {
    return generateEmailTemplate(request, env, session)
  }

  // Single proposal
  const proposalMatch = path.match(/^\/proposals\/([A-Z0-9]+)$/)
  if (proposalMatch) {
    const id = proposalMatch[1]
    if (method === 'GET')    return getProposal(id, env, session)
    if (method === 'PATCH')  return updateProposal(id, request, env, session)
    if (method === 'DELETE') return deleteProposal(id, env, session)
  }

  // Send proposal
  const sendMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/send$/)
  if (sendMatch && method === 'POST') {
    return sendProposal(sendMatch[1], env, session, ctx)
  }

  // Resend proposal email — re-sends the signing-link email for a proposal
  // that's already gone out, optionally with edited To/CC/BCC recipients.
  const resendMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/resend$/)
  if (resendMatch && method === 'POST') {
    return resendProposal(resendMatch[1], request, env, session)
  }

  // Attachments (wizard Step 5 — Sender) — upload a file to an existing
  // proposal (multipart/form-data, field name "file")
  const attachmentsMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/attachments$/)
  if (attachmentsMatch && method === 'POST') {
    return uploadAttachment(attachmentsMatch[1], request, env, session)
  }
  const attachmentDetailMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/attachments\/([A-Za-z0-9_-]+)$/)
  if (attachmentDetailMatch && method === 'DELETE') {
    return deleteAttachment(attachmentDetailMatch[1], attachmentDetailMatch[2], env, session)
  }

  // Cover photo upload (wizard Step 5 — Cover Image "Upload custom image").
  // The matching public GET is registered above, before auth is required.
  if (coverPhotoMatch && method === 'POST') {
    return uploadCoverPhoto(coverPhotoMatch[1], request, env, session)
  }

  // Audit log for a proposal
  const auditMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/audit$/)
  if (auditMatch && method === 'GET') {
    return getAuditLog(auditMatch[1], env, session)
  }

  // Retry the Teams workspace automation (Team + Hotel-Group channel +
  // Property channel) for an existing proposal — added 2026-09-18 so a
  // proposal stuck with a stale ms_team_error can be re-run once the
  // underlying bug is fixed, without creating a throwaway new proposal.
  const retryTeamsMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/retry-teams$/)
  if (retryTeamsMatch && method === 'POST') {
    return retryTeamsWorkspace(retryTeamsMatch[1], env, session)
  }

  // Engagements list
  if (path === '/engagements' && method === 'GET') {
    return listEngagements(env, session)
  }

  // Registry — hotel group typeahead lookup (proxied; REGISTRY_API_KEY stays server-side)
  if (path === '/registry/hotel-groups/typeahead' && method === 'GET') {
    return handleHotelGroupTypeahead(request, env)
  }

  // Registry — reverse lookup: does a hotel group already reference this HubSpot company id?
  // Must be checked before hgDetailMatch below, since that regex would otherwise
  // treat the literal path segment "search" as a :hgid value.
  if (path === '/registry/hotel-groups/search' && method === 'GET') {
    const hubspotId = new URL(request.url).searchParams.get('hubspot_id')?.trim()
    if (!hubspotId) return err('hubspot_id is required.')
    return handleSearchHotelGroupsByHubspotId(env, hubspotId)
  }

  // Registry — full hotel group record (used to resolve entity_code after a typeahead pick)
  const hgDetailMatch = path.match(/^\/registry\/hotel-groups\/([A-Za-z0-9_-]+)$/)
  if (hgDetailMatch && method === 'GET') {
    return handleGetHotelGroup(env, hgDetailMatch[1])
  }

  // Registry — write hubspot_id back onto a hotel group once linked to a HubSpot Company
  if (hgDetailMatch && method === 'PATCH') {
    return handleUpdateHotelGroup(request, env, hgDetailMatch[1])
  }

  // Registry — create a new hotel group (Add Hotel Group flow when the wizard search finds no match)
  if (path === '/registry/hotel-groups' && method === 'POST') {
    return handleCreateHotelGroup(request, env)
  }

  // Registry — active legal entities (populates the Add Hotel Group "legal entity" choice)
  if (path === '/registry/entities' && method === 'GET') {
    return handleListEntities(env)
  }

  // NUVCL-121 (2026-08-24): GET /registry/markets removed — the Master
  // Registry dropped the market component entirely.

  // Registry — properties (issue pid, scoped to a parent hgid)
  if (path === '/registry/properties/typeahead' && method === 'GET') {
    return handlePropertyTypeahead(request, env)
  }
  if (path === '/registry/properties' && method === 'POST') {
    return handleCreateProperty(request, env)
  }
  const propDetailMatch = path.match(/^\/registry\/properties\/([A-Za-z0-9_-]+)$/)
  if (propDetailMatch && method === 'GET') {
    return handleGetProperty(env, propDetailMatch[1])
  }
  const hgPropsMatch = path.match(/^\/registry\/hotel-groups\/([A-Za-z0-9_-]+)\/properties$/)
  if (hgPropsMatch && method === 'GET') {
    return handleListPropertiesByHgid(env, hgPropsMatch[1])
  }

  // HubSpot — search companies/contacts (proxied; HUBSPOT_API_KEY stays server-side).
  // Separate CRM check from the registry lookups above — see routes/hubspot.ts.
  if (path === '/hubspot/search' && method === 'GET') {
    return searchHubspotObjects(request, env)
  }

  // HubSpot — create a new company (+ contact) when the search above finds no match
  if (path === '/hubspot/clients' && method === 'POST') {
    return createHubspotClient(request, env)
  }

  // HubSpot — write hgid/pid onto an existing company once the Master Registry side is resolved
  const hsCompanyMatch = path.match(/^\/hubspot\/companies\/([A-Za-z0-9_-]+)$/)
  if (hsCompanyMatch && method === 'PATCH') {
    return updateHubspotCompany(request, env, hsCompanyMatch[1])
  }

  // NUVCL-123 — HubSpot Deal linking on Hotel Details: search existing deals,
  // or create a new one associated to the resolved Company/Contact.
  if (path === '/hubspot/deals/search' && method === 'GET') {
    return searchHubspotDeals(request, env)
  }
  if (path === '/hubspot/deals' && method === 'POST') {
    return createHubspotDeal(request, env)
  }

  return err('Not found', 404)
}

/* ── Staff list helper ───────────────────────────────────────── */
async function listStaff(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, role, role_type, m365_upn
     FROM staff ORDER BY name`
  ).all()
  return new Response(JSON.stringify({ ok: true, data: results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/* ── Audit log helper ────────────────────────────────────────── */
async function getAuditLog(proposalId: string, env: Env, session: Session): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM audit_log WHERE proposal_id = ? ORDER BY created_at DESC'
  ).bind(proposalId).all()
  return new Response(JSON.stringify({ ok: true, data: results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/* ── Engagements list helper ─────────────────────────────────── */
async function listEngagements(env: Env, session: Session): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM engagements ORDER BY created_at DESC LIMIT 50'
  ).all()
  return new Response(JSON.stringify({ ok: true, data: results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
