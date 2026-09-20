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

/**
 * Sends an email via Microsoft Graph's app-only sendMail action — the
 * Microsoft-recommended replacement for SMTP AUTH (which Microsoft is
 * deprecating for Exchange Online) and the mechanism this codebase now uses
 * instead of the Resend transactional-email API.
 *
 * Requires the SAME Azure AD app registration as getAppOnlyGraphToken(),
 * but with the Mail.Send APPLICATION permission granted and admin-consented
 * in Entra ID — Mail.Send is a separate permission from User.Read.All /
 * Directory.Read.All (used for tenant user sync), so this will 403 with
 * "Insufficient privileges" until that specific permission is added.
 *
 * `fromMailbox` must be a real mailbox in the tenant. An app-only Mail.Send
 * token can, by default, send as ANY mailbox in the tenant — if that's
 * broader than desired, restrict it tenant-side with an Exchange Online
 * ApplicationAccessPolicy scoped to this app's client ID.
 *
 * Note: Graph's simple JSON sendMail payload has a practical message-size
 * ceiling (attachments are base64-inlined in the request body — Microsoft
 * recommends keeping the total request under ~4MB; large attachments need
 * the separate upload-session API instead). Callers with big attachments
 * should account for this rather than assume sendMail always succeeds.
 */
export async function sendMailViaGraph(
  env: Env,
  fromMailbox: string,
  mail: {
    subject: string
    html: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    replyTo?: string
    attachments?: { filename: string; contentType: string; contentBase64: string }[]
  }
): Promise<void> {
  const accessToken = await getAppOnlyGraphToken(env)

  const asRecipient = (address: string) => ({ emailAddress: { address } })

  const message: Record<string, unknown> = {
    subject: mail.subject,
    body: { contentType: 'HTML', content: mail.html },
    toRecipients: mail.to.map(asRecipient),
  }
  if (mail.cc?.length)  message.ccRecipients  = mail.cc.map(asRecipient)
  if (mail.bcc?.length) message.bccRecipients = mail.bcc.map(asRecipient)
  if (mail.replyTo)     message.replyTo = [asRecipient(mail.replyTo)]
  if (mail.attachments?.length) {
    message.attachments = mail.attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name:          a.filename,
      contentType:   a.contentType || 'application/octet-stream',
      contentBytes:  a.contentBase64,
    }))
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromMailbox)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  )

  // Graph returns 202 Accepted with an empty body on success — there is no
  // JSON to parse either way, so only branch on status for the error path.
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Graph sendMail error ${res.status}: ${detail || 'no detail'}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fixed standing roster of Nuvho team leaders who must be Graph channel
 * owners on EVERY Hotel-Group Teams channel this automation creates or
 * reuses (2026-09-15 spec, replacing the old per-proposal/per-property
 * owner list) — not just whoever happens to be the sender/account manager
 * on a given proposal. Resolved once via MS Graph find_user and pasted in
 * here rather than re-resolved on every proposal run; if this roster
 * changes, update the ids below and redeploy (no schema/env var needed —
 * these are fixed people, not per-environment config like the old
 * MS_TEAM_ID_* vars were).
 */
export const HOTEL_GROUP_CHANNEL_OWNERS: ReadonlyArray<{ name: string; email: string; graphId: string }> = [
  { name: 'Odysseus Ambut',   email: 'odysseus.ambut@nuvho.com',   graphId: '7f03ca3a-2b3a-4142-b42e-ba093c6f51fd' },
  { name: 'Jude Bolger',      email: 'jude.bolger@nuvho.com',      graphId: '6ad798e8-8a44-40d6-b370-13f9b111d56a' },
  { name: 'Alana Karic',      email: 'alana.karic@nuvho.com',      graphId: 'c8e78d29-d313-408c-8570-6836db03fade' },
  { name: 'Tess Temperley',   email: 'tess.temperley@nuvho.com',   graphId: '911ba82b-6f66-4401-b5fd-9221802a34bd' },
  { name: 'Hayley Thompson',  email: 'hayley.thompson@nuvho.com',  graphId: 'e93dfbb7-4d17-4e4a-b4a5-88e0eb9b94a2' },
  { name: 'Riley Staraj',     email: 'riley.staraj@nuvho.com',     graphId: 'f5a03704-fc4b-4721-ba89-8322a78ea077' },
  { name: 'Rebecca Janke',    email: 'rebecca.janke@nuvho.com',    graphId: 'a4497b70-a8ed-4e42-89d1-15c65d3b27ed' },
  { name: 'Matthias Dybing',  email: 'matthias.dybing@nuvho.com',  graphId: 'a5abca39-1659-4e17-8522-8ffe16691b02' },
]

