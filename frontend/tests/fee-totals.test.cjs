const fs = require('node:fs')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { feeKind, computeFeeTotals, deriveFeeSummary } = require('../lib/serviceCatalog.ts')
const { documentSourceKey } = require('../lib/documentModel.ts')

const row = (feeType, fee, extra = {}) => ({ id: Math.random().toString(36), component: 'x', feeType, fee, term: '', setupFee: '', ...extra })

test('free-text fee types are classified (2026-10-12 regression)', () => {
  for (const t of ['monthly', 'Monthly Retainer', 'Monthly Fee', 'monthly', 'Retainer', 'per month', '']) assert.equal(feeKind(t), 'monthly', t)
  for (const t of ['setup', 'Setup Fee', 'Set-up', 'Onboarding']) assert.equal(feeKind(t), 'setup', t)
  for (const t of ['fixed', 'Fixed Fee', 'One-off', 'One time payment']) assert.equal(feeKind(t), 'oneoff', t)
  assert.equal(feeKind('Fixed monthly fee'), 'monthly')
  for (const t of ['daily', 'Day Rate', 'hourly', 'Commission %', 'custom', 'Per booking']) assert.equal(feeKind(t), 'rate', t)
})

test('totals: monthly × per-row term, setup column, one-offs, rates excluded', () => {
  const t = computeFeeTotals([
    row('Monthly Fee', 2000, { term: 12, setupFee: 500 }),
    row('Retainer', 300, { term: 6 }),
    row('Fixed Fee', 1000),
    row('Day Rate', 900),
    row('Setup Fee', 250),
  ])
  assert.equal(t.monthly, 2300)
  assert.equal(t.setup, 750)
  assert.equal(t.oneOff, 1000)
  assert.equal(t.term, 12)
  assert.equal(t.contract, 2000 * 12 + 300 * 6 + 750 + 1000)
  assert.equal(t.rateRows, 1)
  assert.deepEqual(deriveFeeSummary([row('Monthly Fee', 1000, { term: 12 })]), { monthlyFee: 1000, setupFee: 0, term: 12 })
})

test('source key ignores save/reload normalisation but sees real changes', () => {
  const draft = {
    hotel: { name: 'Hotel A', hotelGroupName: 'G', contactName: 'C', contactTitle: '', contactEmail: 'a@b', contactPhone: '' },
    regionSettings: { address: 'x', companyName: 'Nuvho', aboutNuvho: 'a', footerText: 'f', currency: 'AUD' },
    sender: { staffId: 's1', message: '<p>Hi</p>' },
    services: [{ code: 'RM', scopeItems: [{ id: '1', sectionHeading: 'H', text: 'T', enabled: true }],
      feeRows: [{ id: 'f', component: 'Retainer', feeType: 'monthly', setupFee: undefined, fee: 1500, term: '' }],
      footnotes: [{ id: 'n', text: 'note' }] }],
    terms: { clauses: [{ id: 'c', heading: 'Pay', text: '30 days', enabled: true }], validityDays: 30, pageBreaks: {} },
  }
  const reloaded = JSON.parse(JSON.stringify(draft))
  reloaded.services[0].feeRows[0] = { id: 'f', component: 'Retainer', feeType: 'monthly', setupFee: '', fee: 1500, term: '', note: '' }
  reloaded.cover = { coverUrl: 'branded:2' }
  assert.equal(documentSourceKey(reloaded), documentSourceKey(draft))
  const changed = JSON.parse(JSON.stringify(draft)); changed.services[0].feeRows[0].fee = 1600
  assert.notEqual(documentSourceKey(changed), documentSourceKey(draft))
  const reordered = JSON.parse(JSON.stringify(draft)); reordered.terms.clauses[0].enabled = false
  assert.notEqual(documentSourceKey(reordered), documentSourceKey(draft))
})

test('Settings → Default fees mapping pre-fills Pricing; built-in rows are the fallback', () => {
  const { initFeeRows } = require('../lib/serviceCatalog.ts')
  const live = [
    { id: 'feecfg_a', name: 'Setup', component: 'Setup Fee', feeType: 'setup', setupFee: '', fee: 1500, term: '', active: true },
    { id: 'feecfg_b', name: 'RM', component: 'Monthly Management', feeType: 'monthly', setupFee: 250, fee: '', term: 12, active: true },
  ]
  const rows = initFeeRows('RM', live)
  assert.deepEqual(rows.map(r => [r.component, r.feeType, r.setupFee, r.fee, r.term]), [
    ['Setup Fee', 'setup', '', 1500, ''], ['Monthly Management', 'monthly', 250, '', 12],
  ])
  assert.notEqual(rows[0].id, rows[1].id)
  assert.ok(initFeeRows('RM', []).length > 0, 'falls back to the catalog when nothing is mapped')
})
