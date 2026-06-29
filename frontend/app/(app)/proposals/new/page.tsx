'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProposalDraft, ServiceCode, Region } from '@/lib/types'

const STEPS = [
  { id: 1, label: 'Hotel Details'  },
  { id: 2, label: 'Services'       },
  { id: 3, label: 'Sender'         },
  { id: 4, label: 'Cover Image'    },
  { id: 5, label: 'Preview & Send' },
]

const EMPTY_DRAFT: ProposalDraft = {
  step: 1,
  hotel: {
    name: '', region: 'au', contactName: '', contactEmail: '',
    contactPhone: '', contactTitle: '', propertyAddress: '',
    hubspotDealId: '',
  },
  services:     [],
  sender:       { staffId: '', message: '' },
  cover:        { coverUrl: '' },
  preview:      { recipientEmail: '' },
}

export default function NewProposalPage() {
  const router = useRouter()
  const [draft, setDraft]       = useState<ProposalDraft>(EMPTY_DRAFT)
  const [saving, setSaving]     = useState(false)
  const [errors, setErrors]     = useState<Record<string, string>>({})

  const step = draft.step

  function goNext() {
    const errs = validateStep(draft)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setDraft(d => ({ ...d, step: Math.min(5, d.step + 1) }))
  }
  function goBack() {
    setErrors({})
    setDraft(d => ({ ...d, step: Math.max(1, d.step - 1) }))
  }

  async function handleSubmit() {
    setSaving(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create proposal')
      router.push(`/proposals/${data.data.id}`)
    } catch (err: any) {
      setErrors({ submit: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wizard-page">
      {/* Step indicator */}
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            <button
              className={`nv-step ${step === s.id ? 'nv-step--active' : ''} ${step > s.id ? 'nv-step--done' : ''}`}
              onClick={() => step > s.id && setDraft(d => ({ ...d, step: s.id }))}
              disabled={step < s.id}
            >
              <span className="nv-step__number">
                {step > s.id
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  : s.id}
              </span>
              <span className="nv-step__label">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <div className="wizard-steps__divider" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="wizard-body">
        <div className="nv-card wizard-card animate-fade-in-up">
          {step === 1 && (
            <Step1HotelDetails draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 2 && (
            <Step2Services draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 3 && (
            <Step3Sender draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 4 && (
            <Step4Cover draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 5 && (
            <Step5Preview draft={draft} setDraft={setDraft} errors={errors} />
          )}

          {errors.submit && (
            <div className="wizard-error">{errors.submit}</div>
          )}

          {/* Navigation */}
          <div className="wizard-nav">
            {step > 1
              ? <button className="nv-btn nv-btn--outlined nv-btn--md" onClick={goBack}>
                  ← Back
                </button>
              : <div />}
            {step < 5
              ? <button className="nv-btn nv-btn--solid nv-btn--md" onClick={goNext}>
                  Continue →
                </button>
              : <button
                  className="nv-btn nv-btn--solid nv-btn--md"
                  onClick={handleSubmit}
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? 'Generating…' : 'Generate & Send Proposal'}
                </button>}
          </div>
        </div>
      </div>

      <style jsx>{`
        .wizard-page { padding: 32px 40px; max-width: 900px; }
        @media (max-width: 768px) { .wizard-page { padding: 16px; } }

        .wizard-steps {
          display: flex;
          align-items: center;
          gap: 0;
          margin-bottom: 32px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .wizard-steps__divider {
          flex: 1;
          height: 1px;
          background: var(--nv-border);
          min-width: 24px;
          max-width: 60px;
        }

        .wizard-body { }

        .wizard-card { padding: 36px; }

        .wizard-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid var(--nv-border-hair);
        }

        .wizard-error {
          background: rgba(152,38,73,0.07);
          border: 1px solid rgba(152,38,73,0.2);
          border-radius: 10px;
          color: var(--nv-error);
          padding: 12px 16px;
          font-size: 13px;
          margin-top: 16px;
        }
      `}</style>
    </div>
  )
}

/* ─── Step 1: Hotel Details ─── */
function Step1HotelDetails({ draft, setDraft, errors }: StepProps) {
  const h = draft.hotel
  function update(key: string, val: string) {
    setDraft(d => ({ ...d, hotel: { ...d.hotel, [key]: val } }))
  }
  return (
    <div className="step-content">
      <h2 className="step-title">Hotel Details</h2>
      <p className="step-desc">Enter the hotel and primary contact information.</p>

      <div className="form-grid">
        <FormField label="Hotel name *" error={errors.hotelName}>
          <input className="nv-input" placeholder="e.g. The Langham Sydney"
            value={h.name} onChange={e => update('name', e.target.value)} />
        </FormField>

        <FormField label="Region *" error={errors.region}>
          <select className="nv-input" value={h.region}
            onChange={e => update('region', e.target.value as Region)}>
            <option value="au">Australia</option>
            <option value="uk">United Kingdom</option>
            <option value="ie">Ireland</option>
          </select>
        </FormField>

        <FormField label="Contact name *" error={errors.contactName}>
          <input className="nv-input" placeholder="e.g. Sarah Mitchell"
            value={h.contactName} onChange={e => update('contactName', e.target.value)} />
        </FormField>

        <FormField label="Contact title" error={errors.contactTitle}>
          <input className="nv-input" placeholder="e.g. Director of Sales"
            value={h.contactTitle} onChange={e => update('contactTitle', e.target.value)} />
        </FormField>

        <FormField label="Contact email *" error={errors.contactEmail}>
          <input className="nv-input" type="email" placeholder="name@hotel.com"
            value={h.contactEmail} onChange={e => update('contactEmail', e.target.value)} />
        </FormField>

        <FormField label="Contact phone" error={errors.contactPhone}>
          <input className="nv-input" type="tel" placeholder="+61 2 9876 5432"
            value={h.contactPhone} onChange={e => update('contactPhone', e.target.value)} />
        </FormField>

        <FormField label="Property address" error={errors.propertyAddress} span={2}>
          <input className="nv-input" placeholder="1 Kent St, Sydney NSW 2000"
            value={h.propertyAddress} onChange={e => update('propertyAddress', e.target.value)} />
        </FormField>

        <FormField label="HubSpot Deal ID" error={errors.hubspotDealId}>
          <input className="nv-input" placeholder="(optional)"
            value={h.hubspotDealId} onChange={e => update('hubspotDealId', e.target.value)} />
        </FormField>
      </div>
    </div>
  )
}

/* ─── Step 2: Services ─── */
const SERVICE_DEFS = [
  { code: 'RM' as ServiceCode, name: 'Revenue Management',  desc: 'Full RM strategy, pricing, OTA management' },
  { code: 'SM' as ServiceCode, name: 'Sales Management',    desc: 'Corporate sales, MICE, pro-active outreach' },
  { code: 'MK' as ServiceCode, name: 'Marketing',           desc: 'Digital marketing, content, campaigns' },
  { code: 'CR' as ServiceCode, name: 'Concierge Revenue',   desc: 'Upselling, packages, ancillary revenue' },
]

function Step2Services({ draft, setDraft, errors }: StepProps) {
  function toggle(code: ServiceCode) {
    setDraft(d => ({
      ...d,
      services: d.services.some(s => s.code === code)
        ? d.services.filter(s => s.code !== code)
        : [...d.services, { code, monthlyFee: 0, setupFee: 0, term: 12 }],
    }))
  }

  function updateFee(code: ServiceCode, field: 'monthlyFee' | 'setupFee' | 'term', val: number) {
    setDraft(d => ({
      ...d,
      services: d.services.map(s => s.code === code ? { ...s, [field]: val } : s),
    }))
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Services</h2>
      <p className="step-desc">Select the services to include in this proposal and set pricing.</p>

      {errors.services && <div style={{color:'var(--nv-error)',fontSize:13,marginBottom:12}}>{errors.services}</div>}

      <div className="services-grid">
        {SERVICE_DEFS.map(svc => {
          const selected = draft.services.find(s => s.code === svc.code)
          return (
            <div key={svc.code}
              className={`service-card ${selected ? 'service-card--selected' : ''}`}
              onClick={() => toggle(svc.code)}
            >
              <div className="service-card__header">
                <span className="service-card__badge">{svc.code}</span>
                <input type="checkbox" checked={!!selected} readOnly
                  className="service-card__check" onClick={e => e.stopPropagation()} />
              </div>
              <div className="service-card__name">{svc.name}</div>
              <div className="service-card__desc">{svc.desc}</div>

              {selected && (
                <div className="service-card__pricing" onClick={e => e.stopPropagation()}>
                  <label>
                    Monthly fee (AUD)
                    <input className="nv-input nv-input--sm" type="number" min={0}
                      value={selected.monthlyFee}
                      onChange={e => updateFee(svc.code, 'monthlyFee', +e.target.value)} />
                  </label>
                  <label>
                    Setup fee
                    <input className="nv-input nv-input--sm" type="number" min={0}
                      value={selected.setupFee}
                      onChange={e => updateFee(svc.code, 'setupFee', +e.target.value)} />
                  </label>
                  <label>
                    Term (months)
                    <select className="nv-input nv-input--sm" value={selected.term}
                      onChange={e => updateFee(svc.code, 'term', +e.target.value)}>
                      {[3,6,12,24].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .services-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 8px;
        }
        @media (max-width: 600px) { .services-grid { grid-template-columns: 1fr; } }

        .service-card {
          border: 1.5px solid var(--nv-border);
          border-radius: var(--nv-radius-md);
          padding: 16px;
          cursor: pointer;
          transition: border-color var(--nv-dur), background var(--nv-dur);
        }
        .service-card:hover { border-color: var(--nv-steel-blue); }
        .service-card--selected {
          border-color: var(--nv-blue-slate);
          background: rgba(40,104,127,0.04);
        }

        .service-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .service-card__badge {
          background: var(--nv-blue-slate);
          color: white;
          border-radius: 6px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        .service-card__check {
          width: 16px;
          height: 16px;
          accent-color: var(--nv-blue-slate);
        }
        .service-card__name {
          font-weight: 600;
          color: var(--nv-text-heading);
          font-size: 15px;
          margin-bottom: 4px;
        }
        .service-card__desc {
          font-size: 12px;
          color: var(--nv-text-muted);
          line-height: 1.5;
        }
        .service-card__pricing {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--nv-border-hair);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .service-card__pricing label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--nv-text-muted);
          font-weight: 500;
        }
        .nv-input--sm { padding: 6px 10px; font-size: 13px; }
      `}</style>
    </div>
  )
}

/* ─── Step 3: Sender ─── */
function Step3Sender({ draft, setDraft, errors }: StepProps) {
  const MOCK_STAFF = [
    { id: 's1', name: 'Jude Bolger',   role: 'Director' },
    { id: 's2', name: 'Emma Clarke',   role: 'BD Manager' },
    { id: 's3', name: 'Ryan Nguyen',   role: 'Revenue Manager' },
  ]
  return (
    <div className="step-content">
      <h2 className="step-title">Sender</h2>
      <p className="step-desc">Choose who this proposal is sent from and add a personal message.</p>

      <div className="form-grid">
        <FormField label="Sending on behalf of *" error={errors.staffId} span={2}>
          <select className="nv-input"
            value={draft.sender.staffId}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, staffId: e.target.value } }))}>
            <option value="">Select team member…</option>
            {MOCK_STAFF.map(s => (
              <option key={s.id} value={s.id}>{s.name} — {s.role}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Personal message (appears in email & proposal intro)" span={2}>
          <textarea className="nv-input" rows={4}
            placeholder="e.g. Hi Sarah, it was great speaking with you today…"
            value={draft.sender.message}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, message: e.target.value } }))} />
        </FormField>
      </div>
    </div>
  )
}

/* ─── Step 4: Cover Image ─── */
function Step4Cover({ draft, setDraft, errors }: StepProps) {
  const COVER_OPTIONS = [
    { url: '/covers/luxury-hotel-lobby.jpg',     label: 'Luxury Lobby'    },
    { url: '/covers/modern-hotel-exterior.jpg',  label: 'Modern Exterior' },
    { url: '/covers/pool-terrace.jpg',           label: 'Pool Terrace'    },
    { url: '/covers/conference-room.jpg',        label: 'Conference'      },
  ]
  return (
    <div className="step-content">
      <h2 className="step-title">Cover Image</h2>
      <p className="step-desc">
        Choose a cover photo for the proposal — or leave as default.
        You can also upload a custom image specific to this property.
      </p>

      <div className="cover-grid">
        {COVER_OPTIONS.map(opt => (
          <button
            key={opt.url}
            className={`cover-option ${draft.cover.coverUrl === opt.url ? 'cover-option--selected' : ''}`}
            onClick={() => setDraft(d => ({ ...d, cover: { ...d.cover, coverUrl: opt.url } }))}
          >
            <div className="cover-option__img" style={{ background: 'var(--nv-platinum)' }}>
              <span style={{ fontSize: 28 }}>🏨</span>
            </div>
            <span className="cover-option__label">{opt.label}</span>
          </button>
        ))}
      </div>

      <label className="cover-upload">
        <input type="file" accept="image/*" hidden
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              const url = URL.createObjectURL(file)
              setDraft(d => ({ ...d, cover: { ...d.cover, coverUrl: url, uploadFile: file } }))
            }
          }} />
        <span className="nv-btn nv-btn--outlined nv-btn--sm">↑ Upload custom image</span>
      </label>

      <style jsx>{`
        .cover-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin: 16px 0;
        }
        @media (max-width: 600px) { .cover-grid { grid-template-columns: repeat(2, 1fr); } }

        .cover-option {
          border: 2px solid var(--nv-border);
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          background: none;
          padding: 0;
          transition: border-color var(--nv-dur);
          display: flex;
          flex-direction: column;
        }
        .cover-option:hover { border-color: var(--nv-steel-blue); }
        .cover-option--selected { border-color: var(--nv-blue-slate); }

        .cover-option__img {
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cover-option__label {
          padding: 8px;
          font-size: 12px;
          color: var(--nv-text-muted);
          text-align: center;
        }

        .cover-upload { display: block; }
      `}</style>
    </div>
  )
}

/* ─── Step 5: Preview & Send ─── */
function Step5Preview({ draft, setDraft, errors }: StepProps) {
  const total = draft.services.reduce((acc, s) => acc + s.monthlyFee * s.term + s.setupFee, 0)
  return (
    <div className="step-content">
      <h2 className="step-title">Preview & Send</h2>
      <p className="step-desc">Review proposal details and confirm before generating the PDF and sending.</p>

      <div className="preview-summary">
        <SummaryRow label="Hotel"    value={draft.hotel.name || '—'} />
        <SummaryRow label="Contact"  value={`${draft.hotel.contactName} — ${draft.hotel.contactEmail}`} />
        <SummaryRow label="Services" value={draft.services.map(s => s.code).join(', ') || '—'} />
        <SummaryRow label="Total value" value={`$${total.toLocaleString('en-AU')}`} bold />
        <SummaryRow label="Sending as" value={draft.sender.staffId || '—'} />
      </div>

      <FormField label="Send proposal to (confirm email) *" error={errors.recipientEmail}>
        <input className="nv-input" type="email"
          value={draft.preview.recipientEmail || draft.hotel.contactEmail}
          onChange={e => setDraft(d => ({ ...d, preview: { ...d.preview, recipientEmail: e.target.value } }))} />
      </FormField>

      <div className="preview-note">
        Clicking <strong>Generate &amp; Send</strong> will:
        create the proposal PDF · upload to R2 · send the email · trigger HubSpot / Asana automations.
      </div>

      <style jsx>{`
        .preview-summary {
          border: 1px solid var(--nv-border-hair);
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 24px;
        }
        .preview-note {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(40,104,127,0.05);
          border-radius: 10px;
          font-size: 13px;
          color: var(--nv-text-muted);
          line-height: 1.6;
        }
      `}</style>
    </div>
  )
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      padding: '10px 16px',
      borderBottom: '1px solid var(--nv-border-hair)',
      fontSize: 13,
    }}>
      <span style={{ width: 140, color: 'var(--nv-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--nv-text-body)', fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  )
}

/* ─── Shared form helpers ─── */
interface StepProps {
  draft: ProposalDraft
  setDraft: React.Dispatch<React.SetStateAction<ProposalDraft>>
  errors: Record<string, string>
}

function FormField({ label, error, children, span }: {
  label: string; error?: string; children: React.ReactNode; span?: number
}) {
  return (
    <div className="form-field" style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label className="form-field__label">{label}</label>
      {children}
      {error && <span className="form-field__error">{error}</span>}
      <style jsx>{`
        .form-field { display: flex; flex-direction: column; gap: 6px; }
        .form-field__label { font-size: 13px; font-weight: 600; color: var(--nv-text-body); }
        .form-field__error { font-size: 12px; color: var(--nv-error); }
      `}</style>
    </div>
  )
}

/* Common styles for step content */
const stepStyles = `
  .step-content { display: flex; flex-direction: column; gap: 20px; }
  .step-title {
    font-family: var(--font-comfortaa);
    font-size: 22px;
    font-weight: 700;
    color: var(--nv-text-heading);
    margin-bottom: 2px;
  }
  .step-desc { font-size: 14px; color: var(--nv-text-muted); line-height: 1.55; }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
`

/* Inject step styles once */
if (typeof document !== 'undefined') {
  if (!document.getElementById('wizard-step-styles')) {
    const s = document.createElement('style')
    s.id = 'wizard-step-styles'
    s.textContent = stepStyles
    document.head.appendChild(s)
  }
}

/* ─── Validation ─── */
function validateStep(draft: ProposalDraft): Record<string, string> {
  const errs: Record<string, string> = {}
  if (draft.step === 1) {
    if (!draft.hotel.name)          errs.hotelName    = 'Hotel name is required'
    if (!draft.hotel.contactName)   errs.contactName  = 'Contact name is required'
    if (!draft.hotel.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.hotel.contactEmail))
      errs.contactEmail = 'Valid email required'
  }
  if (draft.step === 2 && draft.services.length === 0) {
    errs.services = 'Please select at least one service'
  }
  if (draft.step === 3 && !draft.sender.staffId) {
    errs.staffId = 'Please select a sender'
  }
  return errs
}