/** Convenience accessor — the plain Graph user-id list most callers want. */
export function hotelGroupChannelOwnerIds(): string[] {
  return HOTEL_GROUP_CHANNEL_OWNERS.map(o => o.graphId)
}

/**
 * Creates a new Microsoft Team (client-facing workspace), named for the
 * client, with the given tenant users added as owners.
 *
 * Requires the SAME Azure AD app registration as getAppOnlyGraphToken(),
 * with the Team.Create APPLICATION permission granted and admin-consented
 * in Entra ID (separate from Mail.Send / User.Read.All used elsewhere in
 * this file). At least one owner is required by Graph, and that owner must
 * hold a Microsoft 365/Teams license — pass every id you have; Graph will
 * reject the whole call if the owners array is empty.
 *
 * IMPORTANT (confirmed via live test, 2026-09-02): Graph's POST /teams only
 * accepts a SINGLE member in the initial creation payload — passing two or
 * more (e.g. sender + account manager) fails the whole request with
 * `400 BadRequest: "Adding more than one member is not supported."` This is
 * a documented limitation of creating a team from the 'standard' template,
 * not a permissions issue. So this function creates the team with only the
 * first owner, waits for Graph to finish provisioning it, then adds any
 * remaining owners one at a time via addExistingTeamMember() (which has no
 * such restriction, since each call carries exactly one user).
 *
 * Graph's POST /teams is asynchronous: a successful call returns
 * `202 Accepted` with an empty body and a `Location` header shaped like
 * `/teams('<team-id>')/operations('<operation-id>')` — the team id in that
 * header is valid immediately (safe to store), but the team is not yet
 * ready to accept further Graph operations (adding members, creating
 * channels) until that operation reports 'succeeded'. This function polls
 * that operation for up to ~70s; if it never confirms, it proceeds anyway
 * (logging the timeout) rather than failing the whole automation, since the
 * team was, in fact, created.
 */
export async function createClientTeam(
  env: Env,
  displayName: string,
  description: string,
  ownerGraphUserIds: string[],
  fastMode = false
): Promise<{ teamId: string; failedOwnerIds: string[] }> {
  if (!ownerGraphUserIds.length) {
    throw new Error('createClientTeam: at least one owner Graph user id is required')
  }

  const accessToken = await getAppOnlyGraphToken(env)

  // Dedup (sender and account manager can be the same staff member).
  const [firstOwnerId, ...remainingOwnerIds] = [...new Set(ownerGraphUserIds)]

  const res = await fetch('https://graph.microsoft.com/v1.0/teams', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'template@odata.bind': "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
      displayName,
      description,
      visibility: 'Private',
      members: [{
        '@odata.type':     '#microsoft.graph.aadUserConversationMember',
        roles:             ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${firstOwnerId}')`,
      }],
    }),
  })

  if (res.status !== 202) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Graph create team error ${res.status}: ${detail || 'no detail'}`)
  }

  const location  = res.headers.get('Location') || ''
  const teamMatch = location.match(/teams\('([^']+)'\)/)
  const opMatch   = location.match(/operations\('([^']+)'\)/)
  if (!teamMatch) {
    throw new Error(`Graph accepted team creation but returned no parseable team id (Location: "${location}")`)
  }
  const teamId = teamMatch[1]

  if (opMatch) {
    await waitForTeamProvisioning(accessToken, teamId, opMatch[1], fastMode)
  } else {
    // No operation id to poll — fall back to a flat delay before touching
    // the team further. Shortened in fastMode for the same reason as
    // waitForTeamProvisioning above.
    await sleep(fastMode ? 3000 : 15000)
  }

  const failedOwnerIds: string[] = []
  for (const ownerId of remainingOwnerIds) {
    try {
      await addExistingTeamMember(env, teamId, ownerId, 'owner')
    } catch (e) {
      // The team (and its first owner) already exist at this point — don't
      // fail the whole automation over a secondary owner add. Logged AND
      // collected (confirmed live 2026-09-15: a per-owner add failure here
      // was previously invisible outside wrangler tail — Jude Bolger wasn't
      // added as an owner and nobody could tell why without live logs) so
      // the caller can surface it in ms_team_error instead of just logs.
      console.error(`[Teams] Failed to add additional owner ${ownerId} to new team ${teamId}:`, e)
      failedOwnerIds.push(ownerId)
    }
  }

  return { teamId, failedOwnerIds }
}

/**
 * Polls a Team-creation operation (from POST /teams's Location header)
 * until Graph reports it 'succeeded', or gives up after ~70s. Needed
 * because a just-created team 404s/400s on further Graph calls (add
 * member, create channel) until provisioning finishes — there is no
 * webhook for this from a Worker, so this is a plain poll loop. Runs
 * entirely inside ctx.waitUntil, so the wall-clock cost here doesn't block
 * the proposal-creation response the user is waiting on.
 */
async function waitForTeamProvisioning(
  accessToken: string, teamId: string, operationId: string, fastMode = false
): Promise<void> {
  // fastMode (2026-09-18): used when this whole call chain runs inside a
  // fire-and-forget ctx.waitUntil() (proposal-creation automation), which
  // Cloudflare will forcibly cancel ~30-45s after the HTTP response is
  // sent — confirmed live via wrangler tail, where a 6x15s retry loop
  // elsewhere in this file got killed mid-sleep before ANY error was ever
  // recorded to D1, silently defeating all of triggerTeamsWorkspace's own
  // try/catch error handling. A synchronous caller (retryTeamsWorkspace,
  // via POST /proposals/:id/retry-teams) isn't subject to that cutoff, so
  // it still gets the full, patient retry budget.
  const maxAttempts = fastMode ? 2 : 7
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(fastMode ? 3000 : (attempt === 0 ? 5000 : 10000))
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/teams('${teamId}')/operations('${operationId}')`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (res.ok) {
        const data = await res.json() as { status?: string }
        if (data.status === 'succeeded') return
        if (data.status === 'failed') {
          console.error(`[Teams] Provisioning operation ${operationId} for team ${teamId} reported 'failed' — proceeding anyway`)
          return
        }
        // status is 'notStarted' / 'running' — keep polling
      }
    } catch (e) {
      console.error(`[Teams] Error polling provisioning status for team ${teamId}:`, e)
    }
  }
  console.error(`[Teams] Gave up waiting for team ${teamId} to finish provisioning after ${maxAttempts} attempts — proceeding anyway`)
}

