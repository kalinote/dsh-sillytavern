import { Buffer } from 'node:buffer'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxChunkBytes: 16 * 1024 * 1024,
  maxChunks: 10_000,
  maxTextChunks: 256,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxPixels: 64_000_000,
  maxFrames: 1_000,
  maxCardJsonBytes: 8 * 1024 * 1024,
})
const KNOWN_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
const BIT_DEPTHS = new Map([[0, new Set([1, 2, 4, 8, 16])], [2, new Set([8, 16])], [3, new Set([1, 2, 4, 8])], [4, new Set([8, 16])], [6, new Set([8, 16])]])

let crcTable
function table() {
  if (crcTable !== undefined) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  return crcTable
}

export function crc32(bytes) {
  const values = table()
  let crc = 0xffffffff
  for (const byte of bytes) crc = values[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function decodeBase64Strict(text, maxBytes) {
  if (text.length === 0 || text.length % 4 !== 0) {
    throw new Error('ccv3 payload is not canonical Base64')
  }
  const decoded = Buffer.from(text, 'base64')
  if (decoded.length > maxBytes) throw new Error(`ccv3 JSON exceeds ${maxBytes} bytes`)
  if (decoded.toString('base64') !== text) throw new Error('ccv3 payload is not canonical Base64')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  } catch {
    throw new Error('ccv3 payload is not valid UTF-8')
  }
}

function validTypeBytes(bytes) {
  return bytes.length === 4 && [...bytes].every(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))
}

export function extractCcv3Json(input, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  const strict = options.strict !== false
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length > limits.maxFileBytes) throw new Error(`PNG/APNG exceeds ${limits.maxFileBytes} bytes`)
  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG/APNG file')

  let offset = 8
  let chunks = 0
  let textChunks = 0
  let metadataBytes = 0
  let ihdr = 0
  let iend = 0
  let idat = 0
  let idatEnded = false
  let plte = 0
  let colorType
  let apng = false
  let apngFrames = 0
  let apngFrameControls = 0
  let apngNextSequence = 0
  const payloads = []
  const warnings = []

  while (offset < buffer.length) {
    if (chunks >= limits.maxChunks) throw new Error(`PNG chunk count exceeds ${limits.maxChunks}`)
    if (offset + 12 > buffer.length) throw new Error('truncated PNG chunk header')
    const length = buffer.readUInt32BE(offset)
    if (length > limits.maxChunkBytes) throw new Error(`PNG chunk exceeds ${limits.maxChunkBytes} bytes`)
    const end = offset + 12 + length
    if (end > buffer.length || end < offset) throw new Error('PNG chunk length is out of bounds')
    const typeBytes = buffer.subarray(offset + 4, offset + 8)
    if (!validTypeBytes(typeBytes)) throw new Error('invalid PNG chunk type bytes')
    const type = typeBytes.toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const expected = buffer.readUInt32BE(offset + 8 + length)
    const actual = crc32(buffer.subarray(offset + 4, offset + 8 + length))
    if (expected !== actual) throw new Error(`bad CRC for PNG chunk ${type}`)

    chunks += 1
    if (chunks === 1 && type !== 'IHDR') throw new Error('IHDR must be the first PNG chunk')
    if (idat > 0 && type !== 'IDAT') idatEnded = true
    if (typeBytes[0] >= 65 && typeBytes[0] <= 90 && !KNOWN_CRITICAL.has(type)) throw new Error(`unknown critical PNG chunk ${type}`)

    if (type === 'IHDR') {
      ihdr += 1
      if (ihdr !== 1 || length !== 13) throw new Error('PNG must contain exactly one valid IHDR')
      const width = data.readUInt32BE(0)
      const height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9]
      if (width < 1 || height < 1 || width > limits.maxWidth || height > limits.maxHeight || width * height > limits.maxPixels) throw new Error('PNG dimensions exceed the configured safety budget')
      if (!BIT_DEPTHS.get(colorType)?.has(bitDepth) || data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) throw new Error('invalid PNG IHDR encoding fields')
    } else if (type === 'PLTE') {
      plte += 1
      if (plte !== 1 || idat > 0 || length === 0 || length % 3 !== 0 || length > 768) throw new Error('invalid PNG palette chunk')
      if (colorType === 0 || colorType === 4) throw new Error('PNG color type must not contain PLTE')
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('PNG IDAT chunks must be consecutive')
      if (colorType === 3 && plte !== 1) throw new Error('indexed PNG requires PLTE before IDAT')
      idat += 1
    } else if (type === 'acTL') {
      if (apng || idat > 0 || length !== 8) throw new Error('invalid APNG animation control chunk')
      apng = true
      apngFrames = data.readUInt32BE(0)
      if (apngFrames < 1 || apngFrames > limits.maxFrames) throw new Error('APNG frame count exceeds the configured safety budget')
    } else if (type === 'fcTL') {
      if (!apng || length !== 26) throw new Error('invalid APNG frame control chunk')
      const sequence = data.readUInt32BE(0)
      if (sequence !== apngNextSequence) throw new Error('invalid APNG sequence number')
      apngNextSequence += 1
      apngFrameControls += 1
      if (data.readUInt32BE(4) < 1 || data.readUInt32BE(8) < 1) throw new Error('invalid APNG frame dimensions')
    } else if (type === 'fdAT') {
      if (!apng || length < 5) throw new Error('invalid APNG frame data chunk')
      const sequence = data.readUInt32BE(0)
      if (sequence !== apngNextSequence) throw new Error('invalid APNG sequence number')
      apngNextSequence += 1
    } else if (type === 'tEXt') {
      textChunks += 1
      metadataBytes += length
      if (textChunks > limits.maxTextChunks || metadataBytes > limits.maxMetadataBytes) throw new Error('PNG text metadata exceeds the configured safety budget')
      const separator = data.indexOf(0)
      if (separator < 1 || separator > 79) throw new Error('invalid PNG tEXt keyword')
      const keyword = data.toString('latin1', 0, separator)
      if (keyword.toLowerCase() === 'ccv3') {
        if (keyword !== 'ccv3') warnings.push(`non-canonical ccv3 keyword casing: ${keyword}`)
        payloads.push(data.toString('latin1', separator + 1))
      }
    } else if (type === 'IEND') {
      iend += 1
      if (iend !== 1 || length !== 0) throw new Error('PNG must contain exactly one valid IEND')
      offset = end
      break
    }
    offset = end
  }

  if (ihdr !== 1 || iend !== 1 || idat < 1) throw new Error('PNG is missing IHDR, IDAT, or IEND')
  if (apng && apngFrameControls !== apngFrames) throw new Error('APNG frame-control count does not match acTL')
  if (offset !== buffer.length) {
    if (strict) throw new Error('PNG contains bytes after IEND')
    warnings.push('ignored bytes after IEND')
  }
  if (payloads.length === 0) throw new Error('PNG/APNG has no Character Card V3 ccv3 chunk')
  if (payloads.length > 1) {
    if (strict) throw new Error('PNG/APNG contains multiple ccv3 chunks')
    warnings.push(`multiple ccv3 chunks found; used the first of ${payloads.length}`)
  }
  const json = decodeBase64Strict(payloads[0], limits.maxCardJsonBytes)
  return { json, warnings, apng }
}

export const pngLimits = DEFAULT_LIMITS
