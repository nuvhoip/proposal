import type { Env, ProposalRow, ServiceRow, Session } from '../types'
import { ok, err } from '../lib/response'
import { ulid, randomToken } from '../lib/ulid'

/* ─── List proposals ───────────────────────────────────────── */
export async function listProposals(request: Request, env: Env, session: Session): Promise<Response> {
  const url    = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit  = parseInt(url.searchParams.get('limit') || '50')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  let query = 'SELECT p.*, GROUP_CONCAT(ps.code) as service_codes FROM proposals p LEFT JOIN proposal_services ps ON ps.proposal_id = p.id'
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

/* ─── Get single proposal ──────────────────────────────────── */
export async function getProposal(proposalId: string, env: Env, session: Session): Promise<Response> {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?')
    .bind(proposalId).first<ProposalRow>()
  if (!proposal) return err('Proposal not found', 404)

  const { results: services } = await env.DB.prepare(
    'SELECT * FROM proposal_services WHERE proposal_id = ?'
  ).bind(proposalId).all<ServiceRow>()

  const sender = await env.DB.prepare('SELECT * FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first()

  return ok({ ...proposal, services, sender })
}

/* ─── Create proposal ──────────────────────────────────────── */
export async function createProposal(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json() as any
  const { hotel, services, sender, cover } = body

  if (!hotel?.name)         return err('Hotel name required')
  if (!hotel?.contactEmail) return err('Contact email required')
  if (!services?.length)    return err('At least one service required')
  if (!sender?.staffId)     return err('Sender staff required')

  // Verify sender staff exists
  const staff = await env.DB.prepare('SELECT * FROM staff WHERE id = ?')
    .bind(sender.staffId).first()
  if (!staff) return err('Staff member not found')

  const proposalId    = ulid()
  const signingToken  = randomToken(24)
  const expiresAt     = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()  // 30 days

  // Insert proposal
  await env.DB.prepare(`
    INSERT INTO proposals (
      id, hotel_name, contact_name, contact_email, contact_phone, contact_title,
      property_address, region, status, sender_staff_id, sender_message,
      cover_url, hubspot_deal_id, signing_token, expires_at, valid_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    proposalId,
    hotel.name, hotel.contactName, hotel.contactEmail,
    hotel.contactPhone || null, hotel.contactTitle || null,
    hotel.propertyAddress || null, hotel.region || 'au',
    sender.staffId, sender.message || null,
    cover?.coverUrl || null, hotel.hubspotDealId || null,
    signingToken, expiresAt, expiresAt,
  ).run()

  // Insert services
  for (const svc of services) {
    await env.DB.prepare(`
      INSERT INTO proposal_services (id, proposal_id, code, monthly_fee, setup_fee, term_months)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      ulid(), proposalId, svc.code,
      svc.monthlyFee || 0, svc.setupFee || 0, svc.term || 12
    ).run()
  }

  // Audit log
  await auditLog(env, proposalId, 'created', session.email, { hotelName: hotel.name })

  // Trigger background automations (non-blocking)
  const ctx = (globalThis as any).__executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposalId, 'created', env))
  }

  return ok({ id: proposalId, signingToken }, 201)
}

/* ─── Send proposal ────────────────────────────────────────── */
export async function sendProposal(proposalId: string, env: Env, session: Session): Promise<Response> {
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

  // Send email
  await sendProposalEmail(proposal, publicUrl, env)

  await auditLog(env, proposalId, 'sent', session.email, { to: proposal.contact_email })

  // Trigger A1/A2 automations
  const ctx = (globalThis as any).__executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposalId, 'sent', env))
  }

  return ok({ status: 'sent', publicUrl })
}

/* ─── Update proposal ──────────────────────────────────────── */
export async function updateProposal(
  proposalId: string, request: Request, env: Env, session: Session
): Promise<Response> {
  const body = await request.json() as Partial<ProposalRow>
  const allowed = ['status', 'sender_message', 'cover_url', 'hubspot_deal_id']
  const updates: string[] = []
  const values:  any[]    = []

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`)
      values.push((body as any)[key])
    }
  }
  if (!updates.length) return err('No valid fields to update')

  updates.push("updated_at = datetime('now')")
  values.push(proposalId)

  await env.DB.prepare(
    `UPDATE proposals SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run()

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
export async function getPublicProposal(token: string, env: Env): Promise<Response> {
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

  const { results: services } = await env.DB.prepare(
    'SELECT * FROM proposal_services WHERE proposal_id = ?'
  ).bind(proposal.id).all<ServiceRow>()

  const sender = await env.DB.prepare('SELECT name, email, role FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first()

  // Strip internal fields from public response
  const { signing_token: _, ...safe } = proposal
  return ok({ ...safe, services, sender })
}

/* ─── Public: sign proposal ────────────────────────────────── */
export async function signProposal(token: string, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { signerName?: string }
  if (!body.signerName?.trim()) return err('Signer name required')

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
  `).bind(body.signerName.trim(), proposal.id).run()

  await auditLog(env, proposal.id, 'signed', proposal.contact_email, { signerName: body.signerName })

  // Trigger A3–A9 automations
  const ctx = (globalThis as any).__executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(triggerAutomations(proposal.id, 'signed', env))
  }

  return ok({ signed: true, message: 'Proposal accepted. Our team will be in touch shortly.' })
}

/* ─── Helpers ─────────────────────────────────────────────── */
async function auditLog(
  env: Env, proposalId: string, event: string, actor: string, meta?: object
) {
  await env.DB.prepare(
    'INSERT INTO audit_log (id, proposal_id, event, actor, meta) VALUES (?, ?, ?, ?, ?)'
  ).bind(ulid(), proposalId, event, actor, meta ? JSON.stringify(meta) : null).run()
}

async function sendProposalEmail(proposal: ProposalRow, publicUrl: string, env: Env) {
  // Uses Resend API (Mailchannels fallback)
  const sender = await env.DB.prepare('SELECT name, email FROM staff WHERE id = ?')
    .bind(proposal.sender_staff_id).first<{ name: string; email: string }>()

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #28687F; padding: 24px; text-align: center;">
        <h1 style="color: white; font-size: 22px; margin: 0;">Nuvho — Smart Hoteliers</h1>
      </div>
      <div style="padding: 32px 24px;">
        <p>Dear ${proposal.contact_name},</p>
        ${proposal.sender_message ? `<p>${proposal.sender_message}</p>` : ''}
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

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    `${sender?.name || 'Nuvho Team'} <proposals@nuvho.com>`,
      to:      [proposal.contact_email],
      subject: `Your Nuvho Proposal — ${proposal.hotel_name}`,
      html,
    }),
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

  if (event === 'signed') {
    // A2: HubSpot — mark deal as won
    await triggerHubspot(proposal, services, 'won', env).catch(console.error)
    // A3: Asana — create onboarding project
    await triggerAsana(proposal, services, env).catch(console.error)
    // A4: SharePoint — create client folder
    await triggerSharePoint(proposal, env).catch(console.error)
    // A5: Xero — create quote/invoice
    await triggerXero(proposal, services, env).catch(console.error)
    // A6: Teams — notify channel
    await triggerTeamsNotification(proposal, env).catch(console.error)
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

async function triggerTeamsNotification(proposal: ProposalRow, env: Env) {
  // Stub — uses MS Graph to post to the Sales channel
  console.log(`[Automation] Teams: ${proposal.hotel_name} signed!`)
}
