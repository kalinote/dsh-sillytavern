import { Buffer } from 'node:buffer'

function header(headers, name) {
  const value = headers?.[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
}

function loopback(hostname) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

export function assertTrustedLoopbackRequest(req) {
  const authority = header(req.headers, 'host')
  if (authority === undefined) throw new Error('untrusted API request: missing Host header')
  let host
  try { host = new URL(`http://${authority}`) } catch { throw new Error('untrusted API request: invalid Host header') }
  if (!loopback(host.hostname)) throw new Error('untrusted API request: Host must be loopback')
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') throw new Error('untrusted API request: cross-site fetch')
  const origin = header(req.headers, 'origin')
  if (origin !== undefined) {
    let parsed
    try { parsed = new URL(origin) } catch { throw new Error('untrusted API request: invalid Origin header') }
    if (parsed.host !== host.host) throw new Error('untrusted API request: Origin does not match Host')
  }
}

export function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

export async function readJsonBody(req, maxBytes = 96 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('request body is not valid JSON') }
}

export function decodeBase64(value, maxBytes = 64 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length % 4 !== 0) throw new Error('file data is not canonical Base64')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > maxBytes) throw new Error(`decoded file exceeds ${maxBytes} bytes`)
  if (bytes.toString('base64') !== value) throw new Error('file data is not canonical Base64')
  return bytes
}
