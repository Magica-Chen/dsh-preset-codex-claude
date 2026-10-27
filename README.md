# dsh-preset-codex-claude

[![License: MIT](https://img.shields.io/github/license/Magica-Chen/dsh-preset-codex-claude.svg)](https://github.com/Magica-Chen/dsh-preset-codex-claude/blob/main/LICENSE)
[![verify](https://img.shields.io/github/actions/workflow/status/Magica-Chen/dsh-preset-codex-claude/verify.yml?branch=main&label=verify)](https://github.com/Magica-Chen/dsh-preset-codex-claude/actions/workflows/verify.yml)
![DeepSeek Harness agent preset](https://img.shields.io/badge/DeepSeek%20Harness-agent%20preset-blue.svg)
![Node.js 22.12.0+](https://img.shields.io/badge/Node.js-22.12.0%2B-339933.svg)
![Codex subagent](https://img.shields.io/badge/Codex-subagent-000000.svg)
![Claude Code subagent](https://img.shields.io/badge/Claude%20Code-subagent-D97757.svg)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **agent preset** that offers
**Codex** and **Claude Code** as delegation subagents, each with an unattended native-policy tier and
an explicit full-access tier. One session can use either worker or dispatch both on independent tasks.

```text
subagent_codex               Codex        bypass approvals and sandbox
subagent_codex_readonly      Codex        never ask; native sandbox configuration
subagent_claude_code         Claude Code  bypass permission checks
subagent_claude_readonly     Claude Code  dontAsk; native authorization rules
```

**The `_readonly` tool names are historical labels, not security guarantees.** Neither tier is a
DSH-enforced read-only sandbox. See [Permission tiers](#permission-tiers--what-they-actually-mean).

The preset uses the **official** `@deepseek-ai/dsh-subagent-codex` and
`@deepseek-ai/dsh-subagent-claude-code` providers — no reimplementation. Codex runs over its own
`app-server` protocol; Claude Code runs over the official Agent SDK.

## What this gives you

- **Pick the worker per task.** Delegate a self-contained task to either product without changing the
  parent session's model.
- **Pick the native permission policy.** Use the unattended policy tier or explicitly bypass native
  permission checks. The policy is fixed per provider registration, not chosen by each tool call.
- **Run independent tasks concurrently.** In DSH `0.2.1-rc.3`, delegation returns a child id promptly;
  the runtime delivers the result in a completion notice. There is no `run_in_background` argument.
- **Keep in-harness delegation.** The preset also includes ordinary `subagent` and `subagent_fork`.

It is a declarative bundle: four Host provider registrations and four preset-scoped product tools,
plus the standard coding tools. It does not wrap or fork either product.

## Install

The provider packages are dependencies of this bundle, both declared as **`^0.2.1-rc.3`**. These
ranges can select newer prereleases whose DSH requirements differ from your installed host.

**For the tested DSH `0.2.1-rc.3` baseline**, first install matching provider bundles:

```bash
dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex@0.2.1-rc.3
dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.3
```

Then install this preset into the same Web profile:

```bash
dsh plugin --profile web add github:Magica-Chen/dsh-preset-codex-claude
```

DSH composes its runtime package resolution from the installation and selected bundles' dependency
graphs. You do **not** need to copy these providers into the global DSH installation or run
`npm install --prefix` there. Installation-provided packages take precedence in DSH's runtime table;
other selected bundles can also affect which package is selected.

If you already have a checkout, the local-directory alternative is:

```bash
dsh plugin --profile web add file:/path/to/dsh-preset-codex-claude
```

Follow any restart requirement reported by DSH. When replacing an installed version, use the Plugins
page or the supported remove/add operations rather than overwriting its runtime files. Create a
**new session** and select **“Codex + Claude Code”** to validate the current preset revision.

Optionally run the static preflight from the installed copy:

```bash
node "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/dsh-preset-codex-claude/bin/doctor.mjs"
```

Adjust the profile name or installation location as appropriate. Passing preflight does not prove
that the live preset mounted or that a product can authenticate and execute a task.

## Requirements

- Node **≥ 22.12.0** and a compatible DSH installation; the target baseline is **`0.2.1-rc.3`**.
- A DSH Web profile for the preset picker.
- The providers' bundled native platform payloads, installed with their optional dependencies.
- Native Codex and/or Claude Code configuration and authentication for the workers you intend to use.

A separate `codex` or `claude` executable on `PATH` is **not** the runtime requirement. The providers
ship pinned product runtimes and do not fall back to a host CLI. A host CLI can be useful for managing
native login/settings, but its presence, version, or login status does not verify the bundled worker.

Native user/project settings remain authoritative. Credential-shaped ambient environment variables
are scrubbed before child startup; an API key intended for a worker must be supplied through that
provider's explicit `env` configuration. Do not commit credentials to this bundle or its generated
patch. The preflight neither reads credentials nor attempts authentication.

## Use

Pick **“Codex + Claude Code”** for a new session, then ask the parent agent to delegate. For example,
the product tools accept self-contained prompts:

```text
subagent_codex(
  description="Fix parser tests",
  prompt="Run the parser tests, investigate the two failures, and make the smallest fix."
)

subagent_claude_readonly(
  description="Review parser changes",
  prompt="Review the parser diff for correctness. Do not edit files or run mutating commands."
)
```

The second prompt is a task instruction, not an enforcement boundary. Check the worker's native
settings or use an independently enforced sandbox when non-modification is mandatory.

Each product worker starts **fresh without your conversation**. Calls return child ids; the parent
receives completion notices and can continue independent work in the meantime. Pairing is offered,
not mandated. Codex/Claude executions are one-shot and do not accept `send_message` follow-ups.

### Permission tiers — what they actually mean

| Tool | Native mode | What is enforced by the provider |
|---|---|---|
| `subagent_claude_code` | `bypassPermissions` | Explicitly bypasses native permission checks |
| `subagent_claude_readonly` | `dontAsk` | Denies operations that are not already authorized, rather than prompting |
| `subagent_codex` | `dangerously-bypass-approvals-and-sandbox` | Sets `approvalPolicy: never` and `sandbox: danger-full-access` |
| `subagent_codex_readonly` | `never` | Sets `approvalPolicy: never`; sends no sandbox override |

- **Codex `never` is not read-only.** Its sandbox comes from native Codex configuration. Disabling
  approval prompts does not itself forbid writes or commands.
- **Claude `dontAsk` is not a blanket denylist for Write/Edit/Bash.** Native settings and existing
  authorization still apply. The unattended callback denies permission requests; that alone does
  not prove that every side-effecting tool must request permission.
- **Full-access tiers deliberately bypass safeguards.** They can modify files and external systems
  reachable by the child process. DSH's parent-session file policy is not a substitute for these
  external workers' native permission systems.

## Caveats

- **Preset revisions are retained by live Agents.** A live session keeps its existing revision when
  the declaration changes; newly created Agents can use the updated revision. Old implementations
  are not retained across process restarts: recovery uses the currently available definition.
- **A browser refresh is not a package reload.** Follow DSH's installation/activation diagnostics and
  restart when requested. A failed definition can be replaced or repaired; it is not universally
  cached as broken for the entire process lifetime.
- **Do not enable two bundles declaring the same preset id.** In particular, migrate the old local
  multiagent bundle rather than enabling it alongside this package if both declare `codex-claude`.
- **Official provider bundles also expose global tools in rc.3.** This preset uses namespaced Host
  provider names. Its scoped tools shadow same-named global tools for its Agents; users of other
  presets may still see global tools from separately enabled official bundles.
- **Native settings and payloads matter.** Missing optional payloads, unsupported platforms, native
  project settings, and authentication can still cause delegation failure after static checks pass.
- **Capabilities are limited.** Product calls do not choose a child preset or DSH model route, and
  cannot supply DSH child personas, tool filters, output schemas, or a harness-enforced depth cap.
  `maxDepth: provider-managed` leaves nested product behavior to the native runtime.
- **Cancellation is not rollback.** There is no side-effect rollback or provider wall-clock timeout.
  Cancelling a worker does not undo files or external systems it has already changed.

## How it works

The bundle declares four namespaced provider instances as **Host rows**, separate from the agent
preset's scoped tool rows. This avoids re-registering process-wide provider names for every retained
preset revision. Tool names remain short and stable.

[cordis.patch.yml](cordis.patch.yml) is generated. [generate-patch.py](generate-patch.py) holds the
canonical rows and persona; edit the generator and regenerate instead of editing the patch by hand:

```bash
npm run build      # python3 generate-patch.py
```

### The preflight

[bin/doctor.mjs](bin/doctor.mjs) performs **static structural and dependency checks** without loading
provider code or starting a model:

- Locates DSH through its executable path, or an explicit `DSH_PRESET_CC_INSTALL` directory.
- Looks for provider package manifests from the DSH installation first, then from this bundle's own
  dependency location. Reports the source and observed version, rather than requiring equal package
  version strings or claiming that a mismatch creates a separate service singleton.
- Checks the preset declaration, unique row ids and provider names, the four product tool bindings,
  and the actual `plan-mode` row's non-empty `config.section`.
- Parses Loader `!!js` scalars as inert data; it does not evaluate them.

This deliberately limited lookup **does not reproduce the active profile's complete resolution
table**, compatibility admission, native payload loading, or live activation. A provider found on
disk is not proof that the running profile selected it. Authentication, native settings, effective
permissions, and delegation remain unverified. A different observed version is a diagnostic, not
an automatic proof of compatibility or incompatibility.

Exit `0` means the static checks passed, possibly with warnings. Exit `1` means a static check failed.
Use `--help` for the installation and baseline overrides. Do not treat either the doctor or the
repository's structural tests as an end-to-end product test.

## Uninstall

```bash
dsh plugin --profile web remove dsh-preset-codex-claude
```

This removes the preset bundle through DSH's package management. Separately installed official
provider bundles remain separate installations; remove those through DSH if they are no longer
wanted. Do not manually uninstall packages from DSH's global installation for this preset.

## Compatibility

The target baseline is **DSH `0.2.1-rc.3`**, with both provider dependencies declared as
**`^0.2.1-rc.3`**. These are caret ranges, not exact pins: a later dependency resolution can select
another satisfying release. Provider compatibility is governed by its declared `engines.dsh` or
DSH peer requirements, which DSH checks at composition boundaries. For example, providers
`0.2.1-rc.4` satisfy the caret range but declare exact rc.4 DSH peers; they must not be assumed compatible
with an rc.3 host. The baseline installation commands above explicitly select the rc.3 provider
bundles. Updating the host or dependencies still requires reviewing the selected versions and
checking actual activation; do not bypass a compatibility refusal just to make the preset load.

Upstream contracts for this baseline:

- [Codex provider rc.3 documentation](https://unpkg.com/@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3/README.md)
- [Claude Code provider rc.3 documentation](https://unpkg.com/@deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.3/README.md)
- [DSH package loading documentation](https://unpkg.com/@deepseek-ai/dsh-app-boot@0.2.1-rc.3/README.md)

## License

MIT
