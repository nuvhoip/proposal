#!/usr/bin/env node
// Mirrors the self-hosted TinyMCE (GPL/open-source) build from
// node_modules/tinymce into public/tinymce, so the app never needs a
// TinyMCE Cloud account or API key (components/proposal/TinyMcePageEditor.tsx
// and RichTextEditor.tsx both load TinyMCE from /tinymce/tinymce.min.js).
// Runs automatically via package.json's "postinstall" script; safe to
// re-run any time — it always mirrors node_modules/tinymce exactly.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'node_modules', 'tinymce')
const dest = path.join(here, '..', 'public', 'tinymce')

if (!existsSync(src)) {
  console.warn('[copy-tinymce] node_modules/tinymce not found — skipping (did npm install run?)')
  process.exit(0)
}
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-tinymce] copied self-hosted TinyMCE to public/tinymce')
