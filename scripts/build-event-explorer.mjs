/** Inline the maintainable event-view modules into the shipped DSH module factory. */
import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const start = '    // BEGIN GENERATED EVENT EXPLORER'
const end = '    // END GENERATED EVENT EXPLORER'
const modules = [
  ['eventExplorerModel', 'src/client/event-explorer-model.cjs'],
  ['eventExplorerSource', 'src/client/event-explorer-source.cjs'],
  ['createEventExplorerUI', 'src/client/event-explorer-ui.cjs'],
]
const parts = await Promise.all(modules.map(async ([name, path]) => {
  const source = (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n').trimEnd()
  return `    const ${name} = (() => {\n      const module = { exports: {} }\n${source.split('\n').map(line => line === '' ? '' : `      ${line}`).join('\n')}\n      return module.exports\n    })()`
}))
const generated = `${start}\n${parts.join('\n')}\n    const eventExplorerUI = createEventExplorerUI(React, eventExplorerModel)\n${end}`
const bundlePath = new URL('client.cjs', root)
const source = await readFile(bundlePath, 'utf8')
const from = source.indexOf(start)
const to = source.indexOf(end, from)
if (from < 0 || to < 0) throw new Error('Event explorer bundle markers are missing')
const next = source.slice(0, from) + generated + source.slice(to + end.length)
if (process.argv.includes('--check')) {
  if (next !== source) throw new Error('Event explorer bundle is stale; run npm run build:events')
} else if (next !== source) {
  await writeFile(bundlePath, next, 'utf8')
}
