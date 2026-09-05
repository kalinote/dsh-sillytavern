import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultWorldbookEntry,
  createWorldbookEntries,
  decodeTavernWorldbookProtocol,
  deleteWorldbookEntries,
  encodeTavernWorldbookProtocol,
  replaceWorldbookEntries,
  toTavernWorldbookEntries,
  toV3Worldbook,
} from '../src/tavern-worldbook.js'

test('roundtrips complete V3 entries and RegExp keys without losing source, flags, or extensions', () => {
  const book = {
    name: 'Lore',
    description: 'fixture',
    recursive_scanning: true,
    extensions: { book_future: { enabled: true } },
    entries: [{
      id: 42,
      name: 'schema-name',
      comment: 'Shown name',
      enabled: false,
      keys: ['/a\\/b/giu', 'plain'],
      secondary_keys: ['/(moon)+/im'],
      content: 'content',
      insertion_order: 321,
      constant: false,
      selective: true,
      case_sensitive: true,
      use_regex: false,
      priority: 7,
      future_top_level: { alpha: 1 },
      extra: { source_plugin: 'fixture' },
      extensions: {
        position: 7,
        role: 2,
        depth: 9,
        selectiveLogic: 3,
        scan_depth: 6,
        vectorized: true,
        useProbability: false,
        probability: 23,
        exclude_recursion: true,
        prevent_recursion: true,
        delay_until_recursion: 2,
        sticky: 3,
        cooldown: 4,
        delay: 5,
        outlet_name: 'Lore outlet',
        future_extension: { nested: ['kept'] },
      },
    }],
  }

  const tavern = toTavernWorldbookEntries(book)
  assert.equal(tavern[0].strategy.type, 'vectorized')
  assert.equal(tavern[0].position.type, 'outlet')
  assert.equal(tavern[0].position.role, 'assistant')
  assert.equal(tavern[0].probability, 100, 'disabled probability projects exactly like TavernHelper 4.9.3')
  assert.ok(tavern[0].strategy.keys[0] instanceof RegExp)
  assert.equal(tavern[0].strategy.keys[0].source, 'a\\/b')
  assert.equal(tavern[0].strategy.keys[0].flags, 'giu')
  assert.deepEqual(tavern[0].extra.future_extension, { nested: ['kept'] })

  const protocol = JSON.parse(JSON.stringify(encodeTavernWorldbookProtocol(tavern)))
  const decoded = decodeTavernWorldbookProtocol(protocol)
  assert.ok(decoded[0].strategy.keys[0] instanceof RegExp)
  assert.equal(decoded[0].strategy.keys[0].source, 'a\\/b')
  assert.equal(decoded[0].strategy.keys[0].flags, 'giu')
  assert.deepEqual(toV3Worldbook(decoded, book), book)
})

test('uses the pinned TavernHelper 4.9.3 defaults for partial entries', () => {
  assert.deepEqual(createDefaultWorldbookEntry({}, 8), {
    uid: 8,
    name: '',
    enabled: true,
    strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 100 },
    content: '',
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    addMemo: true,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    ignoreBudget: false,
    outletName: '',
    triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] },
  })
})

test('allocates deterministic unique UIDs while preserving valid stable UIDs', () => {
  const book = { name: 'UIDs', entries: [], extensions: {} }
  const replacement = replaceWorldbookEntries(book, [{ uid: 4 }, { uid: 4 }, {}, { uid: 0 }])
  assert.deepEqual(replacement.worldbook.map(entry => entry.uid), [4, 5, 0, 1])
  assert.deepEqual(book.entries, [], 'replacement is pure')

  const created = createWorldbookEntries(replacement.book, [{ name: 'new' }, { uid: 4, name: 'collision' }])
  assert.deepEqual(created.worldbook.map(entry => entry.uid), [4, 5, 0, 1, 2, 6])
  assert.deepEqual(created.new_entries.map(entry => entry.uid), [2, 6])
  assert.deepEqual(replacement.worldbook.map(entry => entry.uid), [4, 5, 0, 1], 'creation does not mutate its input result')
})

test('deletes by predicate atomically and returns detached deleted entries', () => {
  const initial = replaceWorldbookEntries({ name: 'Delete', entries: [], extensions: {} }, [
    { uid: 1, name: 'keep' },
    { uid: 2, name: 'drop-a' },
    { uid: 3, name: 'drop-b' },
  ])
  const result = deleteWorldbookEntries(initial.book, entry => entry.name.startsWith('drop'))
  assert.deepEqual(result.worldbook.map(entry => entry.name), ['keep'])
  assert.deepEqual(result.deleted_entries.map(entry => entry.name), ['drop-a', 'drop-b'])
  result.deleted_entries[0].name = 'mutated result'
  assert.equal(toTavernWorldbookEntries(result.book)[0].name, 'keep')
  assert.deepEqual(initial.worldbook.map(entry => entry.name), ['keep', 'drop-a', 'drop-b'])
})

test('preserves unknown TavernHelper fields in V3 extensions and restores them', () => {
  const source = [{
    uid: 9,
    name: 'future',
    extra: { provider_payload: { value: 7 } },
    future_api_field: { mode: 'new' },
  }]
  const internal = toV3Worldbook(source, { name: 'Unknowns', extensions: { book: true } })
  assert.deepEqual(internal.entries[0].extensions.provider_payload, { value: 7 })
  const restored = toTavernWorldbookEntries(internal)[0]
  assert.deepEqual(restored.extra.provider_payload, { value: 7 })
  assert.deepEqual(restored.future_api_field, { mode: 'new' })
  assert.deepEqual(internal.extensions, { book: true })
})
