'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { createContext, Script } = require('node:vm')

function compile(template) {
  let body = "'use strict';let __out='';const __append=(value)=>{if(value!==undefined&&value!==null)__out+=String(value)};\n"
  const tokenPattern = /<%[=-]?[\s\S]*?%>/g
  let cursor = 0
  for (const match of template.matchAll(tokenPattern)) {
    body += `__out+=${JSON.stringify(template.slice(cursor, match.index))};\n`
    const token = match[0]
    if (token.startsWith('<%=') || token.startsWith('<%-')) body += `__append(${token.slice(3, -2)});\n`
    else body += `${token.slice(2, -2)}\n`
    cursor = match.index + token.length
  }
  body += `__out+=${JSON.stringify(template.slice(cursor))};return __out;`
  return body
}

function finish(status, value) {
  const text = String(value)
  parentPort.postMessage(text.length > workerData.maxOutputChars
    ? { status: 2, value: 'template output exceeds the size limit' }
    : { status, value: text })
}

try {
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' })
  const setupSource = `for (const name of ${JSON.stringify(['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Atomics', 'WebAssembly'])}) Object.defineProperty(globalThis, name, { value: undefined }); Object.assign(globalThis, JSON.parse(${JSON.stringify(workerData.scopeJson)}))`
  new Script(setupSource, { filename: 'dsh-sillytavern-template-scope.js' }).runInContext(context, { timeout: 50, breakOnSigint: false })
  const script = new Script(`(function(){${compile(workerData.template)}}).call(null)`, { filename: 'dsh-sillytavern-template.ejs' })
  finish(1, script.runInContext(context, { timeout: 50, breakOnSigint: false }))
} catch (error) {
  finish(2, error instanceof Error ? error.message : String(error))
}
