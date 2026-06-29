/**
 * V8-compatible ULID generator — no Node.js APIs, no external deps.
 * Uses crypto.getRandomValues() available in Cloudflare Workers runtime.
 */

const ENCODING       = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN   = ENCODING.length
const TIME_LEN       = 10
const RANDOM_LEN     = 16

function encodeTime(now: number, len: number): string {
  let str = ''
  for (let i = len - 1; i >= 0; i--) {
    str = ENCODING[now % ENCODING_LEN] + str
    now = Math.floor(now / ENCODING_LEN)
  }
  return str
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let str = ''
  for (let i = 0; i < len; i++) {
    str += ENCODING[bytes[i] % ENCODING_LEN]
  }
  return str
}

export function ulid(seedTime?: number): string {
  const now = seedTime !== undefined ? seedTime : Date.now()
  return encodeTime(now, TIME_LEN) + encodeRandom(RANDOM_LEN)
}

/** Generates a URL-safe random token of the given byte length (hex-encoded). */
export function randomToken(bytes: number = 24): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}