/**
 * Finds an existing Microsoft Team by exact display name — used to reuse
 * one Team per Hotel Group across every proposal/property generated under
 * it, rather than creating a new Team each time. Returns null if none
 * exists yet.
 *
 * Graph's /teams endpoint is a filtered view over Team-enabled groups and
 * supports $filter on displayName; uses the same app-only read access the
 * existing list_teams-style calls already rely on (no extra permission
 * beyond what's already granted for that).
 */
export async function findTeamByName(env: Env, displayName: string): Promise<{ id: string } | null> {
  const accessToken = await getAppOnlyGraphToken(env)
  const escaped = displayName.replace(/'/g, "''") // OData literal escaping
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/teams?$filter=${encodeURIComponent(`displayName eq '${escaped}'`)}&$select=id,displayName`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Graph find team error ${res.status}: ${detail || 'no detail'}`)
  }
  const data = await res.json() as { value?: Array<{ id: string }> }
  return data.value?.[0] ? { id: data.value[0].id } : null
}

/**
 * Adds a user to an existing Team as a plain member (or owner). Treats
 * "user is already a member" as success, so callers reusing a Team across
 * proposals can call this unconditionally without checking membership
 * first — Graph returns a 400 with a message containing "already exist"
 * for a duplicate add, which is what's matched here (not a specific error
 * code — Graph doesn't give one for this case).
 *
 * Requires the TeamMember.ReadWrite.All application permission.
 */
export async function addExistingTeamMember(
  env: Env, teamId: string, userId: string, role: 'member' | 'owner' = 'member'
): Promise<void> {
  const accessToken = await getAppOnlyGraphToken(env)
  const res = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@odata.type':     '#microsoft.graph.aadUserConversationMember',
      roles:             role === 'owner' ? ['owner'] : [],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${userId}')`,
    }),
  })
  if (res.status === 200 || res.status === 201) return
  const detail = await res.text().catch(() => '')
  if (/already exist/i.test(detail)) return // idempotent — already a member, not an error
  throw new Error(`Graph add team member error ${res.status}: ${detail || 'no detail'}`)
}

