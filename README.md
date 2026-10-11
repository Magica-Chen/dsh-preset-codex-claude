# dsh-preset-codex-claude

<p>
  <img alt="License: MIT" src="https://img.shields.io/github/license/Magica-Chen/dsh-preset-codex-claude.svg">
  <a href="https://github.com/Magica-Chen/dsh-preset-codex-claude/actions/workflows/verify.yml"><img alt="CI: passing" src="https://img.shields.io/github/actions/workflow/status/Magica-Chen/dsh-preset-codex-claude/verify.yml?branch=main&label=verify"></a>
  <img alt="DeepSeek Harness agent preset" src="https://img.shields.io/badge/DeepSeek%20Harness-agent%20preset-blue.svg">
  <img alt="Node >= 18" src="https://img.shields.io/badge/node-%3E%3D18-339933.svg">
  <img alt="Codex subagent" src="https://img.shields.io/badge/Codex-subagent-000000.svg">
  <img alt="Claude Code subagent" src="https://img.shields.io/badge/Claude%20Code-subagent-D97757.svg">
</p>

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **agent preset** that offers
**Codex** and **Claude Code** as delegation subagents, each at a read-only and a full-access tier —
so one session can use either worker, or dispatch both at once on the same task.

```text
subagent_codex               Codex        full access
subagent_codex_readonly      Codex        read-oriented
subagent_claude_code         Claude Code  full access
subagent_claude_readonly     Claude Code  hard read-only
```

It uses the **official** `@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code`
providers — no reimplementation. Codex runs over its own `app-server` protocol; Claude Code runs over
the official Agent SDK.

## What this gives you

DeepSeek Harness normally hands one model the whole task. This preset adds two *external* workers you
can delegate to from inside a session:

- **Pick the worker per task.** Codex and Claude Code have different strengths and different failure
  modes. You are no longer choosing one for the whole conversation.
- **Pick the permission tier per task.** Each vendor is registered twice — a read-only tier for
  analysis and a full-access tier for changes that need to write files and run tests.
- **Run both at once.** The delegation tools accept `run_in_background`, so you can dispatch Codex and
  Claude Code on independent parts of the same problem, then reconcile their answers.

It is a thin, declarative layer: four provider registrations and four tools, all using the official
providers. No forks, no wrappers, no reimplementation of either agent.

```text
                    ┌─────────────────────────────┐
   your session ───▶│ subagent_codex              │  Codex        full access
   (any model)      │ subagent_codex_readonly     │  Codex        read-oriented
                    │ subagent_claude_code        │  Claude Code  full access
                    │ subagent_claude_readonly    │  Claude Code  hard read-only
                    └─────────────────────────────┘
```

---

## ⚠️ Read this first: the install is two steps

This preset's provider rows are resolved by the DSH loader against the **dsh installation directory**,
*not* your profile. A profile-installed bundle cannot reach them. That is why this is not a
one-command install, and why the preset alone will show **“Failed to load”** if the providers are
missing.

**Step 1 — install the provider packages into the dsh installation.**
Re-run this after every DSH upgrade, because an upgrade will drop them:

```bash
DSH_INSTALL="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
npm install --no-save --prefix "$DSH_INSTALL" \
  @deepseek-ai/dsh-subagent-codex@0.2.0-rc.2 \
  @deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2
```

Version matching is not cosmetic. If a provider resolves to a different version than the host, it
registers into its **own** copy of the `ctx.subagents` service instead of the host singleton, and
delegation fails silently. `doctor` checks this.

**Step 2 — install this preset into your profile:**

```bash
dsh plugin --profile web add github:Magica-Chen/dsh-preset-codex-claude
```

Then verify. This package is not on npm, so run the preflight from the installed copy:

```bash
node "$HOME/.dsh/profiles/web/node_modules/dsh-preset-codex-claude/bin/doctor.mjs"
```

Restart dsh and create a **new** session — the mode appears in the preset picker.

> No git? You can also clone the repo and point `dsh plugin add` at the local directory:
> `dsh plugin --profile web add file:/path/to/dsh-preset-codex-claude`

## Requirements

- Node ≥ 18
- A DSH **web** profile (`dsh web`)
- At least one product CLI on `PATH`, authenticated:
  - `codex` — `codex login` (or `OPENAI_API_KEY`)
  - `claude` — `claude login` (or `ANTHROPIC_API_KEY`)

You do not need both. Tiers whose CLI is absent simply cannot run.

## Use

