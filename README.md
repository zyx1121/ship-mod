<div align="center">

<h1>ship-mod</h1>

<p><strong>Your pull requests and deploys above the Claude Code prompt, with a toast when CI or a deploy ends.</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/ship-mod/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/ship-mod/actions)
[![Release](https://img.shields.io/github/v/release/zyx1121/ship-mod?style=flat-square&sort=semver)](https://github.com/zyx1121/ship-mod/releases)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-mod-d97757?style=flat-square)](https://github.com/anthropics/claude-code/tree/main/mods)
[![License](https://img.shields.io/github/license/zyx1121/ship-mod?style=flat-square)](LICENSE)

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

</div>

```
╭─ SHIP ──────────────────────────────────────────────────────────────────╮
│ 1 failed  aintern #190   2 running  plugin #110  slide #42   7 ready    │
╰─────────────────────────────────────────────────────────────────────────╯
```

You open a pull request, then you wait and check. ship-mod asks GitHub for every open pull request of yours in one query, and asks [golem](https://golem.zyx.tw) for deploys, so the answer is already on screen.

## Features

- **One panel above the prompt**: failed checks first, then running checks, then deploys under way. The count of pull requests that only wait for a merge comes last.
- **Quiet when idle**: the panel is gone when nothing runs and nothing failed.
- **A toast on change**: checks that pass or fail, a deploy that goes live or fails. A new session does not replay old results.
- **Silence is visible**: 3 failed pulls in a row show `github unreachable` or `golem unreachable` and turn the border red.

## Quick start

Function hooks are in early access. Turn them on in your shell profile, or in `settings.json` under `env`:

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

Then install the mod in Claude Code:

```
/plugin marketplace add zyx1121/ship-mod
/plugin install ship-mod@ship-mod
```

Start a new session. The mod reads the GitHub token from `gh auth token`, so sign in with `gh auth login` first. It keeps the token in memory only.

## Usage

```
/ship           list the pull requests and deploys, with their links
```

## Configuration

| Setting | Default | Does |
|--------|---------|------|
| `days` | `2` | pull requests and failed deploys older than this are left out |
| `pollSeconds` | `30` | seconds between pulls, 10 at least |
| `golemUrl` | `https://golem.zyx.tw` | where golem runs |
| `keychainService` | `kilo/golem-mcp` | the keychain item that holds the golem token |

## How it works

- `hooks/register.tsx` registers `/ship` on `session.start`, pulls on a timer and draws the panel on `AbovePrompt`.
- One GraphQL query searches the open pull requests you wrote, and the ones a bot opened in your repositories, and reads the check rollup of each last commit. It costs 1 point of the 5000 an hour.
- golem's `GET /notices` gives the deploys. A deploy is under way from `deploy.started` until `deploy.live` or `deploy.failed`, for 15 minutes at most.
- The first pull only learns the states. Each later pull toasts what changed.

## Limits

- A pull request without checks is left out.
- Without a golem token on the machine, the panel shows pull requests only.
- Each open session pulls and toasts on its own. With 5 sessions, you see 5 toasts.

## For AI agents

Facts for coding agents and LLM tools. The rules for changing the code are in [AGENTS.md](AGENTS.md).

- **Summary**: Claude Code function-hooks mod that shows pull requests with running or failed checks, and deploys under way, above the prompt and as toasts.
- **Type**: plugin
- **Interfaces**: slash command `/ship`, `AbovePrompt` UI panel, `ui.toast`
- **Install**: `/plugin marketplace add zyx1121/ship-mod`, then `/plugin install ship-mod@ship-mod`
- **Run**: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`
- **Verify**: `bunx -p typescript tsc -p tsconfig.json && claude plugin test .`
- **Config**: plugin options `days`, `pollSeconds`, `golemUrl`, `keychainService`
- **Secrets**: the GitHub token from `gh auth token` and the golem token from the macOS keychain, both kept in memory. Never written to a file, a log or a toast.
- **Limits**: needs the `gh` CLI signed in. Deploys need golem with `GET /notices` and macOS.

## Development

```sh
bunx -p typescript tsc -p tsconfig.json     # typecheck
claude plugin test .                        # the engine's test harness
```

`types/claude-code.d.ts` is the engine contract of Claude Code 2.1.327. Copy it, do not edit it. Release Please opens the release PR.

## License

[MIT](LICENSE)