/**
 * Creates (or, if one with the same name already exists, reuses) a PRIVATE
 * Teams channel under a Team for one Hotel Group, with the given users
 * added as channel owners (private-channel membership is independent of
 * Team-level membership/roles, so this is required even when the Team
 * itself already existed and these users are already Team members/owners).
 *
 * Reworked 2026-09-15 (superseding the old per-Property createPropertyChannel
 * and the short-lived v2.0 geo-Team createOrUpdatePropertyChannel, both
 * removed): the channel is now scoped to the whole Hotel Group and reused
 * across every proposal/property under it, rather than one channel per
 * property. Like the old createOrUpdatePropertyChannel(), the description is
 * refreshed on EVERY call via patchChannelDescription() — including on a
 * reused channel — since the properties/engagement-ID list in the
 * description grows as new proposals land against the same Hotel Group.
 *
 * Only the FIRST owner is included in the initial creation call, with any
 * remaining owners added afterwards via addChannelMember() — mirroring
 * createClientTeam()'s fix above. Graph's "create channel" endpoint hasn't
 * actually been observed to reject multiple initial members the way
 * "create team" does, but private channels provision asynchronously under
 * the hood much like teams do, so the same one-then-add pattern is applied
 * here defensively rather than risking the same class of failure on a
 * second live test.
 *
 * Requires the ChannelSettings.ReadWrite.All application permission to
 * create the channel and refresh its description, and
 * ChannelMember.ReadWrite.All to add owners to a PRIVATE channel — both
 * separate from, and in addition to, the Team.Create /
 * TeamMember.ReadWrite.All permissions createClientTeam and
 * addExistingTeamMember need.
 */
// NOTE (2026-09-15): despite the name, this is now also used to create a
// separate channel per PROPERTY within the same Hotel-Group Team (see
// triggerTeamsWorkspace in routes/proposals.ts) — it's a generic "create or
// reuse a private channel with a fixed owner roster" helper, just named for
// its original use. displayName/description are simply whatever the caller
// wants for that specific channel.
// Confirmed live 2026-09-15 ("Nuvho Test 4" / HG-AU-0049): Graph rejects
// channel creation outright with a 400 ("Channel.Description can't have
// more than 1024 characters") once a Hotel Group's properties/engagement-ID
// list grows long enough — a hard, whole-channel-creation failure, not a
// warning. A character-count clamp to 1024 (first attempt, 2026-09-18)
// turned out NOT to be enough: confirmed live the same day (Hotel Group
// "Nuvho Test", team 9007c611-ecd8-470f-8bd0-bb7fc811c3c6) that a SEPARATE
// backend — the underlying Teams "Thread" service, not just Graph's own
// channel-resource validation — enforces its own limit measured in UTF-8
// BYTES, not JS string characters ("Description exceeds the allowed byte
// limit", errorCode ThreadDescriptionLimitExceeded). A description under
// 1024 JS `.length` can still be over 1024 UTF-8 bytes the moment it
// contains any multi-byte character (accented names, an em dash, even the
// "…" character this truncation suffix itself used to add), so clamping by
// character count alone is not reliable. Measure real UTF-8 byte length
// via TextEncoder and clamp well below both known limits for margin, since
// neither service's exact byte cap is documented.
const MAX_CHANNEL_DESCRIPTION_BYTES = 900

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function clampChannelDescription(description: string): string {
  if (utf8ByteLength(description) <= MAX_CHANNEL_DESCRIPTION_BYTES) return description
  // Plain ASCII suffix on purpose — no smart quotes/ellipsis/em dash, so it
  // never adds surprise multi-byte overhead of its own.
  const suffix = '\n... (truncated - see the Master Registry for the full list)'
  const budget = MAX_CHANNEL_DESCRIPTION_BYTES - utf8ByteLength(suffix)
  // Shrink one JS character at a time (never one byte at a time, which
  // could split a multi-byte character in half and produce invalid UTF-8)
  // until the remaining text's real byte length fits the budget.
  let truncated = description
  while (utf8ByteLength(truncated) > budget && truncated.length > 0) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + suffix
}

/* ─── Channel tabs (apps pinned inside a channel) ──────────────
 * 2026-09-18: every property channel gets a SharePoint tab pointing at the
 * Nuvho Systems site, plus the Asana app, per Odysseus.
 *
 * SharePoint is added as a plain Website tab rather than the dedicated
 * SharePoint app: the Website app takes a URL directly, which is exactly
 * what was asked for, whereas the SharePoint app expects a page/list id
 * from within a site and would need per-site configuration we don't have.
 * Asana is a third-party app, so its id is NOT a fixed well-known string —
 * it has to be looked up in this tenant's own app catalog at runtime.
 *
 * PERMISSIONS: this needs TeamsTab.Create.Group (or
 * TeamsTab.ReadWriteForTeam.All) for tab creation, and
 * AppCatalog.Read.All for the Asana lookup. If those aren't consented on
 * the app registration yet, these calls 403 — which is why every one of
 * them is best-effort and surfaced as a warning rather than being allowed
 * to fail a channel that otherwise created perfectly well.
 */