Pick **“Codex + Claude Code”** in the mode selector of a new session, then delegate:

```text
subagent_codex task="Run the test suite and fix the two failures in parser.js"
subagent_claude_code task="Review the diff on this branch for security issues"
```

Every subagent starts **fresh without your conversation**, so its prompt must be self-contained.

Both products accept `run_in_background`, so a session can dispatch both independently and reconcile
the results. Pairing is *offered*, not mandated — the persona says so explicitly.

### Permission tiers — what they actually mean

| Tool | Native mode | Writes files | Runs commands |
|---|---|---|---|
| `subagent_claude_code` | `bypassPermissions` | ✅ | ✅ |
| `subagent_claude_readonly` | `dontAsk` | ❌ | ❌ (Bash denied) |
| `subagent_codex` | `dangerously-bypass-approvals-and-sandbox` | ✅ | ✅ |
| `subagent_codex_readonly` | `never` | inherits your `~/.codex` config | inherits |

Two of these are counter-intuitive, and both are consequences of running unattended:

- **Claude's read-only tier is a hard block.** Every non-bypass mode installs
  `canUseTool: () => deny`, and with no human attached anything needing approval is refused — including
  **Bash**. So a Claude subagent cannot run tests or builds unless it is in `bypassPermissions`.
  `acceptEdits` is not a middle ground: it auto-accepts file writes and still denies Bash.
- **Codex's read-only tier is advisory, not enforced.** The `never` mode sends no `sandbox` field, so
  Codex inherits whatever your own Codex config says. Only Claude's tier is a guarantee.

## Caveats

- **An existing session keeps the preset it started with.** You must create a new session after
  installing; restarting dsh alone does not retro-fit open conversations.
- **A broken preset is cached for the life of the process.** If it failed to load, reloading the page
  will not help — restart dsh.
- **Delegation is one-shot.** These providers expose no continuable mode, so you cannot `send_message`
  to a Codex/Claude child afterwards (unlike in-harness `subagent` / `subagent_fork`).
- **The full-access tiers are genuinely unrestricted**: `--dangerously-bypass-approvals-and-sandbox`
  and `--bypassPermissions`. That is what makes them useful unattended, and it means they can modify
  anything the process can reach. Prefer the read-only tiers when you only need analysis.
- These providers declare `NO_START_CAPABILITIES`, so per-child `toolFilter` and `persona` are **not**
  available. Permission level is fixed per provider registration, which is why this preset registers
  each vendor twice rather than exposing one provider with a switch.

## How it works

The preset declares four host-plane provider registrations plus four delegation tools. Providers
register on the process-wide `ctx.subagents` singleton, so their names must stay unique across the
whole process — hence the distinct `codex-readonly` / `claude-readonly` names.

`cordis.patch.yml` is **generated**. `generate-patch.py` holds the canonical row list and the persona,
and is the single source of truth; it writes the patch atomically so the installed copy is never
partially written. To change the mode, edit the generator and run:

```bash
npm run build      # python3 generate-patch.py
```

### The preflight

`bin/doctor.mjs` exists to replace an otherwise opaque failure. It verifies the installation anchor
resolves, that both providers resolve **from the installation** at the host's exact version, that the
CLIs are present and authenticated, and that the preset declaration is structurally sound — including
that the `plan-mode` row carries its **required** `section` guidance. (Omitting that one config fails
the entire preset to load, with a message that never explains why.)

```
bin/doctor.mjs
  ✓ node 24.7.0
  ✓ dsh installation: …/node_modules/@deepseek-ai/dsh
  ✓ @deepseek-ai/dsh-subagent-codex@0.2.0-rc.2
  ✓ 4 providers declared: codex, codex-readonly, claude-code, claude-readonly
  ✓ 4 delegation tools: subagent_codex, subagent_codex_readonly, …
```

It exits non-zero when something must be fixed, and prints the exact command to fix it.

## Uninstall

```bash
dsh plugin --profile web remove dsh-preset-codex-claude
```

To also remove the providers:

```bash
DSH_INSTALL="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
npm uninstall --no-save --prefix "$DSH_INSTALL" \
  @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-claude-code
```

## Compatibility

Pinned to **dsh `0.2.0-rc.2`** and provider `0.2.0-rc.2`. Other dsh releases will likely need matching
provider versions; `doctor` reports a mismatch rather than letting it fail silently. Note that npm's
`latest` tag for these packages is an older `0.0.1-rc.1`, so always pin explicitly.

## License

MIT
