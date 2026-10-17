import type { AgentInfo, AgentSpawnResult, On, TurnStepChunk } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ANSWERED, SHOWN, nameOf, parse, specOf } from '../hooks/register'

const SESSION = { model: 'claude-opus-5-5', effort: 'low' } as const

type Message = { role: 'user' | 'assistant'; content: { type: string; text?: string }[] }

const user = (...texts: string[]): Message => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const assistant = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] })

const handback = (from: string, report: string) =>
  `<agent-message from="${from}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n  ${report}\n</agent-message>`

// The engine beneath the plugin: what entered, what was spawned (the Agent
// tool's call, as the kit runs a spawn), what each model request was sent
// with, and the messages the next request is built from (a request's, as
// `$.session.messages({ as: 'api' })` answers them). The agents listed are
// the ones spawned, `a1` first, unless the test gives its own; the session
// draws on the terminal unless the test says nothing draws it.
function engine(
  on: On,
  options: { tools?: string[]; agents?: AgentInfo[]; spawn?: AgentSpawnResult | Promise<AgentSpawnResult>; isDrawn?: boolean } = {},
) {
  const entered: { text: string; context?: readonly string[] }[] = []
  const spawned: Record<string, unknown>[] = []
  const requests: { turnId: string; effort?: string | number; agentId?: string }[] = []
  const logs: string[] = []
  const messages: Message[] = [user('hello'), assistant('Hi.')]
  on('prompt.submit', ($, e) => {
    entered.push({ text: e.text, context: e.context })
    messages.push(user('<system-reminder>\nnote\n</system-reminder>', e.text))
    return { text: e.text, context: e.context }
  })
  on('session.messages', () => ({ value: messages }))
  on('agent.spawn', ($, e) => {
    spawned.push({ ...e })
    return options.spawn ?? { model: e.model ?? SESSION.model, agentId: `a${spawned.length}` }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({
    value:
      options.agents ??
      spawned.map((s, i): AgentInfo => ({ id: `a${i + 1}`, description: String(s.description), type: 'aside:ask', status: 'running', name: String(s.name) })),
  }))
  on('session.surfaces', () => ({ value: options.isDrawn === false ? [] : ['terminal'] }))
  on('tool.list', () => ({ value: (options.tools ?? []).map(name => ({ name, description: name, mcp: false })) }))
  on('agent.register', ($, e) => ({ value: { agent: `aside:${e.name}` } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('turn.step', async function* ($, e) {
    requests.push({ turnId: e.turnId, effort: e.effort, agentId: e.agentId })
    yield { kind: 'text', index: 0, text: 'from the model' }
    return { turnId: e.turnId, index: e.index, answer: 'from the model', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  return { entered, spawned, requests, logs, messages }
}

const submit = ($: Engine, text: string, extra: { turnId?: string; isMeta?: true; peer?: boolean } = {}) =>
  $.prompt.submit({
    text,
    turnId: extra.turnId,
    isMeta: extra.isMeta,
    wait: false,
    origin: extra.peer ? { kind: 'peer' } : { kind: 'composer' },
  })

async function step($: Engine, turnId: string, index = 0, agentId?: string) {
  const stream = $.turn.step({ turnId, index, messageCount: 1, agentId, ...SESSION })
  const chunks: TurnStepChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  // What the transcript records of the response: its text.
  const text = chunks.flatMap(chunk => (chunk.kind === 'text' ? [chunk.text] : [])).join('')
  return { chunks, text }
}

const complete = ($: Engine, turnId: string, agentId?: string, reason: 'answer' | 'error' = 'answer', answer = '') =>
  $.turn.complete({ turnId, agentId, answer, durationMs: 1, isAborted: false, reason })

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

describe('parse', () => {
  test('a model, an effort in either order, a full id', () => {
    expect(parse('$haiku what does git reset --soft do?')).toEqual({ model: 'haiku', question: 'what does git reset --soft do?' })
    expect(parse('$haiku:low where is the config parsed?')).toEqual({ model: 'haiku', effort: 'low', question: 'where is the config parsed?' })
    expect(parse('$max:Sonnet is this regex safe?')).toEqual({ model: 'sonnet', effort: 'max', question: 'is this regex safe?' })
    expect(parse('$claude-haiku-5-5:xhigh hi')).toEqual({ model: 'claude-haiku-5-5', effort: 'xhigh', question: 'hi' })
    expect(parse('$fable two\nlines')).toEqual({ model: 'fable', question: 'two\nlines' })
  })

  test('no model, or not a spec at all: not ours', () => {
    const texts = ['$low go', '$max', '$HOME is wrong', 'costs $5 now', '$5 is the price', '$haiku', '$haiku:sonnet go', '$low:max go', '$haiku:low:high go', '$constructor go', ' $haiku go']
    for (const text of texts) expect(parse(text), text).toBeUndefined()
  })

  test('a subagent name carries its spec', () => {
    for (const spec of [{ model: 'haiku' }, { model: 'sonnet', effort: 'max' as const }, { model: 'claude-haiku-5-5' }, { model: 'claude-haiku-5-5', effort: 'low' as const }]) {
      expect(specOf(nameOf(spec, 'k3f9'))).toEqual(spec)
    }
    expect(specOf('Explore')).toBeUndefined()
    expect(specOf('a957fcc27d69254fe')).toBeUndefined()
  })
})

describe('aside', () => {
  test('the question goes to a fresh subagent on its model; the prompt enters as typed', async ($, on) => {
    const { entered, spawned } = engine(on)
    await submit($, '$haiku:high what does git reset --soft do?')
    expect(entered).toEqual([{ text: '$haiku:high what does git reset --soft do?', context: undefined }])
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({ subagent_type: 'Explore', model: 'haiku', description: 'aside: what does git reset --soft do?' })
    expect(spawned[0]?.name).toMatch(/^aside-haiku-high-[0-9a-z]+$/)
    expect(spawned[0]?.prompt).toMatch(/\n\nwhat does git reset --soft do\?$/)
  })

  test('with the read-only type registered, it gets the question alone; a full id is set at spawn', async ($, on) => {
    const { spawned } = engine(on, { tools: ['Read', 'Glob', 'Grep', 'Bash'] })
    await start($)
    await submit($, '$claude-haiku-5-5 where is the config parsed?')
    expect(spawned[0]).toMatchObject({ subagent_type: 'aside:ask', model: 'claude-haiku-5-5', prompt: 'where is the config parsed?' })
  })

  test('its type stays offered, so a follow-up from /tasks can resume it', async ($, on) => {
    on('agent.offer', () => ({ isOffered: true }))
    const offered = await $.agent.offer({ agent: 'aside:ask', description: '', source: 'plugin', provider: { plugin: 'aside', tier: 'user' } })
    expect(offered).toEqual({ isOffered: true })
  })

  test("the notice that a resumed aside stopped is answered here; another task's is the model's", async ($, on) => {
    const { requests } = engine(on)
    const notice = (description: string) =>
      `<task-notification>\n<task-id>ab75ecbabe004238f</task-id>\n<status>completed</status>\n<summary>Agent "${description}" finished</summary>\n</task-notification>`
    await submit($, notice('aside: what is 2 plus 2?'), { isMeta: true })
    const ours = await step($, 't1')
    await complete($, 't1')
    expect(ours.text).toBe(SHOWN)
    await submit($, notice('Find parse function definition'), { isMeta: true })
    await step($, 't2')
    expect(requests.map(r => r.turnId)).toEqual(['t2'])
  })

  test('the question turn and the answer turn are answered without a model request', async ($, on) => {
    const { requests, messages, entered } = engine(on)
    const mocked = mock.session(on)
    await submit($, '$haiku:medium what does git reset --soft do?')
    const asked = await step($, 't1')
    await complete($, 't1')
    expect(asked.text).toBe('Asked haiku · medium on the side.')
    expect(asked.chunks).toEqual([
      { kind: 'text', index: 0, text: 'Asked haiku · medium on the side.' },
      { kind: 'stop', stopReason: 'end_turn', usage: null },
    ])
    messages.push(assistant('Asked haiku · medium on the side.'))

    const delivery = handback('aside-haiku-medium-k3f9', 'It moves HEAD and keeps the changes staged.')
    await submit($, delivery, { isMeta: true, peer: true })
    expect(entered.at(-1)).toEqual({ text: delivery, context: undefined })
    const answered = await step($, 't2')
    await complete($, 't2')
    expect(answered.text).toBe(SHOWN)

    expect(requests).toEqual([])
    expect(mocked.appended()).toEqual([])
  })

  test('every step of a turn answered here stays off the model', async ($, on) => {
    const { requests } = engine(on)
    await submit($, '$haiku go on')
    await step($, 't1', 0)
    await step($, 't1', 1)
    await complete($, 't1')
    await submit($, 'a real prompt')
    await step($, 't2')
    expect(requests.map(r => r.turnId)).toEqual(['t2'])
  })

  test("another subagent's hand-back, and plain text, reach the main model untouched", async ($, on) => {
    const { requests, entered } = engine(on)
    const texts = ['$low go', '$HOME is wrong', 'costs $5 now']
    for (const [i, text] of texts.entries()) {
      await submit($, text)
      await step($, `t${i}`)
      await complete($, `t${i}`)
    }
    const other = handback('a957fcc27d69254fe', 'the Explore report')
    await submit($, other, { isMeta: true, peer: true })
    await step($, 't9')
    expect(entered.map(e => e.text)).toEqual([...texts, other])
    expect(entered.every(e => e.context === undefined)).toBe(true)
    expect(requests.map(r => r.turnId)).toEqual(['t0', 't1', 't2', 't9'])
  })

  test('an answer that lands in a running turn is read there with a note', async ($, on) => {
    const { requests, entered } = engine(on)
    await submit($, 'refactor the parser')
    await step($, 't1', 0)
    const delivery = handback('aside-sonnet-k3f9', '42')
    await submit($, delivery, { isMeta: true, peer: true, turnId: 't1' })
    await step($, 't1', 1)
    expect(entered.at(-1)).toEqual({ text: delivery, context: [ANSWERED] })
    expect(requests.map(r => [r.turnId, r.effort])).toEqual([
      ['t1', 'low'],
      ['t1', 'low'],
    ])
  })

  test('a question typed over a running turn carries a note, and is answered here if it gets a turn of its own', async ($, on) => {
    const { requests, entered } = engine(on)
    await submit($, 'refactor the parser')
    await step($, 't1', 0)
    await submit($, '$haiku what is 6 times 7?', { turnId: 't1' })
    expect(entered.at(-1)?.context).toEqual([expect.stringContaining('the user sent this to haiku')])
    await complete($, 't1')
    const own = await step($, 't2')
    expect(own.text).toBe('Asked haiku on the side.')
    expect(requests.map(r => r.turnId)).toEqual(['t1'])
  })

  test('the subagent runs on the effort it was asked for; other subagents keep theirs', async ($, on) => {
    const agents: AgentInfo[] = [
      { id: 'a1', description: 'aside', type: 'aside:ask', status: 'running', name: 'aside-haiku-high-k3f9' },
      { id: 'a2', description: 'aside', type: 'aside:ask', status: 'running', name: 'aside-sonnet-k3f9' },
      { id: 'a3', description: 'explore', type: 'Explore', status: 'running' },
    ]
    const { requests } = engine(on, { agents })
    for (const agentId of ['a1', 'a1', 'a2', 'a3']) await step($, `s-${agentId}`, 0, agentId)
    expect(requests.map(r => [r.agentId, r.effort])).toEqual([
      ['a1', 'high'],
      ['a1', 'high'],
      ['a2', 'low'],
      ['a3', 'low'],
    ])
  })

  test('a subagent that ends without an answer says so', async ($, on) => {
    const agents: AgentInfo[] = [{ id: 'a1', description: 'aside', type: 'aside:ask', status: 'running', name: 'aside-claude-nope-9-k3f9' }]
    const { logs } = engine(on, { agents })
    await step($, 's1', 0, 'a1')
    await complete($, 's1', 'a1', 'error')
    expect(logs).toEqual(['claude-nope-9 did not answer: its model request failed; check the model name'])
  })

  test('a spawn the engine refuses is told in the question turn', async ($, on) => {
    const { requests } = engine(on, { spawn: { deny: '<tool_use_error>No agents here\nmore</tool_use_error>' } })
    await submit($, '$haiku hi')
    const asked = await step($, 't1')
    expect(asked.text).toBe('Could not ask haiku: No agents here')
    expect(requests).toEqual([])
  })

  test('a spawn that runs in the foreground and fails is told once, in the question turn', async ($, on) => {
    let refuse: (result: AgentSpawnResult) => void = () => {}
    const spawn = new Promise<AgentSpawnResult>(resolve => (refuse = resolve))
    const clock = mock.clock(on)
    const { logs, spawned } = engine(on, { spawn })
    const submitted = submit($, '$claude-nope-9 hi')
    await clock.settle()
    expect(spawned).toHaveLength(1)
    // The run ends while its spawn is still out, as a foreground spawn's does.
    await step($, 's1', 0, 'a1')
    await complete($, 's1', 'a1', 'error')
    refuse({ deny: 'Agent terminated early due to an API error: model not found' })
    await submitted
    const asked = await step($, 't1')
    expect(asked.text).toBe('Could not ask claude-nope-9: Agent terminated early due to an API error: model not found')
    expect(logs).toEqual([])
  })

  test('with nothing drawing the session, the question turn waits and carries the answer', async ($, on) => {
    const { requests, spawned } = engine(on, { isDrawn: false })
    await submit($, '$haiku:low what is 6 times 7?')
    await step($, 's1', 0, 'a1')
    const asked = step($, 't1')
    await complete($, 's1', 'a1', 'answer', '42')
    expect((await asked).text).toBe('haiku · low:\n\n42')
    await complete($, 't1')
    await submit($, handback(String(spawned[0]?.name), '42'), { isMeta: true, peer: true })
    expect((await step($, 't2')).text).toBe(SHOWN)
    expect(requests.map(r => r.turnId)).toEqual(['s1'])
  })

  test('with nothing drawing the session, a slow answer comes in the later turn', async ($, on) => {
    const clock = mock.clock(on)
    const { requests, spawned } = engine(on, { isDrawn: false })
    await submit($, '$sonnet what is 6 times 7?')
    await step($, 's1', 0, 'a1')
    const asked = step($, 't1')
    await clock.advance(10_000)
    expect((await asked).text).toMatch(/^Asked sonnet on the side\. Its answer comes back in a later turn/)
    await complete($, 't1')
    await complete($, 's1', 'a1', 'answer', '42')
    await submit($, handback(String(spawned[0]?.name), '42'), { isMeta: true, peer: true })
    expect((await step($, 't2')).text).toBe('sonnet:\n\n42')
    expect(requests.map(r => r.turnId)).toEqual(['s1'])
  })
})

describe('drawing', () => {
  const SURFACES = ['terminal', 'desktop'] as const
  const engineDraws = (on: On) =>
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'engine' })
    })

  test('a hand-back row is drawn as the answer, with its model and effort', async ($, on) => {
    engineDraws(on)
    for (const surface of SURFACES) {
      const props = { text: 'It keeps the changes **staged**.', origin: { kind: 'peer' as const }, isExpanded: false, from: { name: 'aside-haiku-high-k3f9' } }
      const ui = await $.ui.mount({ plugin: 'aside', surface, component: 'UserMessage', props })
      expect(await ui.find({ type: 'Text', text: 'haiku · high' })).toBeDefined()
      expect(await ui.find({ type: 'Markdown', text: 'It keeps the changes **staged**.' })).toBeDefined()
      await ui.redraw({ ...props, isExpanded: true })
      expect(await ui.find({ text: 'engine' })).toBeDefined()
    }
  })

  test("another sender's row and the model's own text are the engine's", async ($, on) => {
    engineDraws(on)
    for (const surface of SURFACES) {
      const row = await $.ui.mount({
        plugin: 'aside',
        surface,
        component: 'UserMessage',
        props: { text: 'report', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'Explore' } },
      })
      expect(await row.find({ text: 'engine' })).toBeDefined()
      const reply = await $.ui.mount({ plugin: 'aside', surface, component: 'AssistantMessage', props: { text: 'Asked haiku on the side.', isFirstOfReply: true } })
      expect(await reply.find({ text: 'engine' })).toBeDefined()
    }
  })

  test('the reply under a drawn answer is not drawn', async ($, on) => {
    engineDraws(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'aside', surface, component: 'AssistantMessage', props: { text: SHOWN, isFirstOfReply: true } })
      expect(await ui.find({ type: 'Box' })).toMatchObject({ props: { display: 'none' } })
      expect(await ui.find({ text: 'engine' })).toBeUndefined()
    }
  })
})