// The SharePoint "Pages and Lists" app — the one whose setup flow offers
// "Any SharePoint site". Renders the site INSIDE Teams, unlike the generic
// Website tab (com.microsoft.teamspace.tab.web) used here until
// 2026-09-18, which SharePoint's X-Frame-Options forces to open in a new
// browser page instead — the exact complaint that prompted this change.
//
// CAVEAT: Microsoft's Graph docs list this app under "Configuration is not
// supported", i.e. the site URL may not be presettable through the API at
// all. We try with the configuration anyway (docs do lag behavior), and
// fall back to adding the app unconfigured so it at least lands in the
// channel and someone can point it at the site in one step.
const SHAREPOINT_TAB_APP_ID = '2a527703-1f6f-4559-a332-d8a7d288cd88'
export const SHAREPOINT_TAB_URL = 'https://nuvho.sharepoint.com/sites/nuvhosystems/'

/** Looks up a Teams app's catalog id by exact display name. Returns null
 *  when the app isn't in the tenant catalog, or when the lookup isn't
 *  permitted — callers treat both as "skip this tab". */
async function findTeamsAppId(accessToken: string, displayName: string): Promise<string | null> {
  const filter = encodeURIComponent(`displayName eq '${displayName.replace(/'/g, "''")}'`)
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=${filter}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    console.error(`[Teams] Could not look up the "${displayName}" app in the tenant catalog (${res.status}):`, await res.text().catch(() => ''))
    return null
  }
  const data = await res.json() as { value?: Array<{ id: string }> }
  return data.value?.[0]?.id ?? null
}

/** Adds a tab to a channel, skipping silently if a tab with that name is
 *  already there — this whole automation re-runs on retries and sweeps, so
 *  every step has to be idempotent. Returns a warning string on failure,
 *  or null on success/skip. */
async function addChannelTab(
  accessToken: string, teamId: string, channelId: string,
  appId: string, displayName: string, configuration: Record<string, unknown> | null
): Promise<string | null> {
  try {
    const existingRes = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/tabs?$select=id,displayName`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (existingRes.ok) {
      const existing = await existingRes.json() as { value?: Array<{ displayName?: string }> }
      if (existing.value?.some(t => t.displayName === displayName)) return null
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/tabs`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${appId}`,
          ...(configuration ? { configuration } : {}),
        }),
      }
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[Teams] Could not add the "${displayName}" tab to channel ${channelId} (${res.status}):`, detail)
      return `could not add the ${displayName} tab (${res.status})`
    }
    return null
  } catch (e: any) {
    console.error(`[Teams] Error adding the "${displayName}" tab to channel ${channelId}:`, e)
    return `could not add the ${displayName} tab (${e?.message || 'unknown error'})`
  }
}

/** Pins the standard app set onto a freshly created/reused property
 *  channel. Never throws — returns human-readable warnings for anything
 *  that didn't stick, so a permissions gap shows up in ms_team_error
 *  instead of vanishing into the logs. */
export async function addStandardChannelTabs(
  env: Env, teamId: string, channelId: string
): Promise<string[]> {
  const warnings: string[] = []
  let accessToken: string
  try {
    accessToken = await getAppOnlyGraphToken(env)
  } catch (e: any) {
    return [`could not add channel tabs: ${e?.message || 'Graph token error'}`]
  }

  // Added UNCONFIGURED, per Odysseus 2026-09-18: whoever opens the tab
  // first picks "Any SharePoint site" and points it at SHAREPOINT_TAB_URL.
  // Graph doesn't support presetting configuration for this app anyway
  // (see the note on SHAREPOINT_TAB_APP_ID above), so this is the honest
  // shape — the app lands reliably, and configuring it is a one-time click
  // per channel rather than something the API can do for us.
  const sharePointWarning = await addChannelTab(
    accessToken, teamId, channelId, SHAREPOINT_TAB_APP_ID, 'SharePoint', null
  )
  if (sharePointWarning) warnings.push(sharePointWarning)

  const asanaAppId = await findTeamsAppId(accessToken, 'Asana')
  if (!asanaAppId) {
    warnings.push('could not add the Asana tab (app not found in the tenant catalog, or catalog read not permitted)')
  } else {
    // No configuration: the tab lands unconfigured and whoever opens it
    // picks the Asana project, which is what "just install the app for
    // now" means — there is no per-property Asana project to bind to yet.
    const asanaWarning = await addChannelTab(
      accessToken, teamId, channelId, asanaAppId, 'Asana', null
    )
    if (asanaWarning) warnings.push(asanaWarning)
  }

  return warnings
}

