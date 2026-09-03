import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { parseCardBytes, parseCardJson, validateCardV3 } from '../src/card-v3.js'
import { extractCcv3Json } from '../src/png.js'
import { minimalCard, pngCard } from './helpers.js'

function withoutChunk(bytes, wanted) {
  let offset = 8
  const parts = [bytes.subarray(0, 8)]
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type !== wanted) parts.push(bytes.subarray(offset, end))
    offset = end
  }
  return Buffer.concat(parts)
}

test('accepts a minimal V3 JSON card and preserves unknown extensions', () => {
  const source = minimalCard({ assets: undefined, unknown_vendor_field: { nested: ['x'] } })
  const parsed = parseCardJson(JSON.stringify(source))
  assert.equal(parsed.card.spec, 'chara_card_v3')
  assert.deepEqual(parsed.card.data.extensions, { vendor: { keep: true } })
  assert.deepEqual(parsed.card.data.unknown_vendor_field, { nested: ['x'] })
})

test('normalizes omitted ecosystem V3 defaults with warnings', () => {
  const source = minimalCard({ character_book: {
    entries: [{ keys: ['archive'], content: 'Lore.', enabled: true, insertion_order: 1, extensions: {} }],
  } })
  delete source.data.group_only_greetings
  const parsed = parseCardJson(JSON.stringify(source))
  assert.deepEqual(parsed.card.data.group_only_greetings, [])
  assert.deepEqual(parsed.card.data.character_book.extensions, {})
  assert.match(parsed.warnings.join('\n'), /group_only_greetings was missing/)
  assert.match(parsed.warnings.join('\n'), /character_book\.extensions was missing/)
  assert.equal(source.data.group_only_greetings, undefined, 'validation must not mutate caller-owned card data')
})

test('rejects V2-only cards', () => {
  assert.throws(() => parseCardJson(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: {} })), /chara_card_v3/)
})

test('reads canonical ccv3 PNG payload and warns on duplicate in compat mode', () => {
  const card = minimalCard()
  const bytes = pngCard(card, { secondCard: minimalCard({ name: 'Other' }) })
  const parsed = parseCardBytes(bytes, { strict: false })
  assert.equal(parsed.format, 'png-v3')
  assert.equal(parsed.card.data.name, 'Alice')
  assert.match(parsed.warnings.join('\n'), /multiple ccv3/)
  assert.throws(() => parseCardBytes(bytes), /multiple ccv3/)
  assert.throws(() => extractCcv3Json(bytes, { strict: true }), /multiple ccv3/)
})

test('rejects malformed PNG structure, invalid chunk bytes, and bad CRC', () => {
  const valid = pngCard(minimalCard())
  assert.throws(() => parseCardBytes(withoutChunk(valid, 'IDAT')), /missing IHDR, IDAT, or IEND/)
  const badType = Buffer.from(valid)
  const textOffset = badType.indexOf(Buffer.from('tEXt', 'ascii'))
  badType[textOffset] = 0xc1
  assert.throws(() => parseCardBytes(badType), /invalid PNG chunk type bytes/)
  const badCrc = Buffer.from(valid)
  badCrc[badCrc.length - 1] ^= 0xff
  assert.throws(() => parseCardBytes(badCrc), /bad CRC/)
})

test('validates assets and lorebook while rejecting unsupported future V3 revisions', () => {
  const card = minimalCard({
    assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
    character_book: {
      entries: [{ keys: ['archive'], content: 'The archive remembers.', enabled: true, insertion_order: 10, extensions: {}, use_regex: false }],
      extensions: {},
    },
  })
  card.spec_version = '3.1'
  assert.throws(() => validateCardV3(card), /exactly "3.0"/)
  card.spec_version = '3.0'
  const parsed = validateCardV3(card)
  assert.equal(parsed.warnings.length, 0)
  const unsafe = minimalCard({ assets: [{ type: 'icon', uri: 'file:///secret', name: 'x', ext: 'png' }] })
  assert.throws(() => validateCardV3(unsafe), /unsupported or unsafe URI/)
})
