# AGENTS.md

aside is a Claude Code mod: `$haiku <question>` sends the question to a read-only subagent (`aside:ask`) on that model and effort, with the question as its only context, and draws the answer in the chat. The session's own model gets no request for those turns. All logic is in `hooks/register.tsx`; the tests are `tests/aside.test.ts`.

## Check

- `claude plugin validate --strict .` must pass. Its `hooks:` and `calls:` lines must match the README's "What it touches".
- `claude plugin test .` runs `tests/aside.test.ts` against the engine. It spends no tokens.
- `npx -y -p typescript@5.6.3 tsc -p .` type-checks the module and the tests. It needs `.claude-plugin/types/`, which Claude Code writes when it loads the mod with `--plugin-dir`; on a fresh clone, start a session that way once.
- Try it live: `claude --plugin-dir .`, then `$haiku say hi`. This spends real usage on the named model, and on the session's model for every prompt that is not an aside. The drawn answer only shows in an interactive session.
- Read the outcome in the transcript, `~/.claude/projects/<dir>/<session>.jsonl`: turns aside answered have assistant rows with `msg_hook_` ids and no `api-request` row. The subagent's `subagents/agent-*.jsonl` has `api-request` rows with its model and `output_config.effort`.

## Rules

- `$` plus an effort alone (`$low go`) belongs to the once mod; aside takes a prefix only when it names a model.
- On a turn aside answers, `turn.step` must never fall through to `next(e)`: that is a request to the session's model. Decide from the request's messages (`$.session.messages({ as: 'api' })`), not from `turn.start`, which can arrive after the first step.
- Keep `aside:ask` offered: Claude Code resumes only an offered type, and a follow-up from `/tasks` is a resume.
- Bump `version` in `.claude-plugin/plugin.json` for every release, or installed copies will not update.
- Keep the plugin name `aside`: a renamed plugin is a new plugin for every install.
- `assets/social.png` is rendered from `assets/src/social.html` (1280x640, under 1 MB). `assets/demo.png` has no source in the repo.

## Pitfalls from live runs

- In a PowerShell pane, `$env:NAME="..."` stays set for every later `claude` started there. A leftover `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` makes every spawn run in the foreground and empties `/tasks`. Use a fresh pane for each environment.
- Do not press ← at an empty prompt during a test. It opens the agents view; after that `/exit` moves the conversation to the background instead of quitting, and text sent to the pane starts new sessions.
- Saving a file under `--plugin-dir` reloads the module, and a reload between `prompt.submit` and `turn.step` loses its maps. Wait a few seconds after a save before the next prompt.
- `claude -p` waits for background work but never runs a hand-back as a turn. That is why a session with no surface spawns in the foreground.
- Claude Code's prompt suggestion is a background request to the session's model after every turn, aside's included. Set `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` when measuring what aside costs.
