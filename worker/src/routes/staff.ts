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
