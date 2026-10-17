# AGENTS.md

aside is a Claude Code mod: `$haiku <question>` asks another model in a read-only subagent and puts the answer in the chat. All logic is in `hooks/register.ts`.

## Check

- `claude plugin validate --strict .` must pass. Its `hooks:` and `calls:` lines must match the README's "What it touches".
- There are no tests yet. New ones go to `tests/*.test.ts` and run with `claude plugin test .` without spending tokens.
- Try it live: `claude --plugin-dir .`, then `$haiku say hi`. This spends real usage on the named model.

## Rules

- `$` plus an effort alone (`$low`) belongs to the once mod; aside takes a prefix only when it names a model.
- Bump `version` in `.claude-plugin/plugin.json` for every release, or installed copies will not update.
- Keep the plugin name `aside`: a renamed plugin is a new plugin for every install.
- `assets/*.png` are rendered from `assets/src/*.html` (social preview 1280x640, under 1 MB).
