'use client'

import { Editor } from '@tinymce/tinymce-react'

interface RichTextEditorProps {
  value:        string
  onChange:     (html: string) => void
  placeholder?: string
  height?:      number
}

/**
 * Thin wrapper around TinyMCE's React <Editor>, used by the proposal
 * wizard's Signature step (Step 8) to author the optional client-facing
 * custom message that renders above the Quote Approval signature block
 * (see lib/documentModel.ts's `signatureMessage` / ProposalDocument.tsx).
 *
 * Self-hosted via public/tinymce (see scripts/copy-tinymce.mjs, which
 * mirrors node_modules/tinymce there on `npm install`) — same setup as
 * the per-page editors in TinyMcePageEditor.tsx. No TinyMCE Cloud account,
 * no API key, no "This domain is not registered" notice.
 */
export function RichTextEditor({ value, onChange, placeholder, height = 220 }: RichTextEditorProps) {
  return (
    <Editor
      tinymceScriptSrc="/tinymce/tinymce.min.js"
      licenseKey="gpl"
      value={value}
      onEditorChange={onChange}
      init={{
        height,
        menubar: false,
        statusbar: false,
        plugins: 'lists link autolink',
        toolbar: 'bold italic underline | bullist numlist | link | removeformat',
        placeholder,
        content_style: `
          body {
            font-family: 'Raleway', Arial, sans-serif;
            font-size: 14px;
            color: #1f2b2c;
          }
        `,
      }}
    />
  )
}
