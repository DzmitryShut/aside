import type { Register } from 'claude-code'

// `$haiku what does git reset --soft do?`: the question goes to a read-only
// subagent on that model, with a fresh context, and never to the session's
// own model. The answer is shown in the chat and handed to the main model
// for later prompts. The session's model, effort and prompt cache stay as
// they were: the subagent does not carry the conversation.

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

const MODELS = ['opus', 'sonnet', 'haiku', 'fable']

type Ask = { model: string; effort?: Effort; question: string }

const PREFIX = /^\$([\w.:-]+)\s+(\S[\s\S]*)$/

const isEffort = (s: string): s is Effort => (EFFORTS as readonly string[]).includes(s)
const isModel = (s: string) => MODELS.includes(s) || /^claude-[\w.-]+$/.test(s)

// Only a spec that names a model is ours; `$low` alone is left to once.
function parse(text: string): Ask | undefined {
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

const brief = (ask: Ask) =>
  `Answer the user's question directly and briefly. Read files or search only when the question needs it.\n\nQuestion: ${ask.question}`

const label = (ask: Ask) => (ask.effort ? `${ask.model} · ${ask.effort}` : ask.model)

export const register: Register = on => {
  // Questions sent, by the prompt their subagent starts with, until its run
  // starts and gives its id; then by that id until it answers.
  const starting = new Map<string, Ask>()
  const running = new Map<string, Ask>()

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const ask = parse(e.text)
    if (!ask) return next(e)
    const prompt = brief(ask)
    starting.set(prompt, ask)
    const spawned = await $.agent.spawn({
      prompt,
      description: `aside: ${ask.question.slice(0, 40)}`,
      subagentType: 'Explore',
      model: ask.model,
    })
    if (spawned.deny !== undefined) {
      starting.delete(prompt)
      return { drop: `aside: ${ask.model} could not start: ${spawned.deny}` }
    }
    if (spawned.agentId && !running.has(spawned.agentId)) {
      starting.delete(prompt)
      running.set(spawned.agentId, ask)
    }
    return { drop: `Asked ${label(ask)} on the side. The answer will show up here.` }
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    const ask = e.agentId !== undefined ? starting.get(e.text) : undefined
    if (ask && e.agentId !== undefined) {
      starting.delete(e.text)
      running.set(e.agentId, ask)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const effort = e.agentId !== undefined ? running.get(e.agentId)?.effort : undefined
    return yield* next(effort ? { ...e, effort } : e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const ask = e.agentId !== undefined ? running.get(e.agentId) : undefined
    if (!ask || e.agentId === undefined) return result
    running.delete(e.agentId)
    const answer = e.answer.trim() || `(no answer: ${e.reason})`
    await $.session.append({
      message: { type: 'system', content: [{ type: 'text', text: `${label(ask)} › ${ask.question}\n\n${answer}` }] },
    })
    await $.session.append({
      message: {
        type: 'user',
        content: [
          {
            type: 'text',
            text: `[aside] The user asked ${ask.model} a side question, not you: "${ask.question}". Its answer, already shown to the user:\n\n${answer}\n\nDo not reply to this note. Use it if a later prompt needs it.`,
          },
        ],
      },
    })
    return result
  })
}
