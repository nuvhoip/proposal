// ─── Word (.docx) export ──────────────────────────────────────────────────────
// Builds a real .docx Blob straight from the same ProposalDocModel that
// <ProposalDocument> renders for the on-screen/print preview, using the pure-JS
// `docx` package (no server round-trip). Mirrors the same section order:
// cover, letter, Background, Scope of Works, Nuvho Pty Ltd, Fee Structure,
// Quote Approval (signature), Appendix — Terms & Conditions.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, ShadingType, ImageRun,
} from 'docx'
import { FEE_TYPES } from './serviceCatalog'
import type { ProposalDocModel } from './documentModel'

const BRAND_BLUE = '28687F'
const MUTED_GREY = 'E9EAEC'

function heading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } })
}
function subheading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })
}
function body(text: string) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 150 } })
}
function italic(text: string) {
  return new Paragraph({ children: [new TextRun({ text, italics: true })], spacing: { after: 150 } })
}
function bullet(text: string) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } })
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl)
  return new Uint8Array(await res.arrayBuffer())
}

export async function buildDocxFile(model: ProposalDocModel): Promise<Blob> {
  const multiSvc = model.services.length > 1
  const children: (Paragraph | Table)[] = []

  // Cover / title block
  children.push(new Paragraph({ text: model.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 100 } }))
  children.push(new Paragraph({ text: model.hotelName || '[Hotel Name]', alignment: AlignmentType.CENTER, spacing: { after: 40 } }))
  children.push(new Paragraph({ text: model.dateIssued, alignment: AlignmentType.CENTER, spacing: { after: 400 } }))

  // Letter
  children.push(new Paragraph({ text: `Date of Issue: ${model.dateIssued}`, spacing: { after: 200 } }))
  children.push(new Paragraph({ text: model.contactName || '[Client Name]' }))
  children.push(new Paragraph({ text: model.hotelName || '[Hotel Name]' }))
  children.push(new Paragraph({ text: model.propertyAddress || '[Property Address]', spacing: { after: 200 } }))
  children.push(new Paragraph({ children: [new TextRun({ text: `RE: ${model.title}`, bold: true })], spacing: { after: 200 } }))
  children.push(body(`Dear ${model.contactName || '[Client Name]'},`))
  children.push(body(model.introMessage))

  ;['Background', 'Scope of Works', 'Nuvho Pty Ltd', 'Fee Structure', 'Quote Approval', 'Appendix 1 – Terms & Conditions']
    .forEach(item => children.push(new Paragraph({ children: [new TextRun({ text: item, bold: true })], spacing: { after: 40 } })))

  children.push(body('If you require further information or wish to discuss this proposal, please don’t hesitate to contact me.'))
  children.push(body('Yours sincerely,'))
  children.push(new Paragraph({ children: [new TextRun({ text: model.senderName || '[Sender Name]', bold: true })] }))
  if (model.senderRoleLabel) children.push(new Paragraph({ text: model.senderRoleLabel }))
  if (model.senderEmail) children.push(new Paragraph({ text: `e: ${model.senderEmail}`, spacing: { after: 300 } }))

  // Background
  children.push(heading('Background'))
  children.push(body(
    `${model.hotelName || 'The property'} has engaged Nuvho to deliver ${model.title.toLowerCase()}, with a strong ` +
    `focus on maximising commercial performance and elevating the guest experience. This proposal outlines our ` +
    `recommended scope of works, fee structure and terms of engagement.`
  ))

  // Scope of Works
  children.push(heading('Scope of Works'))
  children.push(body('We develop a long-term and collaborative partnership with our clients, delivering services and value across the spectrum of hotel operations.'))
  model.services.forEach(s => {
    if (multiSvc) children.push(subheading(s.label))
    let lastSection: string | null = null
    s.scopeItems.filter(it => it.enabled).forEach(it => {
      if (it.sectionHeading !== lastSection) {
        lastSection = it.sectionHeading
        children.push(new Paragraph({ children: [new TextRun({ text: it.sectionHeading, bold: true })], spacing: { before: 150, after: 60 } }))
      }
      children.push(bullet(it.text || '—'))
    })
  })
  if (model.services.length === 0) children.push(italic('No services selected yet.'))

  // Nuvho Pty Ltd
  children.push(heading('Nuvho Pty Ltd'))
  children.push(body(
    'Nuvho is a new breed of hotel services company, providing tailored solutions to clients from a services, ' +
    'systems and operational perspective. We partner with independent and boutique hotels to deliver the ' +
    'commercial capability of a larger group, without the overhead.'
  ))

  // Fee Structure
  children.push(heading('Fee Structure'))
  children.push(body('The following table outlines the associated fee structure of our services. Our fees exclude GST, which will be charged in addition where applicable.'))

  if (model.services.length > 0) {
    const headerCell = (text: string) => new TableCell({
      shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR, color: 'auto' },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF' })] })],
    })
    const rows: TableRow[] = [
      new TableRow({ tableHeader: true, children: ['Component', 'Fee Type', 'Amount', 'Months', 'Note'].map(headerCell) }),
    ]
    model.services.forEach(s => {
      if (multiSvc) {
        rows.push(new TableRow({ children: [new TableCell({
          columnSpan: 5,
          shading: { fill: MUTED_GREY, type: ShadingType.CLEAR, color: 'auto' },
          children: [new Paragraph({ children: [new TextRun({ text: s.label, bold: true })] })],
        })] }))
      }
      s.feeRows.forEach(row => {
        const feeTypeLabel = FEE_TYPES.find(f => f.value === row.feeType)?.label || row.feeType
        rows.push(new TableRow({ children: [
          new TableCell({ children: [new Paragraph(row.component || '—')] }),
          new TableCell({ children: [new Paragraph(feeTypeLabel)] }),
          new TableCell({ children: [new Paragraph(row.fee === '' ? '—' : `$${Number(row.fee).toLocaleString()}`)] }),
          new TableCell({ children: [new Paragraph(row.term === '' ? '—' : String(row.term))] }),
          new TableCell({ children: [new Paragraph(row.note || '')] }),
        ] }))
      })
    })
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
    if (model.grandTotalMonthly > 0) {
      children.push(new Paragraph({
        alignment: AlignmentType.RIGHT, spacing: { before: 150, after: 100 },
        children: [new TextRun({ text: `Combined monthly total: $${model.grandTotalMonthly.toLocaleString()}`, bold: true })],
      }))
    }
    model.footnotes.forEach(f => children.push(bullet(f.text)))
  } else {
    children.push(italic('No pricing configured yet.'))
  }

  // Quote Approval
  children.push(heading('Quote Approval'))
  children.push(body(`Should the terms of this proposal be acceptable, please sign below and return the applicable service agreement. This proposal remains valid for ${model.validityDays} days from the date of issue.`))

  if (!model.signatureRequired) {
    children.push(italic('No signature block requested for this proposal.'))
  } else if (model.signatureMethod === 'draw' && model.signatureDataUrl) {
    try {
      const bytes = await dataUrlToBytes(model.signatureDataUrl)
      children.push(new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width: 200, height: 70 }, type: 'png' })] }))
    } catch {
      children.push(italic('[Signature image could not be embedded]'))
    }
  } else if (model.signatoryName) {
    children.push(new Paragraph({ children: [new TextRun({ text: model.signatoryName, italics: true, size: 48 })] }))
  } else {
    children.push(italic('Signature not yet captured'))
  }
  children.push(new Paragraph({ text: `On behalf of ${model.hotelName || '[Hotel Name]'}`, spacing: { before: 100 } }))
  children.push(new Paragraph({ text: `${model.signatoryName}${model.signatoryTitle ? ', ' + model.signatoryTitle : ''}` }))

  // Appendix — Terms & Conditions
  children.push(heading('Appendix 1 – Terms & Conditions'))
  if (model.clauses.length === 0) {
    children.push(italic('No clauses selected.'))
  }
  model.clauses.forEach(c => {
    children.push(subheading(c.heading))
    children.push(body(c.text))
  })

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}
