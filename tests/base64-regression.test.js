import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { parseCardBytes } from '../src/card-v3.js'
import { decodeBase64 } from '../src/http.js'
import { minimalCard, pngCard } from './helpers.js'

test('decodes a multi-megabyte upload without exhausting the call stack', () => {
  const source = Buffer.alloc(4 * 1024 * 1024, 0xa5)
  const decoded = decodeBase64(source.toString('base64'))
  assert.deepEqual(decoded, source)
})

test('continues to reject malformed and non-canonical Base64 uploads', () => {
  for (const value of ['!!!!', 'Zg=', 'Zg==AAAA', 'Z g=']) {
    assert.throws(() => decodeBase64(value), /not canonical Base64/)
  }
})

test('parses a multi-megabyte ccv3 payload without exhausting the call stack', () => {
  const card = minimalCard({
    description: 'd'.repeat(1_800_000),
    personality: 'p'.repeat(1_800_000),
  })
  const parsed = parseCardBytes(pngCard(card))
  assert.equal(parsed.format, 'png-v3')
  assert.equal(parsed.card.data.name, 'Alice')
  assert.equal(parsed.card.data.description.length, 1_800_000)
  assert.equal(parsed.card.data.personality.length, 1_800_000)
})
