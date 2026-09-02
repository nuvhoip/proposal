// UNUSED as of 2026-09-01 (later revision) — no TypeScript/React code in
// this project imports the `pagedjs` npm package anymore. It's still listed
// in package.json (for version provenance/pinning) and its dist bundle is
// vendored at public/pagedjs/paged.js, but PaginatedPreview.tsx now loads
// that vendored file via a plain <script src> tag inside an isolated
// <iframe> instead of an `import('pagedjs')` — see that file's top comment
// for why (Paged.js's own Polisher writes to whatever `document` it
// executes in, with no way to scope it, which broke the whole app the
// first time this was wired up directly into the page).
//
// This file is safe to delete — the Cowork device bridge that made this
// change can't delete files on your mounted folder, so it's left as this
// note instead of a stray, misleading ambient module declaration.
export {}
