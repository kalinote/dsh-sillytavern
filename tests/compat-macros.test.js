import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MACRO_ERROR_CODES,
  MacroRegistry,
} from '../src/compat-macros.js'

test('registered callbacks receive match, captures including named groups, and context', () => {
  const macros = new MacroRegistry()
  const context = { message_id: 7, role: 'assistant' }
  const calls = []
  macros.register(/\[(\w+):(?<value>\d+)\]/g, (match, captures, actualContext) => {
    calls.push({ match, captures, actualContext, index: captures.index, input: captures.input })
    return `${captures[0]}=${captures.groups.value}@${actualContext.message_id}`
  })
  assert.equal(macros.substituteMacros('A [hp:12] B [mp:3]', context), 'A hp=12@7 B mp=3@7')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].captures, ['hp', '12'])
  assert.deepEqual(calls[0].captures.groups, { value: '12' })
  assert.equal(calls[0].match, '[hp:12]')
  assert.equal(calls[0].actualContext, context)
  assert.equal(calls[0].index, 2)
  assert.equal(calls[0].input, 'A [hp:12] B [mp:3]')
})

test('resolver values and registrations substitute synchronously in registration order', () => {
  const macros = new MacroRegistry({
    resolver: (name, context) => context.values[name],
  })
  macros.register(/<first>/g, () => '<second>')
  macros.register(/<second>/g, (_match, _captures, context) => context.final)
  assert.equal(macros.substituteMacros('{{nested}} and {{unknown}}', {
    values: { nested: '<first>' },
    final: 'resolved',
  }), 'resolved and {{unknown}}')
})

test('global and non-global patterns retain native repeated replacement semantics', () => {
  const macros = new MacroRegistry()
  macros.register(/x/g, () => 'g')
  macros.register(/g/, () => 'first')
  assert.equal(macros.substituteMacros('x-x-x'), 'first-g-g')
  assert.equal(macros.substituteMacros('x-x-x'), 'first-g-g')
})

test('source and flags form registration identity and replacement keeps its order', () => {
  const macros = new MacroRegistry()
  const stale = macros.register(/x/g, () => 'old')
  macros.register(/y/g, () => 'tail')
  const current = macros.register(/x/g, () => 'new')
  macros.register(/x/i, () => 'case')
  assert.equal(macros.size, 3)
  assert.equal(stale.unregister(), false, 'a stale disposer cannot remove its replacement')
  assert.equal(macros.substituteMacros('x y X'), 'new tail case')
  assert.equal(current.unregister(), true)
  assert.equal(current.unregister(), false)
  assert.equal(macros.size, 2)
})

test('unregister and clear remove registrations idempotently', () => {
  const macros = new MacroRegistry()
  const first = macros.register(/a/g, () => 'A')
  macros.register(/b/g, () => 'B')
  assert.equal(macros.unregister(/missing/g), false)
  assert.equal(first.unregister(), true)
  assert.equal(first.unregister(), false)
  assert.equal(macros.substituteMacros('ab'), 'aB')
  assert.equal(macros.clear(), 1)
  assert.equal(macros.clear(), 0)
  assert.equal(macros.substituteMacros('ab'), 'ab')
})

test('substitution never reads or leaks caller RegExp lastIndex', () => {
  const pattern = /x/g
  pattern.lastIndex = 9
  const macros = new MacroRegistry()
  macros.register(pattern, () => 'y')
  assert.equal(macros.substituteMacros('xx'), 'yy')
  assert.equal(macros.substituteMacros('xx'), 'yy')
  assert.equal(pattern.lastIndex, 9)
})

test('callback exceptions and Promises report stable synchronous errors', () => {
  const cause = new Error('boom')
  const throwing = new MacroRegistry()
  throwing.register(/x/, () => { throw cause })
  assert.throws(() => throwing.substituteMacros('x', {}), error => (
    error.code === MACRO_ERROR_CODES.CALLBACK
    && error.details.kind === 'registered'
    && error.details.source === 'x'
    && error.cause === cause
  ))

  const asynchronous = new MacroRegistry()
  asynchronous.register(/x/, async () => 'later')
  assert.throws(() => asynchronous.substituteMacros('x', {}), error => (
    error.code === MACRO_ERROR_CODES.ASYNC_CALLBACK
    && error.details.kind === 'registered'
  ))

  const asyncResolver = new MacroRegistry(async () => 'later')
  assert.throws(() => asyncResolver.substituteMacros('{{value}}', {}), error => (
    error.code === MACRO_ERROR_CODES.ASYNC_CALLBACK
    && error.details.kind === 'resolver'
  ))
})
