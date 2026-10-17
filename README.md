<div align="center">

# aside

**Ask another model a side question without leaving your Claude Code session.**<br>
A subagent with a fresh context answers. Your session keeps its model, effort and prompt cache.

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![claude code mod](https://img.shields.io/badge/claude%20code-mod-orange)](#install)

![aside in a Claude Code session](assets/demo.png)

</div>

```
$haiku what does git reset --soft do?          a quick fact from a cheap model
$sonnet:low is \d+? lazy or greedy?            another model at low effort
$opus:max second opinion on this lock order    a clean context, thinks long
```

## Install

```
/plugin install aside --marketplace DzmitryShut/aside
```

Answer `y` to add the marketplace, then pick a scope. In a session that is already open, run `/reload-plugins`. From a shell: `claude plugin install aside --marketplace DzmitryShut/aside`.

Needs Claude Code 2.1.287 or later, the first version that runs mods, and access to the models you ask.

## Use

Start a prompt with `$` and a model: `$haiku`, `$sonnet`, `$opus`, `$fable` or a full id such as `$claude-haiku-5-5`. Add an effort after a colon: `$haiku:low`, `$sonnet:max`.

1. The prompt goes to a read-only subagent on that model. Your session's model never sees it.
2. The chat shows `Asked haiku on the side. The answer will show up here.`
3. When the subagent is done, its answer appears in the chat under `haiku › <your question>`.
4. The answer also stays in the conversation as a short note, so a later prompt can build on it: "use what haiku said".

A prefix without a model, such as `$low`, is not taken: that is [once](https://github.com/DzmitryShut/once), which sets the effort for one prompt on your own model. The two mods work side by side. Anything else goes through as typed, so `$HOME is wrong` and `costs $5` are safe.

## Why not `/model`?

`/model haiku` moves the whole session. The new model starts with an empty prompt cache and writes the entire conversation into its own. In once's benchmark, switching a single prompt to Haiku in a 160k-token session cost $0.160 against $0.085 for staying on Opus ([results](https://github.com/DzmitryShut/once/blob/main/bench/results.md)).

aside sends only your question. The subagent starts from the question alone plus whatever files it reads, and the main session's cache is never rewritten.

## What it touches

- Hooks: `prompt.submit`, `turn.start`, `turn.step` and `turn.complete`. Calls: `$.agent.spawn` and `$.session.append`, as `claude plugin validate` lists them.
- It reads every prompt you send and takes over only one that starts with `$` and a model. That prompt is dropped from the main session.
- It starts an `Explore` subagent (read-only tools) on the model you named. The subagent gets the question and a one-line instruction to answer briefly, not the conversation. It may read and search files in your project when the question needs it.
- The subagent's requests count against your own Claude plan or API credits, at the price of the model you picked.
- The answer is added to the main conversation as a note, so its tokens become part of the session's context.
- No network calls of its own. Nothing is written to disk.

## Update and remove

Third-party marketplaces do not update on their own: run `claude plugin update aside@aside`, or turn on auto-update for the marketplace in `/plugin` under **Marketplaces**. Remove it with `claude plugin uninstall aside@aside`.

## Develop

```
claude --plugin-dir /path/to/aside
claude plugin validate --strict .
```

All of it is [`hooks/register.ts`](hooks/register.ts).

## License

[MIT](LICENSE)
