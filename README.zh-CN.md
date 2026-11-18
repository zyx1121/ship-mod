<!-- 翻译自 README.md @ docs/readme-template-v2。只翻 "For AI agents" 以上的章节，英文版更新时一起改。 -->

<div align="center">

<h1>ship-mod</h1>

<p><strong>你的 PR 与部署直接显示在 Claude Code 输入框上方，CI 或部署结束时弹出提示。</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/ship-mod/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/ship-mod/actions)
[![Release](https://img.shields.io/github/v/release/zyx1121/ship-mod?style=flat-square&sort=semver)](https://github.com/zyx1121/ship-mod/releases)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-mod-d97757?style=flat-square)](https://github.com/anthropics/claude-code/tree/main/mods)
[![License](https://img.shields.io/github/license/zyx1121/ship-mod?style=flat-square)](LICENSE)

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

</div>

```
╭─ SHIP ──────────────────────────────────────────────────────────────────╮
│ 1 failed  aintern #190   2 running  plugin #110  slide #42   7 ready    │
╰─────────────────────────────────────────────────────────────────────────╯
```

开了 PR 之后，通常就是等，然后回去看。ship-mod 用 1 次查询向 GitHub 问你所有开着的 PR，再向 [golem](https://golem.zyx.tw) 问部署，答案直接在画面上。

## 功能

- **输入框上方一个面板**：失败的 check 排最前，接着是运行中的 check、进行中的部署，最后是只等合并的 PR 数量。
- **没事就不出现**：没有东西在跑、也没有失败时，面板会消失。
- **变化时弹提示**：check 通过或失败、部署上线或失败各弹一次，新 session 不会重播旧结果。
- **沉默也看得见**：连续 3 次拉取失败会显示 `github unreachable` 或 `golem unreachable`，框线变红。

## 快速开始

Function hooks 还在 early access。在 shell profile 或 `settings.json` 的 `env` 打开：

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

接着在 Claude Code 安装：

```
/plugin marketplace add zyx1121/ship-mod
/plugin install ship-mod@ship-mod
```

开一个新 session。mod 用 `gh auth token` 读 GitHub token，所以要先 `gh auth login`。token 只留在内存。

## 用法

```
/ship           列出 PR 与部署，附链接
```

## 设置

| 设置 | 默认 | 作用 |
|--------|---------|------|
| `days` | `2` | 超过这个天数的 PR 与失败部署不显示 |
| `pollSeconds` | `30` | 每次拉取间隔秒数，最少 10 |
| `golemUrl` | `https://golem.zyx.tw` | golem 的地址 |
| `keychainService` | `kilo/golem-mcp` | 存 golem token 的 keychain 条目 |

## 运作方式

- `hooks/register.tsx` 在 `session.start` 注册 `/ship`，定时拉取，并在 `AbovePrompt` 画面板。
- 1 次 GraphQL 查询搜索你开的 PR，以及 bot 在你的 repo 开的 PR，读每个 PR 最后一个 commit 的 check 汇总。每次花 1 点，每小时额度 5000 点。
- 部署来自 golem 的 `GET /notices`。从 `deploy.started` 到 `deploy.live` 或 `deploy.failed` 之间算进行中，最多 15 分钟。
- 第一次拉取只记下状态，之后每次拉取才提示变化。

## 限制

- 没有 check 的 PR 不显示。
- 机器上没有 golem token 时，面板只显示 PR。
- 每个开着的 session 各自拉取与提示。开 5 个 session 会看到 5 次提示。

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
