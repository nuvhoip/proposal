import type { Env, Session } from '../types'
import { ok, err } from '../lib/response'
import { getHotelGroup, listPropertiesByHgid, RegistryError } from '../lib/registry'
import {
  findTeamByName, createClientTeam, addExistingTeamMember, addChannelMember,
  createOrUpdateHotelGroupChannel, addStandardChannelTabs, hotelGroupChannelOwnerIds,
} from '../lib/graph'

/**
 * Settings → Teams Channels: manually provision the Teams workspace for a
 * Hotel Group, with a staff-chosen description, owners and members.
 *
 * This is the same find-or-create Team + createOrUpdate private channel path
 * that triggerTeamsWorkspace() runs automatically on proposal creation (see
 * routes/proposals.ts), exposed for groups that have no proposal yet — or
 * whose channel needs its roster/description corrected by hand. Deliberately
 * ONE channel per Hotel Group, matching the 2026-09-15 rework; properties are
 * listed in the description rather than getting channels of their own.
 *
 * Idempotent: an existing Team is reused and an existing channel is updated,
 * so re-running is how you fix a roster rather than something to avoid.
 */
export async function handleProvisionHotelGroupChannel(
  request: Request, env: Env, session: Session, hgid: string
): Promise<Response> {
  const body = await request.json().catch(() => null) as {
    channelName?: string
    description?:  string
    ownerIds?:     string[]
    memberIds?:    string[]
  } | null

  if (!body) return err('Invalid JSON body')

  const ownerIds  = [...new Set((body.ownerIds  || []).filter(Boolean))]
  const memberIds = [...new Set((body.memberIds || []).filter(Boolean))].filter(id => !ownerIds.includes(id))

  // The standing roster stays in charge of the Team itself even when the
  // caller picks a narrower owner set for the channel, so a hand-made
  // channel can't end up orphaned from the people who maintain the rest.
  const teamOwnerIds = [...new Set([...hotelGroupChannelOwnerIds(), ...ownerIds])]
  const channelOwnerIds = ownerIds.length ? ownerIds : hotelGroupChannelOwnerIds()

  let groupName: string
  let properties: { pid: string; property_name: string }[] = []
  try {
    const hg = await getHotelGroup(env, hgid)
    groupName = hg.trading_name || hg.group_name
    properties = await listPropertiesByHgid(env, hgid).catch(() => [])
  } catch (e) {
    if (e instanceof RegistryError) return err(`Registry lookup failed: ${e.message}`, e.status)
    return err(e instanceof Error ? e.message : 'Could not look up the Hotel Group', 502)
  }

  const channelName = (body.channelName || '').trim() || groupName
  const description = (body.description || '').trim() || [
    `Nuvho engagement workspace for ${groupName} (${hgid})`,
    properties.length
      ? `Properties: ${properties.map(p => p.property_name).join(', ')}`
      : 'Properties: (none registered yet)',
  ].join('\n')

  const warnings: string[] = []

  // ── Find or create the Team ────────────────────────────────────────
  let teamId: string
  try {
    const existing = await findTeamByName(env, groupName)
    if (existing) {
      teamId = existing.id
      for (const id of teamOwnerIds) {
        // Idempotent ("already exists" counts as success), so converging the
        // roster every run is cheaper than tracking who's already on it.
        await addExistingTeamMember(env, teamId, id, 'owner')
          .catch(() => warnings.push(`Could not add owner ${id} to the Team`))
      }
    } else {
      const created = await createClientTeam(
        env, groupName, `Nuvho engagement workspace for ${groupName}`, teamOwnerIds
      )
      teamId = created.teamId
      if (created.failedOwnerIds.length) {
        warnings.push(`Could not add these Team owners: ${created.failedOwnerIds.join(', ')}`)
      }
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : `Could not find or create the Team for "${groupName}"`, 502)
  }

  // ── Create or update the group's private channel ───────────────────
  let channelId: string, channelWebUrl: string, created: boolean
  try {
    const res = await createOrUpdateHotelGroupChannel(
      env, teamId, channelName, description, channelOwnerIds
    )
    channelId     = res.channelId
    channelWebUrl = res.webUrl
    created       = res.created
    if (res.failedOwnerIds.length) {
      warnings.push(`Could not add these channel owners: ${res.failedOwnerIds.join(', ')}`)
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not create the channel', 502)
  }

  // ── Non-owner members ──────────────────────────────────────────────
  // A private channel has its own membership, independent of the Team's, so
  // each person needs adding in both places to actually see it.
  for (const id of memberIds) {
    await addExistingTeamMember(env, teamId, id, 'member')
      .catch(() => warnings.push(`Could not add member ${id} to the Team`))
    await addChannelMember(env, teamId, channelId, id, 'member')
      .catch(() => warnings.push(`Could not add member ${id} to the channel`))
  }

  // Best-effort, same as the automated path — never fails the provisioning.
  const tabWarnings = await addStandardChannelTabs(env, teamId, channelId).catch(() => [] as string[])

  return ok({
    hgid,
    groupName,
    teamId,
    channelId,
    channelWebUrl,
    created,
    provisionedBy: session.email,
    warnings: [...warnings, ...(tabWarnings || [])],
  })
}
