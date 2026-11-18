<!-- 翻譯自 README.md @ docs/readme-template-v2。只翻 "For AI agents" 以上的章節，英文版更新時一起改。 -->

<div align="center">

<h1>ship-mod</h1>

<p><strong>你的 PR 與部署直接顯示在 Claude Code 輸入框上方，CI 或部署結束時跳出提示。</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/ship-mod/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/ship-mod/actions)
[![Release](https://img.shields.io/github/v/release/zyx1121/ship-mod?style=flat-square&sort=semver)](https://github.com/zyx1121/ship-mod/releases)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-mod-d97757?style=flat-square)](https://github.com/anthropics/claude-code/tree/main/mods)
[![License](https://img.shields.io/github/license/zyx1121/ship-mod?style=flat-square)](LICENSE)

[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

</div>

```
╭─ SHIP ──────────────────────────────────────────────────────────────────╮
│ 1 failed  aintern #190   2 running  plugin #110  slide #42   7 ready    │
╰─────────────────────────────────────────────────────────────────────────╯
```

開了 PR 之後，通常就是等，然後回去看。ship-mod 用 1 次查詢向 GitHub 問你所有開著的 PR，再向 [golem](https://golem.zyx.tw) 問部署，答案直接在畫面上。

## 功能

- **輸入框上方一個面板**：失敗的 check 排最前，接著是執行中的 check、進行中的部署，最後是只等合併的 PR 數量。
- **沒事就不出現**：沒有東西在跑、也沒有失敗時，面板會消失。
- **變化時跳提示**：check 通過或失敗、部署上線或失敗各跳一次，新 session 不會重播舊結果。
- **沉默也看得見**：連續 3 次拉取失敗會顯示 `github unreachable` 或 `golem unreachable`，框線變紅。

## 快速開始

Function hooks 還在 early access。在 shell profile 或 `settings.json` 的 `env` 打開：

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

接著在 Claude Code 安裝：

```
/plugin marketplace add zyx1121/ship-mod
/plugin install ship-mod@ship-mod
```

開一個新 session。mod 用 `gh auth token` 讀 GitHub token，所以要先 `gh auth login`。token 只留在記憶體。

## 用法

```
/ship           列出 PR 與部署，附連結
```

## 設定

| 設定 | 預設 | 作用 |
|--------|---------|------|
| `days` | `2` | 超過這個天數的 PR 與失敗部署不顯示 |
| `pollSeconds` | `30` | 每次拉取間隔秒數，最少 10 |
| `golemUrl` | `https://golem.zyx.tw` | golem 的位址 |
| `keychainService` | `kilo/golem-mcp` | 存 golem token 的 keychain 項目 |

## 運作方式

- `hooks/register.tsx` 在 `session.start` 註冊 `/ship`，定時拉取，並在 `AbovePrompt` 畫面板。
- 1 次 GraphQL 查詢搜尋你開的 PR，以及 bot 在你的 repo 開的 PR，讀每個 PR 最後一個 commit 的 check 總結。每次花 1 點，每小時額度 5000 點。
- 部署來自 golem 的 `GET /notices`。從 `deploy.started` 到 `deploy.live` 或 `deploy.failed` 之間算進行中，最多 15 分鐘。
- 第一次拉取只記下狀態，之後每次拉取才提示變化。

## 限制

- 沒有 check 的 PR 不顯示。
- bot 在組織 repo 開的 PR 不顯示：搜尋範圍是你自己開的 PR，加上你帳號底下的 repo。
- 機器上沒有 golem token 時，面板只顯示 PR。
- 每個開著的 session 各自拉取與提示。開 5 個 session 會看到 5 次提示。

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
