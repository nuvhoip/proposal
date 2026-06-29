import type { ApiResponse } from '../types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':      'https://proposals.nuvho.com',
  'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':     'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age':           '86400',
}

export function ok<T>(data: T, status = 200): Response {
  const body: ApiResponse<T> = { success: true, data }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export function err(message: string, status = 400): Response {
  const body: ApiResponse<never> = { success: false, error: message }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export function cors(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export function corsHeaders() { return CORS_HEADERS }
