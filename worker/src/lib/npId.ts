/**
 * Local fallback for NP-{REGION}-{YYMMDD}-{6RAND} (client-facing "Proposal ID",
 * R1 ID Reference schema v1.3). Mirrors register.nuvho.com's formatNPID() so
 * the format is identical whichever side generates it. Only used when
 * reserveNpId() (worker/src/lib/registry.ts) fails — a proposal must never
 * fail to save just because the registry is unreachable. Fallback ids are
 * NOT recorded in registry.np_ids, so they carry a small (~1 in a few billion)
 * theoretical collision risk against a registry-issued id — acceptable for a
 * fallback path that should rarely trigger.
 */

const NP_RAND_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomNpSuffix(len = 6): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += NP_RAND_CHARSET[bytes[i] % NP_RAND_CHARSET.length]
  }
  return out
}

export function formatNpIdLocal(region: string, date: Date = new Date()): string {
  const yy = String(date.getUTCFullYear()).slice(-2)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `NP-${region}-${yy}${mm}${dd}-${randomNpSuffix(6)}`
}
