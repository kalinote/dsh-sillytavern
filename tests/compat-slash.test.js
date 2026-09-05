import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMAND_DEFINITIONS,
  HOST_COMMAND_NAMES,
  SLASH_ERROR_CODES,
  SlashCommandRegistry,
  execute,
  parse,
  registry,
} from '../src/compat-slash.js'

test('parse handles quotes, escapes, named arguments, and pipelines', () => {
  assert.deepEqual(parse('/echo severity=success "hello world" path=a\\ b literal\\=value escaped\\|pipe | /PASS \'done | yes\''), [
    {
      command: 'echo',
      args: ['hello world', 'literal=value', 'escaped|pipe'],
      named: { severity: 'success', path: 'a b' },
    },
    {
      command: 'pass',
      args: ['done | yes'],
      named: {},
    },
  ])
  assert.deepEqual(parse('/echo empty= "" repeated=first repeated=last'), [{
    command: 'echo',
    args: [''],
    named: { empty: '', repeated: 'last' },
  }])
})

test('parse errors have a stable code and useful location details', () => {
  for (const input of ['', 'echo no-slash', '/echo "open', '/echo trailing\\', '/pass ok |']) {
    assert.throws(() => parse(input), error => (
      error.code === SLASH_ERROR_CODES.PARSE
      && error.details.source === input
      && Number.isSafeInteger(error.details.offset)
    ))
  }
})

test('registry is table-driven, provides builtins, and injects host handlers', () => {
  assert.deepEqual(COMMAND_DEFINITIONS.map(item => item.name), ['pass', 'echo', ...HOST_COMMAND_NAMES])
  const handlers = Object.fromEntries(HOST_COMMAND_NAMES.map(name => [name, () => name]))
  const commands = registry(handlers)
  assert.deepEqual(commands.list(), ['comment', 'continue', 'echo', 'flushinject', 'getvar', 'inject', 'messages', 'pass', 'regenerate', 'run', 'send', 'sendas', 'setvar', 'sys', 'trigger'])
  for (const name of HOST_COMMAND_NAMES) assert.equal(commands.get(name), handlers[name])

  const custom = () => 'custom'
  const registration = commands.register('/Custom', custom)
  assert.equal(commands.has('custom'), true)
  assert.equal(registration.unregister(), true)
  assert.equal(registration.unregister(), false)
  assert.equal(commands.has('custom'), false)
})

test('execute runs an asynchronous pipeline and supplies parsed invocation context', async () => {
  const calls = []
  const commands = registry({
    send: async invocation => {
      await Promise.resolve()
      calls.push(invocation)
      return `${invocation.pipe}:${invocation.args.join(' ')}:${invocation.named.as}`
    },
    flushinject: invocation => {
      calls.push(invocation)
      return undefined
    },
  })
  const context = { sessionId: 'session-1' }
  const result = await execute('/pass start | /send as=Alice "next value" | /flushinject', {
    registry: commands,
    context,
  })
  assert.equal(result, 'start:next value:Alice')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, ['next value'])
  assert.deepEqual(calls[0].named, { as: 'Alice' })
  assert.equal(calls[0].pipe, 'start')
  assert.equal(calls[0].context, context)
  assert.equal(calls[0].index, 1)
  assert.equal(calls[1].pipe, 'start:next value:Alice')
})

test('pass and echo preserve or replace the pipeline value', async () => {
  const commands = registry()
  assert.equal(await execute('/pass hello world', { registry: commands }), 'hello world')
  assert.equal(await execute('/pass initial | /echo', { registry: commands }), 'initial')
  assert.equal(await execute('/pass initial | /echo replacement', { registry: commands }), 'replacement')
  assert.equal(await execute('/pass', { registry: commands, pipe: 'seed' }), 'seed')
})

test('unknown commands and handler failures expose stable error codes', async () => {
  await assert.rejects(execute('/missing value'), error => (
    error.code === SLASH_ERROR_CODES.UNKNOWN_COMMAND
    && error.details.command === 'missing'
    && error.details.index === 0
  ))

  const cause = new Error('boom')
  const commands = registry({ send: () => { throw cause } })
  await assert.rejects(execute('/send hello', { registry: commands }), error => (
    error.code === SLASH_ERROR_CODES.HANDLER
    && error.details.command === 'send'
    && error.cause === cause
  ))
})

test('custom registries and abort signals compose without host dependencies', async () => {
  const commands = new SlashCommandRegistry()
  commands.register('pass', invocation => invocation.args.join(' '))
  commands.register('custom', invocation => `${invocation.pipe}!`)
  assert.equal(await execute('/pass pure | /custom', { registry: commands }), 'pure!')

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(execute('/pass never', { registry: commands, signal: controller.signal }), error => error.name === 'AbortError')
})
