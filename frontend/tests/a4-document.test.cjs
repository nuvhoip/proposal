const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
// Exercise the pure layout/data contract without starting a browser or worker.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { readA4Document } = require('../lib/a4Document.ts')
const { buildDocModelFromProposal } = require('../lib/documentModel.ts')
const snapshot = { version: 1, pages: [
  { id: 'cover', kind: 'cover', html: '<h1>Edited cover</h1>' },
  { id: 'page-two', kind: 'body', html: '<p><strong>Edited paragraph</strong></p>' },
  { id: 'blank', kind: 'body', html: '<p><br></p>' },
] }

test('page HTML, ordering, formatting and blank pages survive the existing worker JSON contract', () => {
  const wire = JSON.stringify({ terms: { pageBreaks: { scope: true, _document: snapshot } } })
  const response = JSON.parse(wire)
  const model = buildDocModelFromProposal(response)
  assert.deepEqual(readA4Document(model.pageBreaks), snapshot)
  assert.equal(model.pageBreaks.scope, true)
})

test('legacy proposals continue using the template', () => {
  assert.equal(readA4Document({ scope: true }), null)
  assert.equal(readA4Document(buildDocModelFromProposal({}).pageBreaks), null)
})

test('malformed page snapshots are rejected', () => {
  for (const value of [null, {}, {version:2,pages:snapshot.pages}, {version:1,pages:[]},
    {version:1,pages:[snapshot.pages[0],snapshot.pages[0]]},
    {version:1,pages:[{id:'',kind:'body',html:''}]},
    {version:1,pages:[{id:'x',kind:'script',html:''}]},
    {version:1,pages:[{id:'x',kind:'body',html:123}]},
    {version:1,pages:[{id:'x',kind:'body',html:'',breakBefore:'yes'}]}]) {
    assert.equal(readA4Document({_document:value}), null)
  }
})

test('a manually-started page (breakBefore) survives the worker JSON round-trip', () => {
  const withBreak = { version: 1, pages: [
    { id: 'a', kind: 'body', html: '<p>Before the break</p>' },
    { id: 'b', kind: 'body', html: '<p>Deliberately starts a fresh page</p>', breakBefore: true },
  ] }
  const wire = JSON.stringify({ terms: { pageBreaks: { _document: withBreak } } })
  const model = buildDocModelFromProposal(JSON.parse(wire))
  assert.deepEqual(readA4Document(model.pageBreaks), withBreak)
  assert.equal(readA4Document(model.pageBreaks).pages[1].breakBefore, true)
  // Older saved proposals never wrote breakBefore at all — must still read fine.
  assert.equal(readA4Document({ _document: { version: 1, pages: [{ id: 'x', kind: 'body', html: '' }] } }).pages[0].breakBefore, undefined)
})

test('the editor no longer depends on Paged.js or iframe pagination', () => {
  const source = fs.readFileSync(path.join(__dirname,'../components/proposal/A4DocumentEditor.tsx'),'utf8')
  assert(!/pagedjs|srcdoc|<iframe/i.test(source))
  assert(!require('../package.json').dependencies.pagedjs)
})

// NUVCL-151/153/154 — pure helpers (DOM-dependent sanitizer checks run in a real browser; see the ticket notes).
const { pageHeaderVars } = require('../lib/a4Document.ts')
const { deriveFeeSummary } = require('../lib/serviceCatalog.ts')

test('running header shows the client name and issue month as CSS strings', () => {
  const vars = pageHeaderVars('The "Grand" Hotel', '29 September 2026')
  assert.equal(vars['--a4-header-client'], '"The \\"Grand\\" Hotel"')
  assert.equal(vars['--a4-header-month'], '"September 2026"')
})

test('setup fees count both legacy Setup-type rows and the new Setup fee column', () => {
  const summary = deriveFeeSummary([
    { id: 'a', component: 'Setup', feeType: 'setup', fee: 1500, term: '' },
    { id: 'b', component: 'Monthly', feeType: 'monthly', setupFee: 500, fee: 7499, term: 12 },
  ])
  assert.equal(summary.setupFee, 2000)
  assert.equal(summary.monthlyFee, 7499)
  assert.equal(summary.term, 12)
})

test('signed proposals expose which services the client accepted', () => {
  const model = buildDocModelFromProposal({ services: [
    { code: 'RM', acceptance: 'accepted' }, { code: 'MK', acceptance: 'declined' }, { code: 'SM', acceptance: 'accepted' },
  ] })
  assert.equal(model.clientAcceptedServices.length, 2)
  assert.equal(model.clientDeclinedServices.length, 1)
  assert.deepEqual(buildDocModelFromProposal({ services: [{ code: 'RM' }] }).clientDeclinedServices, [])
})
