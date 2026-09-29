'use client'

import React from 'react'
import { useSession } from '@/components/auth/AuthGuard'

interface M365Staff {
  id:       string
  name:     string
  email:    string
  role:     string
  role_type: string
  m365_upn?: string
}

const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024 // 3MB — mirrors worker/src/routes/feedback.ts

export default function FeedbackPage() {
  const session = useSession()

  const [staff, setStaff]               = React.useState<M365Staff[]>([])
  const [staffLoading, setStaffLoading] = React.useState(true)
  const [staffError, setStaffError]     = React.useState<string | null>(null)

  const [staffId, setStaffId] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [files, setFiles]     = React.useState<File[]>([])
  const [fileError, setFileError] = React.useState<string | null>(null)

  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState(false)

  // Same GET /staff → M365Staff[] pattern the proposal wizard's "Sending on
  // behalf of" dropdown uses (see Step5Sender in proposals/new/page.tsx),
  // reused here per the explicit instruction to "use the same list sender
  // that we already have."
  React.useEffect(() => {
    let cancelled = false
    async function loadStaff() {
      setStaffLoading(true)
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load Microsoft 365 users')
        if (!cancelled) setStaff(data.data || [])
      } catch (e: any) {
        if (!cancelled) setStaffError(e.message || 'Failed to load Microsoft 365 users')
      } finally {
        if (!cancelled) setStaffLoading(false)
      }
    }
    loadStaff()
    return () => { cancelled = true }
  }, [])

  // Default the sender to the signed-in user, same as the wizard's Sender
  // step default (only once, only if not already chosen).
  React.useEffect(() => {
    if (!session?.staffId) return
    setStaffId(id => id || session.staffId!)
  }, [session])

  function handleFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files || [])
    e.target.value = ''
    if (!chosen.length) return

    setFileError(null)
    const next = [...files]
    for (const f of chosen) {
      if (next.length >= MAX_ATTACHMENTS) {
        setFileError(`Maximum ${MAX_ATTACHMENTS} attachments`)
        break
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setFileError(`"${f.name}" is too large — ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit per file`)
        continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  function removeFile(idx: number) {
    setFiles(f => f.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!staffId) { setSubmitError('Please select who this feedback is from'); return }
    if (!message.trim()) { setSubmitError('Please describe the issue or feedback'); return }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const form = new FormData()
      form.set('staffId', staffId)
      form.set('subject', subject.trim())
      form.set('message', message.trim())
      for (const f of files) form.append('attachments', f)

      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/feedback`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send feedback')

      setSent(true)
      setSubject('')
      setMessage('')
      setFiles([])
    } catch (e: any) {
      setSubmitError(e.message || 'Failed to send feedback')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="nv-page step-content feedback-page">
      <h1 className="nv-page-title">Feedback &amp; report an issue</h1>
      <p className="nv-page-subtitle step-desc">
        Spotted a bug or have a suggestion about the Proposal System? Let us know below —
        this goes straight to the dev team.
      </p>

      {sent ? (
        <div className="feedback-success">
          <p>Thanks — your feedback has been sent.</p>
          <button
            type="button"
            className="nv-btn nv-btn--outlined nv-btn--md"
            onClick={() => setSent(false)}
          >
            Send another
          </button>
        </div>
      ) : (
        <form className="feedback-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="nv-field">
              <span className="nv-field__label">Sending on behalf of *</span>
              <select
                className="nv-input"
                value={staffId}
                onChange={e => setStaffId(e.target.value)}
                disabled={staffLoading}
                required
              >
                <option value="">{staffLoading ? 'Loading…' : 'Select…'}</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.role_type}{s.m365_upn ? ` (${s.m365_upn})` : ''}
                  </option>
                ))}
              </select>
              {staffError && <span className="nv-field__error">{staffError}</span>}
            </label>

            <label className="nv-field">
              <span className="nv-field__label">Subject</span>
              <input
                className="nv-input"
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Optional short summary"
                maxLength={150}
              />
            </label>
          </div>

          <label className="nv-field">
            <span className="nv-field__label">Message *</span>
            <textarea
              className="nv-input feedback-textarea"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe the issue or feedback in as much detail as you can…"
              rows={8}
              required
            />
          </label>

          <label className="nv-field">
            <span className="nv-field__label">Attachments (optional)</span>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.log"
              onChange={handleFilesChosen}
              disabled={files.length >= MAX_ATTACHMENTS}
            />
            <span className="nv-field__hint">
              Up to {MAX_ATTACHMENTS} files, {MAX_ATTACHMENT_BYTES / 1024 / 1024}MB each — screenshots help a lot.
            </span>
            {fileError && <span className="nv-field__error">{fileError}</span>}
          </label>

          {files.length > 0 && (
            <ul className="attachment-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="attachment-list__item">
                  <span>{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/xmark.svg" width={14} height={14} alt="" className="nv-icon-inline" /></button>
                </li>
              ))}
            </ul>
          )}

          {submitError && <p className="feedback-form__error">{submitError}</p>}

          <div className="feedback-form__actions">
            <button
              type="submit"
              className="nv-btn nv-btn--solid nv-btn--md"
              disabled={submitting}
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </form>
      )}

      <style jsx>{`
        /* Shell = global .nv-page (56/64/80); a form page reads best narrower */
        .feedback-page { max-width: 720px; }
        /* Mirrors the wizard's runtime-injected stepStyles (.step-content /
           .step-title / .step-desc in proposals/new/page.tsx) so this
           standalone page's heading matches the rest of the app — this
           page isn't part of the wizard, so it doesn't get that
           document.head injection for free. */
        .step-content { display: flex; flex-direction: column; gap: 20px; }
        .step-desc { margin-top: -12px; }
        .feedback-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
          margin-top: 24px;
        }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        /* .nv-field / __label / __hint / __error come from the global Figma field styles */
        .feedback-textarea {
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
        }
        .attachment-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .attachment-list__item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: var(--nv-surface-page);
          border-radius: 6px;
          font-size: 13px;
        }
        .attachment-list__item button {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          color: var(--nv-text-muted);
        }
        .feedback-form__error {
          font-size: 13px;
          color: var(--nv-error);
          margin: 0;
        }
        .feedback-form__actions {
          display: flex;
          justify-content: flex-end;
        }
        .feedback-success {
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          align-items: flex-start;
        }
        @media (max-width: 900px) {
          .form-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
