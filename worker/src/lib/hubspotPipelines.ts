// ─── HubSpot deal pipelines per geo (2026-10-20) ─────────────────────────────
//
// Nuvho runs one HubSpot deal pipeline per geo — UK, AU, EU. A proposal's
// region (au | uk | ie) picks the pipeline (ie → EU). Configured by id in
// wrangler.toml [vars], one "GEO - id" pair per geo, separated by "/":
//
//   HUBSPOT_PIPELINE_ID = "UK - default / AU - 754627427 / EU - 757095237"
//   HUBSPOT_STAGE_SENT  = "UK - presentationscheduled / AU - 1097460770 / EU - 1101712252"
//
// (Unlabelled lists like "presentationscheduled/1097460770/1101712252" are
// read positionally in UK / AU / EU order.)
//
// Only two things are automated (Ody, 2026-10-20 — later stages incl. won/
// lost are worked manually in HubSpot):
//   1. a missing deal is created in the region's pipeline, first open stage;
//   2. on Send, the deal moves to that pipeline's "sent" stage.
// GET /hubspot/pipelines shows what each region resolves to.

import type { Env } from '../types'

export type DealEvent = 'created' | 'sent' | 'won'
export type ProposalRegion = 'au' | 'uk' | 'ie'
type Geo = 'UK' | 'AU' | 'EU'

const GEO_ORDER: Geo[] = ['UK', 'AU', 'EU']   // positional order for unlabelled lists
const REGION_TO_GEO: Record<ProposalRegion, Geo> = { uk: 'UK', au: 'AU', ie: 'EU' }

export interface HubspotStage {
  id: string
  label: string
  displayOrder: number
  metadata?: { isClosed?: string; probability?: string }
}
export interface HubspotPipeline {
  id: string
  label: string
  stages: HubspotStage[]
}

export function normalizeRegion(region: string | null | undefined): ProposalRegion {
  const r = (region || '').trim().toLowerCase()
  if (r === 'uk' || r === 'gb') return 'uk'
  if (r === 'ie' || r === 'eu') return 'ie'
  return 'au'
}

/** "UK - a / AU - b / EU - c" (or "UK:a, AU:b, EU:c", or positional "a/b/c") → per-geo map. */
export function parseGeoMap(raw: string | undefined): Partial<Record<Geo, string>> {
  const out: Partial<Record<Geo, string>> = {}
  const parts = (raw || '').split(/[\/,]/).map(p => p.trim()).filter(Boolean)
  parts.forEach((part, i) => {
    const m = part.match(/^(UK|GB|AU|EU|IE)\s*[-:=]\s*(\S+)$/i)
    if (m) {
      const g = m[1].toUpperCase()
      out[g === 'GB' ? 'UK' : g === 'IE' ? 'EU' : g as Geo] = m[2]
    } else if (parts.length === GEO_ORDER.length) {
      out[GEO_ORDER[i]] = part
    }
  })
  return out
}

export function pipelineIdFor(env: Env, region: ProposalRegion): string | null {
  return parseGeoMap(env.HUBSPOT_PIPELINE_ID)[REGION_TO_GEO[region]] || null
}

export function sentStageIdFor(env: Env, region: ProposalRegion): string | null {
  return parseGeoMap(env.HUBSPOT_STAGE_SENT)[REGION_TO_GEO[region]] || null
}

/** Which region a pipeline id belongs to (for deals already in a pipeline). */
export function regionForPipelineId(env: Env, pipelineId: string | null | undefined): ProposalRegion | null {
  if (!pipelineId) return null
  for (const r of ['uk', 'au', 'ie'] as ProposalRegion[]) if (pipelineIdFor(env, r) === pipelineId) return r
  return null
}

/* ─── pipeline definitions (stage order) — cached per isolate ─────────────── */

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; pipelines: HubspotPipeline[] } | null = null

export async function getDealPipelines(env: Env, fresh = false): Promise<HubspotPipeline[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.pipelines
  const res = await fetch('https://api.hubapi.com/crm/v3/pipelines/deals', {
    headers: { 'Authorization': `Bearer ${env.HUBSPOT_API_KEY}` },
  })
  if (!res.ok) {
    console.error('[HubSpot] pipelines read failed:', res.status, await res.text().catch(() => ''))
    return cache?.pipelines || []
  }
  const data = await res.json() as { results?: HubspotPipeline[] }
  const pipelines = (data.results || []).map(p => ({
    ...p, stages: [...(p.stages || [])].sort((a, b) => a.displayOrder - b.displayOrder),
  }))
  cache = { at: Date.now(), pipelines }
  return pipelines
}

/** Where a brand-new deal starts: the pipeline's first open (not closed) stage. */
export function firstOpenStage(p: HubspotPipeline | null | undefined): HubspotStage | null {
  return p?.stages.find(s => s.metadata?.isClosed !== 'true') || p?.stages[0] || null
}
