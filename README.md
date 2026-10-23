<div align="center">

# aside

**Ask another model a quick question without leaving your Claude Code session.**<br>
A subagent with a fresh context answers in your chat. Your session's model, effort and prompt cache stay as they were.

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![claude code mod](https://img.shields.io/badge/claude%20code-mod-orange)](#install)

![aside in a Claude Code session](assets/demo.png)

</div>

```
$haiku what does git reset --soft do?          a quick fact, cheap and fast
$haiku:low where is the config parsed?         reads and searches the repo
$sonnet:max is this regex safe?                a second opinion that thinks hard
```

## Install

```
/plugin install aside --marketplace DzmitryShut/aside
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install aside --marketplace DzmitryShut/aside`. In the desktop app: **+** next to the prompt, **Plugins**, **Add marketplace**.

Requirements: Claude Code 2.1.302 or later (the version it was built and tested on), and access to the models you ask.

## Use

Start a prompt with `$`, a model and, if you like, an effort:

| Spec | Asks |
| --- | --- |
| `$haiku`, `$sonnet`, `$opus`, `$fable` | that model, at the session's effort |
| `$haiku:low`, `$low:haiku` | that model at that effort: `low`, `medium`, `high`, `xhigh` or `max` |
| `$claude-haiku-5-5` | a model by its full id, with or without an effort |

Your question stays in the transcript and the answer shows up under it:

```
❯ $haiku what does git reset --soft do? Two sentences.
● Asked haiku on the side.
● haiku
  git reset --soft <commit> moves the current branch pointer to the given commit but leaves the index
  and working tree untouched, so all changes from the undone commits stay staged. This lets you rewrite
  or combine recent commits without losing any work.
```

The session's model reads the answer too, so a later prompt can build on it: "what did haiku say, in five words?" works. The subagent runs in the background, so you can keep typing; `/tasks` lists it while it works. For a follow-up, open the finished aside in `/tasks` and send it a message: the same subagent answers with what it already knows, and the answer shows up in your chat the same way.

Under `claude -p` nothing draws the session, so the reply carries the answer: `claude -p '$haiku what is 7 times 7?'` prints `haiku:` and `49`.

A spec with no model, like `$low go`, is left to [once](https://github.com/DzmitryShut/once), which sets the effort for one prompt. Anything else goes through as typed, so `$HOME is wrong` and `costs $5` are safe.

## Why not switch the model?

Switching the session's model sends the whole conversation to a model that has none of it cached, so it is written into that model's cache from scratch. In a 160k Opus session one `$haiku` switch cost $0.160 against $0.085 for staying on Opus ([once's benchmark](https://github.com/DzmitryShut/once/blob/main/bench/results.md)).

aside never sends the conversation. The subagent starts with a short system prompt of its own, three read-only tools and your question, about 5k tokens of input, so a question costs the same in a 10k or a 200k session. Measured in an Opus session of about 45k tokens:

| Question | Subagent requests | Cost | Requests to the session's model |
| --- | ---: | ---: | ---: |
| `$haiku what does git reset --soft do? Two sentences.` | 1 | under $0.001 | 0 |
| `$sonnet:low where is the hand-back frame matched in hooks/register.tsx?` | 2, one Grep | $0.019 | 0 |

Claude Code 2.1.302, Claude Code's own estimates at API prices.

One thing still reaches the session's model: Claude Code's prompt suggestion, the grey guess for your next prompt, is a background request to it after a turn, and the turn an answer arrives in counts. Turn suggestions off in `/config` (**Prompt suggestions**) or with `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`, and an aside makes no request to the session's model at all.

## And `/btw`?

Claude Code's own `/btw` asks the session's model over the session's conversation, in one reply with no tools; a question that needs a file read gets "ask in the main conversation". aside asks the model you pick, without the conversation, and the subagent can read and search the repo.

## What it touches

- Hooks: `session.start`, `prompt.submit`, `agent.spawn`, `turn.step`, `turn.complete`, and `ui.render` for the hand-back row and one placeholder reply. Calls: `$.agent.register`, `$.agent.spawn`, `$.agent.list`, `$.session.messages`, `$.session.surfaces`, `$.tool.list`, `$.clock.after`, `$.ui.log`, `$.ui.resolve`.
- Reads prompts that start with `$` and a model, and the request's messages at the first step of a turn that may be its own. Changes only its own turns, which it answers with fixed text instead of a model request, and its own subagents' model and effort. It registers the agent type `aside:ask` for the session. Your settings and files stay as they are.
- Each question runs a subagent on the model you name, on your plan's usage or your API key like any other subagent. It can read and search files in the session's folder (Read, Glob, Grep) and cannot edit them or run commands; on a build without Glob or Grep, the read-only Explore agent stands in.
- The answer stays in the session as a hidden message the session's model reads in later prompts, with two short placeholder replies around it.
- No network or disk of its own: the subagent's requests go through Claude Code, and the only record is the session transcript Claude Code keeps.

## How it works

- The prompt goes in as typed, and aside answers the turn it starts with "Asked haiku on the side.", with no model request.
- Each subagent is named after its spec (`aside-haiku-low-k3f9`), which sets its model and its effort on every request it makes.
- The answer comes back as Claude Code's hand-back. aside answers the turn the hand-back starts too, draws the hand-back as the answer and hides that turn's placeholder reply; ctrl+o shows the raw message.
- An answer that lands while the session's model is busy is read there, with a note to leave it alone. A question typed while the model works gets a note that another model answers it.
- `aside:ask` stays in the main model's agent list, marked as aside's, because Claude Code resumes only a listed type and a follow-up from `/tasks` is a resume.
- With nothing drawing the session (`claude -p`), the subagent runs in the foreground and the reply carries the answer. A subagent that stops without an answer leaves a line saying so.

## Update and remove

Third-party marketplaces do not update on their own: run `claude plugin update aside@aside`, or turn on auto-update for the marketplace in `/plugin` under **Marketplaces**. Remove it with `claude plugin uninstall aside@aside`.

## Develop

```
claude --plugin-dir /path/to/aside
claude plugin validate --strict .
claude plugin test .
```

All of it is [`hooks/register.tsx`](hooks/register.tsx); the tests are [`tests/aside.test.ts`](tests/aside.test.ts).

## License

[MIT](LICENSE)
