import type { Env } from '../types'
import { ok, err } from '../lib/response'
import { exchangeCode, createSession } from '../lib/auth'

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { code?: string; state?: string; rememberMe?: boolean }
  if (!body.code) return err('Missing auth code')

  // Use the request Origin so local dev (localhost:3000) and production
  // (proposals.nuvho.com) both produce a redirect URI that matches what
  // Azure AD received during the authorisation step.
  const origin      = request.headers.get('Origin') || env.FRONTEND_URL
  const redirectUri = `${origin}/auth/callback`

  try {
    const { email, name, userId } = await exchangeCode(body.code, redirectUri, env)
    const cookie = await createSession(email, name, userId, env, body.rememberMe === true)
    return new Response(JSON.stringify({ success: true, data: { email, name } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie':    cookie,
        'Access-Control-Allow-Origin':      origin,
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  } catch (e: any) {
    return err(e.message || 'Auth failed', 401)
  }
}

export async function handleSignOut(request: Request, env: Env): Promise<Response> {
  const cookie = request.headers.get('Cookie') || ''
  const match  = cookie.match(/nuvho_session=([^;]+)/)
  if (match?.[1]) await env.SESSIONS.delete(`session:${match[1]}`)

  const origin = request.headers.get('Origin') || env.FRONTEND_URL
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'nuvho_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None',
      'Access-Control-Allow-Origin':      origin,
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}

export async function handleMe(request: Request, env: Env, session: any): Promise<Response> {
  const staff = session.staffId
    ? await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(session.staffId).first()
    : null
  return ok({ email: session.email, name: session.name, staffId: session.staffId, staff })
}
