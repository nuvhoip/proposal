import type { Env, Session } from './types'
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
  updateProposal,
  getDashboardStats,
  getPublicProposal,
  signProposal,
  generateEmailTemplate,
} from './routes/proposals'
import { syncM365Staff } from './routes/staff'
import {
  handleHotelGroupTypeahead,
  handleGetHotelGroup,
  handleCreateHotelGroup,
  handleListEntities,
} from './routes/registry'

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
    // Store ctx globally for waitUntil in proposal handlers
    ;(globalThis as any).__executionContext = ctx

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
    return getPublicProposal(publicMatch[1], env)
  }

  // Public: sign proposal
  const signMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)\/sign$/)
  if (signMatch && method === 'POST') {
    const ok = await checkSignLimit(signMatch[1], env)
    if (!ok) return err('Too many signing attempts', 429)
    return signProposal(signMatch[1], request, env)
  }

  /* ── Authenticated routes ─────────────────────────────────── */
  const authResult = await requireAuth(request, env)
  if (authResult instanceof Response) return authResult
  const session: Session = authResult

  // Current user info
  if (path === '/auth/me' && method === 'GET') {
    return handleMe(request, env, session)
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

  // Proposals list
  if (path === '/proposals' && method === 'GET') {
    return listProposals(request, env, session)
  }

  // Create proposal
  if (path === '/proposals' && method === 'POST') {
    return createProposal(request, env, session)
  }

  // Generate email template (Claude API)
  if (path === '/proposals/generate-email-template' && method === 'POST') {
    return generateEmailTemplate(request, env, session)
  }

  // Single proposal
  const proposalMatch = path.match(/^\/proposals\/([A-Z0-9]+)$/)
  if (proposalMatch) {
    const id = proposalMatch[1]
    if (method === 'GET')   return getProposal(id, env, session)
    if (method === 'PATCH') return updateProposal(id, request, env, session)
  }

  // Send proposal
  const sendMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/send$/)
  if (sendMatch && method === 'POST') {
    return sendProposal(sendMatch[1], env, session)
  }

  // Audit log for a proposal
  const auditMatch = path.match(/^\/proposals\/([A-Z0-9]+)\/audit$/)
  if (auditMatch && method === 'GET') {
    return getAuditLog(auditMatch[1], env, session)
  }

  // Engagements list
  if (path === '/engagements' && method === 'GET') {
    return listEngagements(env, session)
  }

  // Registry — hotel group typeahead lookup (proxied; REGISTRY_API_KEY stays server-side)
  if (path === '/registry/hotel-groups/typeahead' && method === 'GET') {
    return handleHotelGroupTypeahead(request, env)
  }

  // Registry — full hotel group record (used to resolve entity_code after a typeahead pick)
  const hgDetailMatch = path.match(/^\/registry\/hotel-groups\/([A-Za-z0-9_-]+)$/)
  if (hgDetailMatch && method === 'GET') {
    return handleGetHotelGroup(env, hgDetailMatch[1])
  }

  // Registry — create a new hotel group (Add Hotel Group flow when the wizard search finds no match)
  if (path === '/registry/hotel-groups' && method === 'POST') {
    return handleCreateHotelGroup(request, env)
  }

  // Registry — active legal entities (populates the Add Hotel Group "legal entity" choice)
  if (path === '/registry/entities' && method === 'GET') {
    return handleListEntities(env)
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
