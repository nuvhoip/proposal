'use client'

import { useEffect, useMemo, useState } from 'react'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

type HotelGroup = { hgid: string; group_name: string; trading_name: string | null; geo: string; status: string }
type Property   = { pid: string; hgid: string; property_name: string; geo: string; status: string }
type Staff      = { id: string; name: string; email: string; role: string; m365_user_id: string | null }

type ProvisionResult = {
  groupName: string; channelWebUrl: string; created: boolean; warnings: string[]
}

export default function TeamsChannelsPage() {
  const [groups,     setGroups]     = useState<HotelGroup[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [staff,      setStaff]      = useState<Staff[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [filter,     setFilter]     = useState('')
  const [expanded,   setExpanded]   = useState<string | null>(null)

  // Provisioning dialog state
  const [target,      setTarget]      = useState<HotelGroup | null>(null)
  const [channelName, setChannelName] = useState('')
  const [description, setDescription] = useState('')
  const [ownerIds,    setOwnerIds]    = useState<string[]>([])
  const [memberIds,   setMemberIds]   = useState<string[]>([])
  const [submitting,  setSubmitting]  = useState(false)
  const [result,      setResult]      = useState<ProvisionResult | null>(null)
  const [dialogError, setDialogError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`${WORKER}/registry/hotel-groups/all`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${WORKER}/registry/properties/all`,   { credentials: 'include' }).then(r => r.json()),
      fetch(`${WORKER}/staff`,                     { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([g, p, s]) => {
        if (g?.error) throw new Error(g.error)
        setGroups(g?.data?.hotelGroups || [])
        setProperties(p?.data?.properties || [])
        // Only staff with a Graph id can actually be added to a Team.
        setStaff((s?.data || []).filter((m: Staff) => m.m365_user_id))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load registry data'))
      .finally(() => setLoading(false))
  }, [])

  const propsByGroup = useMemo(() => {
    const map: Record<string, Property[]> = {}
    for (const p of properties) (map[p.hgid] ||= []).push(p)
    return map
  }, [properties])

  const visibleGroups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g =>
      (g.trading_name || g.group_name).toLowerCase().includes(q) ||
      g.hgid.toLowerCase().includes(q) ||
      (propsByGroup[g.hgid] || []).some(p => p.property_name.toLowerCase().includes(q))
    )
  }, [groups, filter, propsByGroup])

  function openDialog(group: HotelGroup) {
    const name = group.trading_name || group.group_name
    const groupProps = propsByGroup[group.hgid] || []
    setTarget(group)
    setChannelName(name)
    setDescription([
      `Nuvho engagement workspace for ${name} (${group.hgid})`,
      groupProps.length
        ? `Properties: ${groupProps.map(p => p.property_name).join(', ')}`
        : 'Properties: (none registered yet)',
    ].join('\n'))
    setOwnerIds([])
    setMemberIds([])
    setResult(null)
    setDialogError('')
  }

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  async function submit() {
    if (!target) return
    setSubmitting(true)
    setDialogError('')
    try {
      const res = await fetch(`${WORKER}/teams/hotel-groups/${target.hgid}/channel`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelName,
          description,
          ownerIds:  ownerIds.map(id => staff.find(s => s.id === id)?.m365_user_id).filter(Boolean),
          memberIds: memberIds.map(id => staff.find(s => s.id === id)?.m365_user_id).filter(Boolean),
        }),
      })
      const json = await res.json()
      if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`)
      setResult(json.data)
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'Provisioning failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--nv-text-muted)' }}>Loading hotel groups…</p>
  if (error)   return <p style={{ color: 'var(--nv-danger, #b00)' }}>{error}</p>

  return (
    <div style={{ width: '100%', maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontFamily: 'var(--nv-font-display)', margin: '0 0 6px' }}>
        Teams Channels
      </h1>
      <p style={{ color: 'var(--nv-text-muted)', fontSize: 13, margin: '0 0 20px' }}>
        One private channel per Hotel Group, inside that group&apos;s Team. Creating a channel here
        runs the same automation a new proposal triggers — safe to re-run to fix a description or roster.
      </p>

      <input
        className="nv-input"
        placeholder="Filter by group, hotel or HGID…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ width: '100%', marginBottom: 16 }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleGroups.map(group => {
          const groupProps = propsByGroup[group.hgid] || []
          const isOpen = expanded === group.hgid
          return (
            <div key={group.hgid} className="nv-card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : group.hgid)}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
                             font: 'inherit', fontWeight: 600, color: 'var(--nv-blue-slate)' }}
                  >
                    {isOpen ? '▾' : '▸'} {group.trading_name || group.group_name}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--nv-text-muted)', marginTop: 2 }}>
                    {group.hgid} · {group.geo} · {groupProps.length} propert{groupProps.length === 1 ? 'y' : 'ies'}
                  </div>
                </div>
                <button className="nv-btn nv-btn--sm" onClick={() => openDialog(group)}>
                  Create / update channel
                </button>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--nv-border, #e5e5e5)' }}>
                  {groupProps.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--nv-text-muted)', margin: 0 }}>
                      No properties registered for this group yet.
                    </p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {groupProps.map(p => (
                        <li key={p.pid} style={{ marginBottom: 4 }}>
                          {p.property_name}
                          <span style={{ color: 'var(--nv-text-muted)', fontSize: 11 }}> · {p.pid}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {visibleGroups.length === 0 && (
          <p style={{ color: 'var(--nv-text-muted)', fontSize: 13 }}>No hotel groups match that filter.</p>
        )}
      </div>

      {target && (
        <div className="tc-overlay" onClick={() => !submitting && setTarget(null)}>
          <div className="tc-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
              {target.trading_name || target.group_name}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--nv-text-muted)', margin: '0 0 16px' }}>{target.hgid}</p>

            {result ? (
              <>
                <p style={{ fontSize: 14, margin: '0 0 12px' }}>
                  Channel {result.created ? 'created' : 'updated'} for <strong>{result.groupName}</strong>.
                </p>
                {result.channelWebUrl && (
                  <p style={{ margin: '0 0 12px' }}>
                    <a href={result.channelWebUrl} target="_blank" rel="noreferrer">Open the channel in Teams</a>
                  </p>
                )}
                {result.warnings?.length > 0 && (
                  <ul style={{ fontSize: 12, color: 'var(--nv-warning, #a60)', paddingLeft: 18 }}>
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                <div style={{ textAlign: 'right', marginTop: 16 }}>
                  <button className="nv-btn" onClick={() => setTarget(null)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <label className="tc-label">Channel name</label>
                <input className="nv-input" value={channelName}
                       onChange={e => setChannelName(e.target.value)} style={{ width: '100%' }} />

                <label className="tc-label">Description</label>
                <textarea className="nv-input" rows={4} value={description}
                          onChange={e => setDescription(e.target.value)} style={{ width: '100%' }} />

                <label className="tc-label">Owners</label>
                <p className="tc-hint">
                  Leave empty to use the standing owner roster. Chosen owners are added on top of it.
                </p>
                <div className="tc-people">
                  {staff.map(m => (
                    <label key={m.id} className="tc-person">
                      <input type="checkbox" checked={ownerIds.includes(m.id)}
                             onChange={() => toggle(ownerIds, setOwnerIds, m.id)} />
                      {m.name}
                    </label>
                  ))}
                </div>

                <label className="tc-label">Members</label>
                <div className="tc-people">
                  {staff.filter(m => !ownerIds.includes(m.id)).map(m => (
                    <label key={m.id} className="tc-person">
                      <input type="checkbox" checked={memberIds.includes(m.id)}
                             onChange={() => toggle(memberIds, setMemberIds, m.id)} />
                      {m.name}
                    </label>
                  ))}
                </div>

                {dialogError && (
                  <p style={{ color: 'var(--nv-danger, #b00)', fontSize: 13 }}>{dialogError}</p>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                  <button className="nv-btn nv-btn--ghost" disabled={submitting}
                          onClick={() => setTarget(null)}>Cancel</button>
                  <button className="nv-btn" disabled={submitting || !channelName.trim()} onClick={submit}>
                    {submitting ? 'Working…' : 'Create / update'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .tc-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.45);
          display: flex; align-items: center; justify-content: center; z-index: 100; padding: 24px;
        }
        .tc-modal {
          background: var(--nv-surface, #fff); border-radius: 10px; padding: 24px;
          width: 100%; max-width: 540px; max-height: 85vh; overflow-y: auto;
        }
        .tc-label {
          display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--nv-text-muted); margin: 16px 0 6px;
        }
        .tc-hint { font-size: 11px; color: var(--nv-text-muted); margin: 0 0 8px; }
        .tc-people {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 6px; max-height: 150px; overflow-y: auto;
          border: 1px solid var(--nv-border, #e5e5e5); border-radius: 6px; padding: 10px;
        }
        .tc-person { display: flex; align-items: center; gap: 6px; font-size: 13px; }
      `}</style>
    </div>
  )
}
