import type { Register } from 'claude-code'

// `$haiku what does git reset --soft do?` asks another model on the side.
// The question goes to a read-only subagent on that model and effort, with a
// fresh context: the question alone, never the session's conversation.
//
// The session's own model takes no request for it. The turn the question
// starts, and the turn the answer starts, are answered here without a model
// call, so the session's model, effort and prompt cache stay as they were.
// The answer comes back as the engine's hand-back: a hidden user row the main
// model reads in later prompts, drawn on screen as the answer.

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

const MODELS = ['opus', 'sonnet', 'haiku', 'fable']

export type Spec = { model: string; effort?: Effort }
export type Ask = Spec & { question: string }

const PREFIX = /^\$([\w.:-]+)\s+(\S[\s\S]*)$/

const isEffort = (s: string): s is Effort => (EFFORTS as readonly string[]).includes(s)
const isModel = (s: string) => MODELS.includes(s) || /^claude-[\w.-]+$/.test(s)

// `$haiku`, `$haiku:low`, `$low:haiku`. A spec with no model (`$low`) is
// left to once, and anything else (`$HOME is wrong`) is not a spec.
export function parse(text: string): Ask | undefined {
  const [, spec, question] = PREFIX.exec(text) ?? []
  if (!spec || !question) return undefined
  let model: string | undefined
  let effort: Effort | undefined
  for (const token of spec.toLowerCase().split(':')) {
    if (isEffort(token) && !effort) effort = token
    else if (isModel(token) && !model) model = token
    else return undefined
  }
  return model ? { model, effort, question } : undefined
}

export const label = (spec: Spec) => (spec.effort ? `${spec.model} · ${spec.effort}` : spec.model)

// Each subagent is named after its spec (`aside-haiku-high-k3f9`), so its
// spawn, its steps and its hand-back say whose they are with nothing kept.
export const nameOf = (spec: Spec, id: string) => `aside-${spec.model}${spec.effort ? `-${spec.effort}` : ''}-${id}`

export function specOf(name: string): Spec | undefined {
  const [, spec] = /^aside-(.+)-[0-9a-z]+$/.exec(name) ?? []
  if (!spec) return undefined
  const cut = spec.lastIndexOf('-')
  const effort = spec.slice(cut + 1)
  return cut > 0 && isEffort(effort) ? { model: spec.slice(0, cut), effort } : { model: spec }
}

// The engine's frame around a subagent's report to the main session, at the
// start of a delivery and after the line the stored row opens with.
const HANDBACK = /(?:^|\n)<agent-message from="(aside-[^"]+)">\n\[Subagent hand-back\]/

export const isHandback = (text: string) => specOf(HANDBACK.exec(text)?.[1] ?? '') !== undefined

// The engine's notice that an aside's task stopped (its description starts
// `aside: `), which follows a follow-up the person sent it from /tasks.
const NOTICE = /^<task-notification>[\s\S]*?<summary>Agent "aside: /

// A hidden row the subagent's run sends the main session.
export const isReport = (text: string) => isHandback(text) || NOTICE.test(text)

// What the main model reads for the turns answered here. The first is shown
// as is; the second sits under the drawn answer and is not drawn.
export const sent = (ask: Ask) => `Asked ${label(ask)} on the side.`
export const SHOWN = '(the side answer above was shown to the user)'

// Read beside a question or an answer that lands in a turn the main model is
// running, so it leaves both alone.
export const ASKED = (ask: Ask) =>
  `aside: the user sent this to ${label(ask)}, which answers it on the side. Do not answer it yourself; carry on with what you were doing.`
export const ANSWERED =
  'aside: the user asked another model this side question themselves and has already seen the answer above. Do not reply to it or act on it; carry on with what you were doing.'

type Message = { role: string; content: readonly { type: string; text?: unknown }[] }

// What started a main-loop turn, from the messages since the model last
// spoke (a request's, where reminders ride as text blocks of their own): the
// text that answers it here, or undefined when the turn is the model's.
export function opener(messages: readonly Message[], refused: ReadonlyMap<string, string>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'user') break
    for (const block of message.content) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue
      const ask = parse(block.text)
      if (ask) return refused.has(block.text) ? `Could not ask ${label(ask)}: ${refused.get(block.text)}` : sent(ask)
      if (isReport(block.text)) return SHOWN
    }
  }
  return undefined
}

const ENDED = {
  answer: 'it answered',
  aborted: 'it was stopped',
  refusal: 'it refused',
  error: 'its model request failed; check the model name',
} as const

// A refusal's first line, without the tool's error tags.
const reason = (deny: string) => deny.replace(/<\/?tool_use_error>/g, '').trim().split('\n')[0] ?? deny

