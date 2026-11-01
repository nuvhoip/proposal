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

test('item-level acceptance: accepted rows, summary text, client checklist (2026-11)', () => {
  const { acceptedFeeRows, feeRowSummary, isAcceptableFeeRow, computeFeeTotals } = require('../lib/serviceCatalog.ts')
  const { buildClientServiceChoices } = require('../lib/documentModel.ts')
  const c50 = { id: 'a', component: '50 connects', feeType: 'monthly', setupFee: 500, fee: 2500, term: 6, acceptance: 'accepted' }
  const c90 = { id: 'b', component: '90 connects', feeType: 'monthly', setupFee: '', fee: 3500, term: 6, acceptance: 'declined' }
  const blank = { id: 'c', component: '', feeType: 'monthly', setupFee: '', fee: '', term: '' }
  assert.equal(isAcceptableFeeRow(blank), false)
  assert.deepEqual(acceptedFeeRows([c50, c90]).map(r => r.id), ['a'])
  // Only the accepted alternative counts: £2,500 × 6 + £500, not both options.
  assert.equal(computeFeeTotals(acceptedFeeRows([c50, c90])).contract, 2500 * 6 + 500)
  // Unsigned rows (no acceptance) all count; legacy signed rows follow the service.
  const legacy = [{ ...c50, acceptance: undefined }, { ...c90, acceptance: null }]
  assert.equal(acceptedFeeRows(legacy).length, 2)
  assert.equal(acceptedFeeRows(legacy, true).length, 0)
  assert.equal(feeRowSummary(c50, '£'), 'Setup £500 · £2,500/month · 6 months')
  assert.equal(feeRowSummary({ id: 'd', component: 'Audit', feeType: 'Fixed Fee', fee: 1200, term: '' }, '$'), '$1,200 one-off')

  const choices = buildClientServiceChoices([
    { code: 'SM', label: 'Sales Management', feeRows: [c50, c90, blank], acceptance: 'accepted' },
    { code: 'CA', label: 'Confidentiality Agreement', feeRows: [], acceptance: 'declined' },
  ], '£')
  assert.equal(choices[0].label, 'SM - Sales Management')
  assert.equal(choices[0].accepted, true)
  assert.deepEqual(choices[0].items.map(i => [i.label, i.accepted]), [['50 connects', true], ['90 connects', false]])
  assert.equal(choices[1].accepted, false)
  assert.deepEqual(choices[1].items, [])
})

test('worker fee summary matches the frontend deriveFeeSummary', () => {
  const { deriveFeeSummary } = require('../lib/serviceCatalog.ts')
  const { feeSummary } = require('../../worker/src/lib/feeTotals.ts')
  const rows = [
    { feeType: 'Monthly Fee', fee: 2000, term: 12, setupFee: 500 },
    { feeType: 'Retainer', fee: 300, term: 6 },
    { feeType: 'Fixed Fee', fee: 1000 },
    { feeType: 'Day Rate', fee: 900 },
    { feeType: 'Setup Fee', fee: 250 },
  ]
  assert.deepEqual(
    feeSummary(rows.map(r => ({ fee_type: r.feeType, fee: r.fee, term: r.term ?? null, setup_fee: r.setupFee ?? null }))),
    deriveFeeSummary(rows.map(r => ({ id: 'x', component: 'x', term: '', setupFee: '', ...r }))),
  )
})

test('entity-specific defaults: own fees, else all-entities; service lines per entity (NUVCL-159/160)', () => {
  const { defaultFeesForEntity, isServiceOfferedBy, initFeeRows } = require('../lib/serviceCatalog.ts')
  const fee = (id, entityCode, fee) => ({ id, name: id, component: id, feeType: 'monthly', setupFee: '', fee, term: 12, active: true, entityCode })
  const fees = [fee('au', '', 7499), fee('uk', 'NVH-UK-OPS', 4500)]
  assert.deepEqual(defaultFeesForEntity(fees, 'NVH-UK-OPS').map(f => f.id), ['uk'])
  assert.deepEqual(defaultFeesForEntity(fees, 'NVH-IE-OPS').map(f => f.id), ['au'])   // no IE fees → all-entities
  assert.deepEqual(defaultFeesForEntity(fees, '').map(f => f.id), ['au'])
  assert.deepEqual(defaultFeesForEntity([fee('legacy', undefined, 1)], 'NVH-UK-OPS').map(f => f.id), ['legacy'])
  assert.equal(initFeeRows('RM', fees, 'NVH-UK-OPS')[0].fee, 4500)
  assert.equal(initFeeRows('RM', fees)[0].fee, 7499)
  assert.equal(isServiceOfferedBy({ entityCodes: [] }, 'NVH-UK-OPS'), true)
  assert.equal(isServiceOfferedBy({}, 'NVH-UK-OPS'), true)
  assert.equal(isServiceOfferedBy({ entityCodes: ['NVH-AU-OPS'] }, 'NVH-UK-OPS'), false)
  assert.equal(isServiceOfferedBy({ entityCodes: ['NVH-AU-OPS'] }, 'NVH-AU-OPS'), true)
  assert.equal(isServiceOfferedBy({ entityCodes: ['NVH-AU-OPS'] }, ''), true)   // no entity chosen yet
})
