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