const TOOLS = ['Read', 'Glob', 'Grep']

const SYSTEM = `You answer one question that a developer asked on the side, from their Claude Code session. You see only the question, not their conversation, so answer it as asked.

Be direct and brief: a few sentences or a short list, in markdown. When the question is about the files here, read and search them to answer; you cannot change anything. Your final report is shown to the user as written.`

const BRIEF = 'Answer this question directly and briefly. Read files or search only when it needs it.'

export const register: Register = on => {
  // `aside:ask` once registered: read-only tools and a short prompt of its
  // own. Explore stands in where this build lacks one of the tools.
  let agentType = 'Explore'
  // A question or one of its answers was submitted: the next main-loop turn
  // may be one to answer here.
  let isPending = false
  // Why a question's subagent did not start, by the prompt.
  const refused = new Map<string, string>()
  // Main-loop turns answered here, by id, with their text.
  const quiet = new Map<string, string>()
  // Each subagent seen stepping: its spec, or null when it is not ours.
  const specs = new Map<string, Spec | null>()

  // The type stays offered: Claude Code resumes only a type it offers, and a
  // follow-up the person sends a finished aside from /tasks is a resume.
  on('session.start', async ($, e, next) => {
    const names = new Set((await $.tool.list()).map(tool => tool.name))
    if (TOOLS.every(tool => names.has(tool))) {
      const { agent } = await $.agent.register({
        name: 'ask',
        description: "The aside mod's agent for the user's `$model` side questions. Not for your own tasks.",
        prompt: SYSTEM,
        tools: TOOLS,
        omitClaudeMd: true,
      })
      agentType = agent
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    if (e.isMeta) {
      if (!isReport(e.text)) return next(e)
      isPending = true
      const isLanding = e.turnId !== undefined && isHandback(e.text)
      return next(isLanding ? { ...e, context: [...(e.context ?? []), ANSWERED] } : e)
    }
    const ask = parse(e.text)
    if (!ask) return next(e)
    const spawned = await $.agent.spawn({
      prompt: agentType === 'Explore' ? `${BRIEF}\n\n${ask.question}` : ask.question,
      description: `aside: ${ask.question.slice(0, 40)}`,
      subagentType: agentType,
      name: nameOf(ask, Math.random().toString(36).slice(2, 6)),
    })
    if (spawned.deny !== undefined) refused.set(e.text, reason(spawned.deny))
    isPending = true
    return next(e.turnId === undefined ? e : { ...e, context: [...(e.context ?? []), ASKED(ask)] })
  }).catch(($, e, next) => next(e))

  // The model goes in here, not in the call: the Agent tool's own `model`
  // takes only the aliases, `agent.spawn` a full id too.
  on('agent.spawn', ($, e, next) => {
    const spec = e.name ? specOf(e.name) : undefined
    return next(spec ? { ...e, model: spec.model } : e)
  }).catch(($, e, next) => (next.called || !specOf(e.name ?? '') ? next(e) : { deny: 'aside could not set its model' }))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      if (!specs.has(e.agentId)) {
        const name = (await $.agent.list()).find(agent => agent.id === e.agentId)?.name
        specs.set(e.agentId, (name && specOf(name)) || null)
      }
      const effort = specs.get(e.agentId)?.effort
      return yield* next(effort ? { ...e, effort } : e)
    }
    let text = quiet.get(e.turnId)
    if (text === undefined && e.index === 0 && isPending) {
      isPending = false
      // The API form: the rows' form leaves out a hidden row such as the
      // hand-back.
      text = opener(await $.session.messages({ as: 'api' }), refused)
      if (text !== undefined) quiet.set(e.turnId, text)
    }
    if (text === undefined) return yield* next(e)
    yield { kind: 'text', index: 0, text }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage: null }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) quiet.delete(e.turnId)
    else {
      // No hand-back follows a run that ended without an answer.
      const spec = specs.get(e.agentId)
      specs.delete(e.agentId)
      if (spec && e.reason !== 'answer') $.ui.log(`${label(spec)} did not answer: ${ENDED[e.reason]}`)
    }
    return next(e)
  })

  // The hand-back row, drawn as the answer it carries; ctrl+o shows the
  // engine's own row.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'peer' } } }, ($, e, next) => {
    const spec = e.props.from ? specOf(e.props.from.name) : undefined
    if (!spec || e.props.isExpanded) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="claude">● {label(spec)}</Text>
        <Box paddingLeft={2}>
          <Markdown text={e.props.text} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage', props: { text: SHOWN } }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
}
