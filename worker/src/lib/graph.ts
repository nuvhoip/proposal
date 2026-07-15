import type { Env } from '../types'

/**
 * App-only (client-credentials) Microsoft Graph token.
 * Distinct from the delegated user login flow in lib/auth.ts —
 * this requires the Azure AD app registration (AZURE_CLIENT_ID) to have
 * an ADMIN-CONSENTED APPLICATION permission (e.g. User.Read.All or
 * Directory.Read.All) under Graph API permissions. Without that consent,
 * the token call below will succeed but the /users Graph call will 403.
 */
export async function getAppOnlyGraphToken(env: Env): Promise<string> {
  const params = new URLSearchParams({
    client_id:     env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    grant_type:    'client_credentials',
    scope:         'https://graph.microsoft.com/.default',
  })

  const res = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const data = await res.json() as any
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Failed to get Graph app token')
  }
  return data.access_token as string
}

export interface GraphUser {
  id:                string
  displayName:       string
  mail:              string | null
  userPrincipalName: string
  jobTitle:          string | null
  accountEnabled:    boolean
}

/**
 * Fetch every user in the tenant (paginated via @odata.nextLink),
 * restricted to enabled @nuvho.com accounts.
 */
export async function listAllTenantUsers(accessToken: string): Promise<GraphUser[]> {
  const users: GraphUser[] = []
  let url: string | null =
    'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled&$top=999'

  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data = await res.json() as any
    if (!res.ok) {
      throw new Error(data.error?.message || `Graph /users request failed (${res.status})`)
    }
    for (const u of data.value || []) {
      const upn = (u.userPrincipalName || '').toLowerCase()
      if (u.accountEnabled && upn.endsWith('@nuvho.com')) {
        users.push({
          id:                u.id,
          displayName:       u.displayName,
          mail:              u.mail,
          userPrincipalName: upn,
          jobTitle:          u.jobTitle,
          accountEnabled:    u.accountEnabled,
        })
      }
    }
    url = data['@odata.nextLink'] || null
  }

  return users
}
