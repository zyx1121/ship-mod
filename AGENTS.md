# ship-mod

Claude Code mod (a function-hooks plugin). `hooks/register.tsx` exports `register(on, options)`. It pulls the open pull requests from GitHub and the deploy notices from golem, and draws the `AbovePrompt` line, toasts and `/ship`. Read [README.md](README.md) first.

## Rules

- The loader rejects a hooks module that breaks an engine rule, and the whole mod then fails to load. Pass `$` only to a top-level function.
- The GitHub token comes from `gh auth token` and the golem token from the macOS keychain. Both stay in memory. Never write them to a file, a log or a toast.
- The first pull only learns the states. A new session must not replay old results.
- The panel shows only work that is under way or failed. Pull requests that only wait for a merge do not open it.
- A monitor that fails must show it: 3 failed pulls in a row show `unreachable`.
- Repository documents and code comments are English. No em dashes.

## Verify

```sh
bunx -p typescript tsc -p tsconfig.json
claude plugin validate .
claude plugin test .
```

No node_modules. `types/claude-code.d.ts` is the engine contract of the Claude Code version CI pins. Copy it from the `plugin-authoring` skill, do not edit it.

To run from source, use `claude --plugin-dir .`. A running session does not reload hooks, so restart it.

## Release

Release Please opens the release PR from Conventional Commits and bumps `.claude-plugin/plugin.json`. A pull request that Actions opens does not start CI: close it and reopen it.