export async function createOrUpdateHotelGroupChannel(
  env: Env, teamId: string, displayName: string, rawDescription: string, ownerUserIds: string[],
  fastMode = false
): Promise<{ channelId: string; webUrl: string; created: boolean; failedOwnerIds: string[] }> {
  const description = clampChannelDescription(rawDescription)
  const accessToken = await getAppOnlyGraphToken(env)
  const [firstOwnerId, ...remainingOwnerIds] = [...new Set(ownerUserIds)]

  const channelBody = JSON.stringify({
    displayName,
    description,
    membershipType: 'private',
    // Threaded ("chat") layout rather than Graph's default 'post'. Graph calls
    // the threaded channel experience `chat`; Teams' own UI labels the same
    // thing "Threads" (vs "Posts"). layoutType is settable at creation and
    // PATCHable later, unlike membershipType which is create-only — so this
    // only affects channels created from here on; channels provisioned before
    // this change keep the post layout until they're switched, in the Teams
    // channel settings or via a PATCH.
    layoutType: 'chat',
    members: [{
      '@odata.type':     '#microsoft.graph.aadUserConversationMember',
      roles:             ['owner'],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${firstOwnerId}')`,
    }],
  })

  // A brand-new Team (from createClientTeam above) can still return
  // "404 NotFound / ItemNotFound: No team found with Group Id ..." on its
  // FIRST channel-creation attempt even after waitForTeamProvisioning
  // reported 'succeeded' — confirmed live 2026-09-15 (Kurrajong Hotel test
  // proposal): Graph's own provisioning-status signal doesn't always mean
  // every downstream endpoint (like /channels) is consistent yet. Retry
  // this specific 404 signature with backoff rather than failing the whole
  // automation over what is, in practice, still-finishing provisioning.
  // fastMode (2026-09-18): see waitForTeamProvisioning's comment above —
  // this loop used to always run the full 6x15s budget (~90s), which a
  // background ctx.waitUntil() call gets forcibly cancelled well before
  // reaching, losing the "permanently stuck Team" error below entirely.
  // In fastMode this gives up quickly so that error has a chance to fire
  // and land in ms_team_error instead of vanishing; the synchronous
  // retry-teams endpoint still uses the full, patient budget below.
  const maxAttempts = fastMode ? 2 : 6
  const retryDelayMs = fastMode ? 5000 : 15000
  let res: Response
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: channelBody,
    })
    if (res.status !== 404 || attempt >= maxAttempts) break
    const detail = await res.clone().text().catch(() => '')
    if (!/ItemNotFound|No team found/i.test(detail)) break // a different kind of 404 — don't mask it by retrying
    console.error(
      `[Teams] Team ${teamId} not yet provisioned for channel creation ` +
      `(attempt ${attempt}/${maxAttempts}) — retrying in ${retryDelayMs / 1000}s: ${detail}`
    )
    await sleep(retryDelayMs)
  }

  let channelId: string
  let webUrl: string
  let created: boolean

  if (res.status === 201) {
    const data = await res.json() as { id: string; webUrl: string }
    channelId = data.id
    webUrl    = data.webUrl
    created   = true
  } else {
    const detail = await res.text().catch(() => '')
    // Confirmed live 2026-09-15 (property channel "Retreat East", after a
    // retried proposal run): Graph does NOT always report a duplicate
    // channel name as 409 Conflict the way the v1.0 docs imply — this
    // specific template-backed create path returned a flat 400 BadRequest
    // with errorCode "ChannelNameAlreadyExist" instead. Treat both status
    // shapes as the same "look it up and reuse" case rather than only 409.
    const isDuplicateName = res.status === 409 || /ChannelNameAlreadyExist/i.test(detail)
    if (isDuplicateName) {
      const escaped = displayName.replace(/'/g, "''")
      const listRes = await fetch(
        `https://graph.microsoft.com/v1.0/teams/${teamId}/channels?$filter=${encodeURIComponent(`displayName eq '${escaped}'`)}&$select=id,webUrl`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const listData = listRes.ok ? await listRes.json() as { value?: Array<{ id: string; webUrl: string }> } : null
      if (!listData?.value?.[0]) {
        throw new Error(
          `Graph create channel error ${res.status} (duplicate name), and could not find the existing ` +
          `channel to reuse: ${detail || 'no detail'}`
        )
      }
      channelId = listData.value[0].id
      webUrl    = listData.value[0].webUrl
      created   = false
      // An existing (reused) channel already has whatever owners it was
      // created with — still attempt to add the fixed owner roster below in
      // case it's missing anyone (e.g. the roster grew since this channel
      // was first created).
    } else if (res.status === 404 && /ItemNotFound|No team found/i.test(detail)) {
      // Confirmed live 2026-09-15 (Harbour Hospitality / Kurrajong Hotel):
      // this is not always a timing issue the retry loop above can wait
      // out. Group ID 3da8fee5-2ac1-4e26-8b34-08b28586be98 showed up in
      // GET /teams (the group + Team registration exist) but permanently
      // 404'd on GET and POST /teams/{id}/channels even ~14 minutes later
      // on a second proposal — i.e. the Team never finished provisioning
      // in the Teams service itself, and never will on its own. Retrying
      // longer will not fix this; the broken Microsoft 365 Group/Team has
      // to be deleted in Entra ID / Teams admin center so the next
      // proposal's findTeamByName() no longer finds it and creates a
      // fresh, working Team under the same Hotel Group name instead.
      throw new Error(
        `[BLOCKED] Team ${teamId} ("${displayName}") appears permanently stuck: it exists as a Microsoft 365 ` +
        `Group/Team but channel creation keeps 404ing (ItemNotFound) even after retrying. This Team ` +
        `likely never finished Teams-service provisioning and will not recover on its own — delete it ` +
        `in Entra ID / Teams admin center, then retry this proposal so a fresh Team gets created. ` +
        `Raw Graph error: ${detail || 'no detail'}`
      )
    } else {
      throw new Error(`Graph create channel error ${res.status}: ${detail || 'no detail'}`)
    }
  }

  // Always refresh the description — a freshly-created channel already has
  // it from the POST body above, but re-applying is cheap and this is the
  // only path that updates a REUSED channel's properties/engagement-ID list.
  await patchChannelDescription(env, teamId, channelId, description, accessToken)

  const failedOwnerIds: string[] = []
  for (const ownerId of remainingOwnerIds) {
    try {
      await addChannelMember(env, teamId, channelId, ownerId, 'owner')
    } catch (e) {
      console.error(`[Teams] Failed to add additional owner ${ownerId} to channel ${channelId}:`, e)
      failedOwnerIds.push(ownerId)
    }
  }

  return { channelId, webUrl, created, failedOwnerIds }
}

/**
 * Adds a user to an existing PRIVATE channel as a member or owner. Mirrors
 * addExistingTeamMember() but scoped to a channel — see
 * createOrUpdateHotelGroupChannel() for why this is called separately
 * rather than passed in the initial channel-creation payload.
 */
export async function addChannelMember(
  env: Env, teamId: string, channelId: string, userId: string, role: 'member' | 'owner' = 'member'
): Promise<void> {
  const accessToken = await getAppOnlyGraphToken(env)
  const res = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@odata.type':     '#microsoft.graph.aadUserConversationMember',
      roles:             role === 'owner' ? ['owner'] : [],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${userId}')`,
    }),
  })
  if (res.status === 200 || res.status === 201) return
  const detail = await res.text().catch(() => '')
  if (/already exist/i.test(detail)) return // idempotent — already a member, not an error
  throw new Error(`Graph add channel member error ${res.status}: ${detail || 'no detail'}`)
}

