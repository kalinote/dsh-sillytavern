import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { Tokenizer } from '@agnai/web-tokenizers'
import { encoding_for_model, get_encoding } from 'tiktoken'

const unzip = promisify(gunzip)
const LOAD_TIMEOUT_MS = 20_000
const loaders = new Map()
const warnedFallbacks = new Set()

// These are the same tokenizer assets used by SillyTavern. URLs are fixed so
// card data can never turn tokenizer loading into an arbitrary network fetch.
const WEB_TOKENIZERS = {
  claude: { url: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/claude.json' },
  command_a: { url: 'https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/command-a.json.gz', gzip: true },
  command_r: { url: 'https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/command-r.json.gz', gzip: true },
  deepseek: { url: 'https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/deepseek.json.gz', gzip: true },
  llama3: { url: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/llama3.json' },
  nemo: { url: 'https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/nemo.json.gz', gzip: true },
  qwen2: { url: 'https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/qwen2.json.gz', gzip: true },
}

const SENTENCEPIECE_TOKENIZERS = {
  gemma: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/gemma.model',
  jamba: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/jamba.model',
  llama: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/llama.model',
  mistral: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/mistral.model',
  yi: 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/src/tokenizers/yi.model',
}

function routeText(provider, model) {
  return `${String(provider ?? '')}/${String(model ?? '')}`.toLocaleLowerCase()
}

function routeSpec(provider, model) {
  const route = routeText(provider, model)
  if (/deepseek|mai-ds|\bds-r1\b/.test(route)) return { kind: 'web', id: 'deepseek' }
  if (/command[-_ ]?a/.test(route)) return { kind: 'web', id: 'command_a' }
  if (/command[-_ ]?r|cohere/.test(route)) return { kind: 'web', id: 'command_r' }
  if (/qwen/.test(route)) return { kind: 'web', id: 'qwen2' }
  if (/llama[-_ ]?3|\bllama3\b/.test(route)) return { kind: 'web', id: 'llama3' }
  if (/claude|anthropic/.test(route)) return { kind: 'web', id: 'claude' }
  if (/nemo|pixtral/.test(route)) return { kind: 'web', id: 'nemo' }
  if (/mistral|mixtral/.test(route)) return { kind: 'sentencepiece', id: 'mistral' }
  if (/gemma|gemini/.test(route)) return { kind: 'sentencepiece', id: 'gemma' }
  if (/jamba/.test(route)) return { kind: 'sentencepiece', id: 'jamba' }
  if (/(?:^|[/_-])yi(?:[-_/]|$)/.test(route)) return { kind: 'sentencepiece', id: 'yi' }
  if (/llama/.test(route)) return { kind: 'sentencepiece', id: 'llama' }
  if (/openai|chatgpt|\bgpt[-_]|(?:^|\/)o[134](?:[-_/]|$)|codex/.test(route)) return { kind: 'tiktoken', id: String(model ?? '') }
  return { kind: 'fallback', id: route || 'unknown' }
}

async function fetchBytes(url, gzip = false) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    headers: { accept: 'application/octet-stream, application/json' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  return gzip ? unzip(bytes) : bytes
}

function detachedArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function loadTokenizer(spec) {
  if (spec.kind === 'tiktoken') {
    let tokenizer
    try { tokenizer = encoding_for_model(spec.id) } catch {
      const legacy = /gpt-3\.5|gpt-35|gpt-4(?:$|[-_](?!o|\.1|\.5))/.test(spec.id.toLocaleLowerCase())
      tokenizer = get_encoding(legacy ? 'cl100k_base' : 'o200k_base')
    }
    return { kind: `tiktoken:${tokenizer.name ?? spec.id}`, count: text => tokenizer.encode_ordinary(text).length }
  }
  if (spec.kind === 'web') {
    const asset = WEB_TOKENIZERS[spec.id]
    const bytes = await fetchBytes(asset.url, asset.gzip === true)
    const tokenizer = await Tokenizer.fromJSON(detachedArrayBuffer(bytes))
    return { kind: `web:${spec.id}`, count: text => tokenizer.encode(text).length }
  }
  if (spec.kind === 'sentencepiece') {
    const bytes = await fetchBytes(SENTENCEPIECE_TOKENIZERS[spec.id])
    const tokenizer = await Tokenizer.fromSentencePiece(detachedArrayBuffer(bytes))
    return { kind: `sentencepiece:${spec.id}`, count: text => tokenizer.encode(text).length }
  }
  return undefined
}

function cachedTokenizer(spec) {
  const key = `${spec.kind}:${spec.id}`
  let loader = loaders.get(key)
  if (loader === undefined) {
    loader = loadTokenizer(spec).catch(error => {
      if (!warnedFallbacks.has(key)) {
        warnedFallbacks.add(key)
        console.warn(`[dsh-sillytavern] tokenizer ${key} unavailable; using byte estimate: ${error instanceof Error ? error.message : String(error)}`)
      }
      return undefined
    })
    loaders.set(key, loader)
  }
  return loader
}

function awaitWithSignal(promise, signal) {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason ?? new Error('operation aborted'))
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', aborted); resolve(value) },
      error => { signal.removeEventListener('abort', aborted); reject(error) },
    )
  })
}

export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text), 'utf8') / 3.35)
}

export async function countModelTokens(provider, model, text, signal) {
  const spec = routeSpec(provider, model)
  const tokenizer = await awaitWithSignal(cachedTokenizer(spec), signal)
  signal?.throwIfAborted()
  if (tokenizer !== undefined) return tokenizer.count(String(text))
  const key = `${spec.kind}:${spec.id}`
  if (!warnedFallbacks.has(key)) {
    warnedFallbacks.add(key)
    console.warn(`[dsh-sillytavern] no tokenizer mapping for ${routeText(provider, model) || 'unknown model'}; using byte estimate`)
  }
  return estimateTokens(text)
}

export function tokenizerKindForModel(provider, model) {
  const spec = routeSpec(provider, model)
  return `${spec.kind}:${spec.id}`
}
