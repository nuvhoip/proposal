import type { Env, Session } from '../types'
import { err } from './response'

const SESSION_TTL          = 60 * 60 * 8       // 8 hours (default)
const SESSION_TTL_REMEMBER = 60 * 60 * 24 * 30 // 30 days ("Remember me")

/**
 * Validate the session cookie and return the Session,
 * or return a 401 Response if missing/invalid.
 */
export async function requireAuth(
  request: Request,
  env: Env
): Promise<Session | Response> {
  const cookie  = request.headers.get('Cookie') || ''
  const match   = cookie.match(/nuvho_session=([^;]+)/)
  const token   = match?.[1]
  if (!token) return err('Unauthorised', 401)

  const raw = await env.SESSIONS.get(`session:${token}`)
  if (!raw)  return err('Session expired', 401)

  const session: Session = JSON.parse(raw)
  if (Date.now() > session.expiresAt) {
    await env.SESSIONS.delete(`session:${token}`)
    return err('Session expired', 401)
  }
  return session
}

/**
 * Exchange Azure AD auth code for tokens, validate domain.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  env: Env
): Promise<{ accessToken: string; email: string; name: string; userId: string }> {
  const params = new URLSearchParams({
    client_id:     env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    code,
    redirect_uri:  redirectUri,
    grant_type:    'authorization_code',
    scope:         'openid profile email User.Read',
  })

  const res = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const tokens = await res.json() as any
  if (tokens.error) throw new Error(tokens.error_description || tokens.error)

  // Validate domain
  const meRes  = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const me = await meRes.json() as any
  // Some accounts have mail=null; fall back to userPrincipalName (always set)
  const email = (me.mail || me.userPrincipalName || '').toLowerCase()
  if (!email.endsWith('@nuvho.com')) throw new Error('Only @nuvho.com accounts are authorised')

  return {
    accessToken: tokens.access_token,
    email,
    name:   me.displayName || email,
    userId: me.id,
  }
}

/**
 * Create a session and return the cookie string.
 * SameSite=None allows the cookie to be sent in cross-origin requests
 * (e.g. localhost:3000 → proposals-api.nuvho.com during local dev).
 * Secure is required when SameSite=None.
 */
export async function createSession(
  email:      string,
  name:       string,
  userId:     string,
  env:        Env,
  rememberMe: boolean = false
): Promise<string> {
  const token  = Array.from(crypto.getRandomValues(new Uint8Array(32)),
    b => b.toString(16).padStart(2, '0')).join('')

  const staff = await env.DB.prepare(
    'SELECT id FROM staff WHERE email = ?'
  ).bind(email).first<{ id: string }>()

  const ttl = rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL

  const session: Session = {
    userId,
    email,
    name,
    staffId: staff?.id,
    expiresAt: Date.now() + ttl * 1000,
  }
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(session), { expirationTtl: ttl })

  // Persistent cookie (Max-Age set) when "remember me" is checked, otherwise a
  // session cookie that still expires server-side via SESSION_TTL/KV TTL.
  const maxAge = `; Max-Age=${ttl}`
  return `nuvho_session=${token}; HttpOnly; Secure; SameSite=None${maxAge}; Path=/`
}