/**
 * Updates an existing channel's description (Graph's `channel` resource has
 * no separate "topic" field distinct from `description` — whatever labelled
 * lines the caller wants (properties, engagement IDs, account manager, etc.)
 * are folded into this one Graph property; see triggerTeamsWorkspace()'s
 * description-building in routes/proposals.ts for the current shape).
 * Requires the ChannelSettings.ReadWrite.All application permission
 * (distinct from Channel.Create, which only covers creating a NEW channel —
 * a correction to earlier guidance in this file's history, confirmed by
 * Graph's own 403 message during 2026-09-02 testing).
 */
async function patchChannelDescription(
  env: Env, teamId: string, channelId: string, description: string, accessToken?: string
): Promise<void> {
  const token = accessToken ?? await getAppOnlyGraphToken(env)
  const res = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Graph update channel description error ${res.status}: ${detail || 'no detail'}`)
  }
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


/* ─── Delegated (service-account) Graph auth for channel posts ──
 *
 * Microsoft does NOT allow an app-only token to post a Teams channel
 * message. The Application permission on
 * POST /teams/{id}/channels/{id}/messages is Teamwork.Migrate.All, which
 * only works against a channel put into migration mode — see
 * https://learn.microsoft.com/graph/api/channel-post-messages. Ordinary
 * posting requires a DELEGATED token (ChannelMessage.Send), so channel
 * activity notifications run as a dedicated service account instead of as
 * the app itself. Everything else in this file stays app-only.
 *
 * Auth model: one interactive consent (GET /admin/graph-consent, staff-only)
 * captures a refresh token for that account. The refresh token lives in KV
 * rather than in a wrangler secret because Entra rotates it on every
 * redemption and a Worker cannot rewrite its own secrets at runtime — the
 * GRAPH_REFRESH_TOKEN secret is only read as a first-run seed. Access
 * tokens are cached in KV until shortly before they expire.
 */
export const GRAPH_DELEGATED_SCOPES = 'offline_access openid profile email ChannelMessage.Send'

const KV_GRAPH_REFRESH = 'graph:delegated:refresh_token'
const KV_GRAPH_ACCESS  = 'graph:delegated:access_token'

export async function getDelegatedGraphToken(env: Env): Promise<string> {
  const cached = await env.SESSIONS.get(KV_GRAPH_ACCESS)
  if (cached) return cached

  const refreshToken = (await env.SESSIONS.get(KV_GRAPH_REFRESH)) || env.GRAPH_REFRESH_TOKEN
  if (!refreshToken) {
    throw new Error(
      'No delegated Graph refresh token stored — a staff user must visit /admin/graph-consent once to authorize the service account'
    )
  }

  const params = new URLSearchParams({
    client_id:     env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    scope:         GRAPH_DELEGATED_SCOPES,
  })

  const res  = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const data = await res.json() as any
  if (!res.ok || data.error) {
    throw new Error(
      `Delegated Graph token refresh failed: ${data.error_description || data.error}. ` +
      'Re-authorize at /admin/graph-consent (refresh tokens expire after ~90 days of inactivity, ' +
      'and are revoked by a password change or a conditional-access policy change).'
    )
  }

  // Entra issues a NEW refresh token on every redemption and ages the old
  // one out — persisting it here is what keeps the integration alive past
  // the first refresh.
  if (data.refresh_token) await env.SESSIONS.put(KV_GRAPH_REFRESH, data.refresh_token)

  const ttl = Math.max(60, (Number(data.expires_in) || 3600) - 300)
  await env.SESSIONS.put(KV_GRAPH_ACCESS, data.access_token, { expirationTtl: ttl })
  return data.access_token as string
}

/**
 * One-time authorization-code exchange behind /admin/graph-consent/callback.
 * Stores the resulting refresh token in KV and reports which account was
 * authorized (read out of the id_token, so no extra Graph call is needed).
 */
export async function exchangeGraphAuthCode(
  env: Env, code: string, redirectUri: string
): Promise<{ account: string }> {
  const params = new URLSearchParams({
    client_id:     env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    scope:         GRAPH_DELEGATED_SCOPES,
  })

  const res  = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const data = await res.json() as any
  if (!res.ok || data.error || !data.refresh_token) {
    throw new Error(data.error_description || data.error || 'No refresh token returned (is offline_access consented?)')
  }

  await env.SESSIONS.put(KV_GRAPH_REFRESH, data.refresh_token)
  await env.SESSIONS.delete(KV_GRAPH_ACCESS)   // force a fresh access token on next use

  let account = 'unknown'
  try {
    const payload = JSON.parse(atob(String(data.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    account = payload.preferred_username || payload.email || payload.name || 'unknown'
  } catch { /* id_token is informational only — never fail the consent over it */ }

  return { account }
}

/**
 * Posts an HTML message into a Teams channel as the consented service
 * account. Members are notified through their own channel notification
 * settings; no @mentions are used.
 */
export async function sendChannelMessage(
  env: Env, teamId: string, channelId: string, html: string
): Promise<void> {
  const accessToken = await getDelegatedGraphToken(env)

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ body: { contentType: 'html', content: html } }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Teams channel message failed (${res.status}): ${text.slice(0, 300)}`)
  }
}
