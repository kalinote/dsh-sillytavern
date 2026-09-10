import { defineTool } from '@deepseek-ai/dsh-tools'

const OUTPUT_SPEC = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    revision: { type: 'number', required: true },
    result: { type: 'string', required: true },
  },
}

function output() {
  return {
    schema: OUTPUT_SPEC,
    render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
  }
}

function definition(service, name, description, parameters, execute) {
  return defineTool({
    name,
    description,
    parameters,
    output: output(),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error(`${name} requires a live Agent`)
      if (typeof service.eligible === 'function' && !service.eligible(exec.agent)) throw new Error(`${name} is unavailable outside a SillyTavern parent Agent`)
      exec.signal.throwIfAborted()
      const value = await execute(args, exec.agent, exec.signal)
      return { ok: true, revision: value.revision, result: JSON.stringify(value.result) }
    },
    presentCall(args) { return { card: 'generic', title: name.replaceAll('_', ' '), kind: 'other', rawInput: args } },
  })
}

const table = { type: 'string', description: 'Memory table name, such as relationships, events, items, locations, or character.' }
const eventId = { type: 'string', description: 'Event-node identifier shared by every memory row that describes the same event.' }
const characters = {
  type: 'array',
  items: { type: 'string' },
  description: 'Characters present in the remembered fact.',
}
const location = {
  oneOf: [
    { type: 'array', items: { type: 'string' } },
    { type: 'null' },
  ],
  description: 'A broad-to-specific location path. A query path also matches descendant locations.',
}
const timeRange = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timeline: { type: 'string', required: true },
    start: { type: 'number', required: true },
    end: { type: 'number', required: true },
  },
  description: 'Story-time range filter with one timeline and finite raw numeric start/end bounds in that timeline\'s established unit. Labels and date-shaped digits do not imply a calendar or epoch conversion.',
}

function queryFields() {
  return {
    table,
    eventId,
    query: { type: 'string', description: 'Short distinctive key, name, keyword, location, character, event id, or phrase.' },
    limit: { type: 'integer' },
    characters,
    characterMatch: { type: 'string', enum: ['any', 'all'] },
    timeRange,
    location,
    order: { type: 'string', enum: ['time_asc', 'time_desc', 'relevance'] },
  }
}

export function eventToolDefinitions(service) {
  return [
    definition(service, 'st_event_query', 'Read matching memory rows from events when established facts may affect the next scene. Each event groups multiple memory rows under one eventId. Explicit queries bypass automatic-recall policy and source-compaction gates.', queryFields(),
      (args, agent, signal) => service.event(agent, { ...args, action: 'query' }, signal)),
    definition(service, 'st_event_graph_query', 'Read an event node, all memory rows grouped under it, and its direct incoming/outgoing precedes relations. Supply eventId when known, or use the same filters as st_event_query to discover seed events.', queryFields(),
      (args, agent, signal) => service.eventGraph(agent, args, signal)),
  ]
}
