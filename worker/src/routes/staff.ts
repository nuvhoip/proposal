import type { Env, Session } from '../types'
import { ok, err } from '../lib/response'
import { ulid } from '../lib/ulid'
import { getAppOnlyGraphToken, listAllTenantUsers } from '../lib/graph'

/* ─── Sync all Nuvho M365 users into the staff table ───────── */
export async function syncM365Staff(request: Request, env: Env, session: Session): Promise<Response> {
  let token: string
  try {
    token = await getAppOnlyGraphToken(env)
  } catch (e: any) {
    return err(
      `Could not authenticate to Microsoft Graph (app-only): ${e.message}. ` +
      `Check that the Azure AD app registration has an admin-consented ` +
      `application permission (User.Read.All or Directory.Read.All).`,
      502
    )
  }

  let users
  try {
    users = await listAllTenantUsers(token)
  } catch (e: any) {
    return err(
      `Microsoft Graph rejected the /users request: ${e.message}. ` +
      `This usually means the application permission exists but has not been ` +
      `granted admin consent in Azure AD yet.`,
      502
    )
  }

  let created = 0
  let updated = 0

  for (const u of users) {
    const email = u.mail?.toLowerCase() || u.userPrincipalName
    if (!email) continue

    const existing = await env.DB.prepare('SELECT id FROM staff WHERE email = ?')
      .bind(email).first<{ id: string }>()

    if (existing) {
      await env.DB.prepare(`
        UPDATE staff SET name = ?, m365_user_id = ?, m365_upn = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(u.displayName, u.id, u.userPrincipalName, existing.id).run()
      updated++
    } else {
      await env.DB.prepare(`
        INSERT INTO staff (
          id, name, email, role, role_type, bd_facing, is_signatory,
          m365_user_id, m365_upn, timezone
        ) VALUES (?, ?, ?, ?, 'ops', 1, 0, ?, ?, 'Australia/Sydney')
      `).bind(
        ulid(), u.displayName, email, u.jobTitle || 'Staff',
        u.id, u.userPrincipalName,
      ).run()
      created++
    }
  }

  return ok({ total: users.length, created, updated })
}

/* ─── NUVCL-117: per-user signature ──────────────────────────
   Scoped to session.staffId only — a user can read/write their OWN
   signature, never another staff member's, since staffId never comes from
   the request body/URL here. Used by Settings → User Settings to save it,
   and by the proposal wizard to pre-fill (still overridably) Step 7's
   Signature step for new proposals. */
export async function getMySignature(env: Env, session: Session): Promise<Response> {
  if (!session.staffId) return err('Your account is not linked to a staff record', 409)
  const row = await env.DB.prepare(
    'SELECT name, signature_method, signature_data_url FROM staff WHERE id = ?'
  ).bind(session.staffId).first<{ name: string; signature_method: string | null; signature_data_url: string | null }>()
  if (!row) return err('Staff record not found', 404)
  return ok({
    signatoryName:     row.name,
    signatureMethod:   row.signature_method,
    signatureDataUrl:  row.signature_data_url,
  })
}

export async function updateMySignature(request: Request, env: Env, session: Session): Promise<Response> {
  if (!session.staffId) return err('Your account is not linked to a staff record', 409)
  const body = await request.json() as { signatureMethod?: 'type' | 'draw' | null; signatureDataUrl?: string | null }

  if (body.signatureMethod && !['type', 'draw'].includes(body.signatureMethod)) {
    return err('signatureMethod must be "type" or "draw"', 400)
  }
  if (body.signatureMethod === 'draw' && !body.signatureDataUrl) {
    return err('signatureDataUrl is required when signatureMethod is "draw"', 400)
  }

  await env.DB.prepare(
    `UPDATE staff SET signature_method = ?, signature_data_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    body.signatureMethod || null,
    body.signatureMethod === 'draw' ? (body.signatureDataUrl || null) : null,
    session.staffId,
  ).run()

  return ok({ saved: true })
}

/* ─── Self-service role / position ───────────────────────────
   Scoped to session.staffId only, same pattern as the signature endpoints
   above. `role` (the staff table's free-text job-title column) was
   previously only ever set by M365 sync at first creation, or by admin/
   seed data — syncM365Staff's UPDATE branch above deliberately does not
   touch `role` on existing records, so this is the first path that lets a
   user edit their own, and a later M365 sync will not silently overwrite
   whatever they set here. Shown in Settings → User Settings. */
export async function getMyProfile(env: Env, session: Session): Promise<Response> {
  if (!session.staffId) return err('Your account is not linked to a staff record', 409)
  const row = await env.DB.prepare(
    'SELECT name, email, role FROM staff WHERE id = ?'
  ).bind(session.staffId).first<{ name: string; email: string; role: string }>()
  if (!row) return err('Staff record not found', 404)
  return ok({ name: row.name, email: row.email, role: row.role })
}

export async function updateMyProfile(request: Request, env: Env, session: Session): Promise<Response> {
  if (!session.staffId) return err('Your account is not linked to a staff record', 409)
  const body = await request.json() as { role?: string }
  const role = typeof body.role === 'string' ? body.role.trim() : ''

  if (!role) return err('role is required', 400)
  if (role.length > 100) return err('role must be 100 characters or fewer', 400)

  await env.DB.prepare(
    `UPDATE staff SET role = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(role, session.staffId).run()

  return ok({ saved: true, role })
}

/* ─── Account managers (2026-11-10) ──────────────────────────
   staff.is_account_manager (migration 0025) decides who appears in the
   Account Manager picker in Step 1. Only someone who is already an account
   manager can change the list; while nobody is marked (e.g. straight after
   the column is added without the seed), anyone signed in can. */
export async function setAccountManager(staffId: string, request: Request, env: Env, session: Session): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { isAccountManager?: unknown }
  if (typeof body.isAccountManager !== 'boolean') return err('isAccountManager must be true or false', 400)

  let anyManagers: { n: number } | null
  try {
    anyManagers = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff WHERE is_account_manager = 1').first<{ n: number }>()
  } catch {
    return err('Account managers are not set up yet (run migration 0025)', 409)
  }
  if ((anyManagers?.n ?? 0) > 0) {
    const me = session.staffId
      ? await env.DB.prepare('SELECT is_account_manager FROM staff WHERE id = ?').bind(session.staffId).first<{ is_account_manager: number }>()
      : null
    if (!me?.is_account_manager) return err('Only account managers can change this list', 403)
  }

  const target = await env.DB.prepare('SELECT id FROM staff WHERE id = ?').bind(staffId).first<{ id: string }>()
  if (!target) return err('Staff member not found', 404)
  if (!body.isAccountManager && staffId === session.staffId) {
    const others = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff WHERE is_account_manager = 1 AND id != ?').bind(staffId).first<{ n: number }>()
    if (!others?.n) return err('At least one account manager must remain', 409)
  }

  await env.DB.prepare(
    `UPDATE staff SET is_account_manager = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(body.isAccountManager ? 1 : 0, staffId).run()
  return ok({ id: staffId, isAccountManager: body.isAccountManager })
}
