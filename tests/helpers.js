import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { crc32 } from '../src/png.js'

export function minimalCard(overrides = {}) {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Alice',
      description: 'A curious archivist.',
      personality: 'Warm and observant.',
      scenario: 'A quiet library.',
      first_mes: 'Welcome to the archive.',
      mes_example: '{{user}}: Hello\n{{char}}: Welcome.',
      creator_notes: '',
      system_prompt: 'Remain in character.',
      post_history_instructions: 'End each reply with a sensory detail.',
      alternate_greetings: [],
      tags: ['test'],
      creator: 'tests',
      character_version: '1.0',
      extensions: { vendor: { keep: true } },
      group_only_greetings: [],
      ...overrides,
    },
  }
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const payload = Buffer.from(data)
  const output = Buffer.alloc(12 + payload.length)
  output.writeUInt32BE(payload.length, 0)
  name.copy(output, 4)
  payload.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([name, payload])), 8 + payload.length)
  return output
}

export function pngCard(card, options = {}) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const keyword = options.keyword ?? 'ccv3'
  const text = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(Buffer.from(JSON.stringify(card)).toString('base64'), 'ascii')])
  const chunks = [chunk('IHDR', ihdr), chunk('tEXt', text), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0])))]
  if (options.secondCard) {
    const second = Buffer.concat([Buffer.from('ccv3\0', 'latin1'), Buffer.from(Buffer.from(JSON.stringify(options.secondCard)).toString('base64'), 'ascii')])
    chunks.push(chunk('tEXt', second))
  }
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([signature, ...chunks])
}
