// ⚠️ UNUSED as of 2026-09-15 — kept for reference only, no longer imported
// anywhere. The v2.0 per-Property channel-naming scheme below (display_pid
// slugs, `{display_pid} — {Property Name}` channel names) was superseded by
// a Team-per-Hotel-Group design where the channel name is simply the Hotel
// Group's own name (see routes/proposals.ts's triggerTeamsWorkspace and
// lib/graph.ts's createOrUpdateHotelGroupChannel). Safe to delete this file
// once nobody needs to resurrect the old slug heuristic.
//
// Microsoft Teams v2.0 channel-naming helpers for the property-level Teams
// restructure (see the "Microsoft Teams" v2.0 spec: channel = property,
// living inside one of 4 fixed geo Teams — Nuvho — AU/UK/IE/Internal —
// instead of the previous one-Team-per-Hotel-Group design).
//
// The spec's channel name is `{display_pid} — {Property Name}`, where
// display_pid is a short, human-readable slug (e.g. "PRP-MNDL-RUS" for a
// Hotel Group "Mandala" / Property "Mandala on Russell") — DISTINCT from
// the Master Registry's own canonical pid (e.g. "PRP-AU-000001"), which
// still appears in the channel description.
//
// IMPORTANT — the Master Registry has no display_pid/slug field today (only
// the canonical pid). Per Odysseus's explicit choice (2026-09-03 session),
// this slug is derived ENTIRELY inside this Worker, from the Hotel Group's
// and Property's names, using a best-effort heuristic reverse-engineered
// from the spec's one worked example:
//   - Hotel Group slug: the group name's CONSONANT SKELETON (vowels
//     stripped), up to 4 letters — "Mandala" -> M,A,N,D,A,L,A -> strip
//     vowels -> "MNDL".
//   - Property slug: the first 3 letters of the LAST significant
//     (non-stopword) word in the property name — "Mandala on Russell" ->
//     drop "on" -> last word "Russell" -> "RUS".
// This is a heuristic, not a canonical identifier — nothing outside Teams
// naming depends on it, and if an auto-generated slug looks wrong, it's
// always safe to just rename the Teams channel by hand afterward (channel
// renaming is non-destructive and preserves history, per the spec itself).

const STOPWORDS = new Set([
  'THE', 'A', 'AN', 'HOTEL', 'HOTELS', 'RESORT', 'RESORTS', 'GROUP', 'GROUPS',
  'ON', 'AT', 'IN', 'OF', 'AND', 'SPA', 'INN', 'SUITES', 'APARTMENTS',
  'COLLECTION', 'PROPERTIES', 'BY',
])

function significantWords(name: string): string[] {
  const words = name
    .replace(/[^A-Za-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOPWORDS.has(w.toUpperCase()))
  return words.length ? words : [name.replace(/[^A-Za-z]/g, '') || 'X']
}

/** Hotel Group slug: consonant skeleton of the whole (stopword-stripped)
 *  name, up to `len` letters. Pads with the name's own vowels, in order,
 *  if there aren't enough consonants to reach `len`. */
export function hotelGroupSlug(name: string, len = 4): string {
  const letters = significantWords(name).join('').toUpperCase()
  const consonants = letters.replace(/[AEIOU]/g, '')
  let slug = consonants.slice(0, len)
  if (slug.length < len) {
    const vowels = letters.replace(/[^AEIOU]/g, '')
    slug = (slug + vowels).slice(0, len)
  }
  return slug || 'GRP'
}

/** Property slug: first `len` letters of the last significant word in the
 *  property name (usually the street/suburb — "Mandala on Russell" -> "Russell"). */
export function propertySlug(name: string, len = 3): string {
  const words = significantWords(name)
  const last = words[words.length - 1]
  return last.toUpperCase().slice(0, len) || 'PPT'
}

/** Builds the spec's display_pid, e.g. "PRP-MNDL-RUS". */
export function buildDisplayPid(hotelGroupName: string, propertyName: string): string {
  return `PRP-${hotelGroupSlug(hotelGroupName)}-${propertySlug(propertyName)}`
}

/** Builds the spec's channel display name, e.g. "PRP-MNDL-RUS — Mandala on Russell". */
export function buildChannelDisplayName(hotelGroupName: string, propertyName: string): string {
  return `${buildDisplayPid(hotelGroupName, propertyName)} — ${propertyName}`
}
