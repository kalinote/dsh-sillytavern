import { createTemplateRuntime, TemplateRuntime, TEMPLATE_LIMITS } from './template-runtime.js'

const MAX_TEMPLATE_CHARS = TEMPLATE_LIMITS.maxTemplateChars
const MAX_OUTPUT_CHARS = TEMPLATE_LIMITS.maxOutputChars

function macroValue(token, scope) {
  const trimmed = token.trim()
  if (trimmed === 'char') return scope.char ?? scope.character?.name ?? ''
  if (trimmed === 'user') return scope.user ?? scope.userPersona?.name ?? ''
  if (trimmed === 'description') return scope.character?.description ?? ''
  if (trimmed === 'personality') return scope.character?.personality ?? ''
  if (trimmed === 'scenario') return scope.character?.scenario ?? ''
  if (trimmed === 'firstMessage' || trimmed === 'first_mes') return scope.character?.first_mes ?? ''
  if (trimmed.startsWith('outlet::')) return scope.outlets?.[trimmed.slice(8).trim()] ?? ''
  if (trimmed.startsWith('getvar::')) return scope.variables?.[trimmed.slice(8)] ?? ''
  if (trimmed.startsWith('globalvar::')) return scope.globalVariables?.[trimmed.slice(11)] ?? ''
  return `⦃⦃${trimmed.replaceAll('⦃', '').replaceAll('⦄', '')}⦄⦄`
}

export function renderMacros(input, scope, maxChars = MAX_OUTPUT_CHARS) {
  const source = String(input)
  if (source.length > MAX_TEMPLATE_CHARS) throw new Error(`template exceeds ${MAX_TEMPLATE_CHARS} characters`)
  const pattern = /{{([\s\S]*?)}}/g
  let output = ''
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    output += source.slice(cursor, match.index)
    output += String(macroValue(match[1], scope))
    if (output.length > maxChars) throw new Error(`template macro output exceeds ${maxChars} characters`)
    cursor = match.index + match[0].length
  }
  output += source.slice(cursor)
  if (output.length > maxChars) throw new Error(`template macro output exceeds ${maxChars} characters`)
  return output
}

export async function evaluatePromptTemplate(input, scope = {}, options = {}, signal) {
  signal?.throwIfAborted()
  const runtime = createTemplateRuntime({
    state: options.state ?? {
      local: scope.variables ?? {},
      global: scope.globalVariables ?? {},
      initial: scope.initialVariables ?? {},
      message: scope.messageVariables ?? {},
    },
    resources: options.resources,
    baseRevisions: options.baseRevisions,
    execute: options.execute,
    resolveInclude: options.resolveInclude,
    limits: options.limits,
  })
  try {
    return await runtime.render(input, scope, options, signal)
  } finally {
    await runtime.close()
  }
}

export async function renderPromptTemplate(input, scope = {}, signal) {
  return (await evaluatePromptTemplate(input, scope, {}, signal)).text
}

export { createTemplateRuntime, TemplateRuntime, TEMPLATE_LIMITS }

export function neutralizeDshTemplates(value) {
  return String(value).replaceAll('{{', '⦃⦃').replaceAll('}}', '⦄⦄')
}
