#!/usr/bin/env python3
"""Generate cordis.patch.yml declaring the `codex-claude` agent preset.

The plugin row list below is the single source of truth for the mode's tool
surface; the persona is rendered from PRESETS. The file is generated rather than
hand-edited so the header, comments, and row set cannot drift apart.

Writes to a temp file and atomically replaces the target, because the profile
hardlinks the installed bundle's files: an in-place rewrite would corrupt the
profile's copy.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "cordis.patch.yml")

HEADER = """# Bundle patch: one `@deepseek-ai/dsh-agent-preset` declaration that adds a
# `codex-claude` mode to the Web preset roster.
#
# The mode offers Codex and Claude Code as delegation subagents, each at a
# read-only and a full-access tier, plus the in-harness `subagent` /
# `subagent_fork`. Both products can be dispatched at once — the delegation tool
# accepts `run_in_background` because its `enableRunInBackground` defaults true —
# so independent work can come back in parallel and be reconciled afterward.
# Pairing is OFFERED, not mandated.
#
# It mounts the two OPT-IN product-subagent providers — Codex (official
# app-server protocol) and Claude Code (official Agent SDK) — at the HOST service
# seam `ctx.subagents`. Each vendor is registered TWICE at a different native
# permission tier so one session can pick the right level PER TASK. Both
# providers declare `NO_START_CAPABILITIES`, so a per-child `toolFilter`/`persona`
# is NOT available; the permission mode is fixed when the provider is registered,
# which is why two instances exist per vendor.
#
# Tier semantics (verified against the provider sources, not the docs):
#
#   claude-readonly  permissionMode `dontAsk`  -> Write/Edit/Bash all denied.
#                    Hard read-only: there is no human to approve, and the
#                    provider installs `canUseTool: () => deny`.
#   claude-code      permissionMode `bypassPermissions` -> write + command.
#                    Required for anything needing Bash (tests, builds).
#   codex-readonly   permissionMode `never` -> approvalPolicy never, and NO
#                    sandbox field is sent, so Codex inherits the user's own
#                    Codex config. Read-oriented only if that config says so.
#   codex            permissionMode `dangerously-bypass-approvals-and-sandbox`
#                    -> approvalPolicy never + sandbox danger-full-access.
#
# `maxDepth: provider-managed` mirrors the shipped standard preset rows and sends
# no depth cap, so a child product may run its own nested agents.
"""

# ---------------------------------------------------------------- canonical rows
# The four host-plane provider registrations. `subagents` is a process
# singleton, so these names must stay unique across the whole process.
PROVIDERS = """          # ---------------------------------------------------------------
          # Host seam: the two product-subagent providers (4 registrations).
          # `subagents` is a process singleton on the host plane, so these rows
          # register globally and are shared by any session that selects this
          # preset. Provider names must stay unique across the whole process.
          # ---------------------------------------------------------------
          - id: subagent-codex-provider
            name: '@deepseek-ai/dsh-subagent-codex'
            config:
              providerName: codex
              permissionMode: dangerously-bypass-approvals-and-sandbox

          - id: subagent-codex-readonly-provider
            name: '@deepseek-ai/dsh-subagent-codex'
            config:
              providerName: codex-readonly
              permissionMode: never

          - id: subagent-claude-provider
            name: '@deepseek-ai/dsh-subagent-claude-code'
            config:
              providerName: claude-code
              permissionMode: bypassPermissions

          - id: subagent-claude-readonly-provider
            name: '@deepseek-ai/dsh-subagent-claude-code'
            config:
              providerName: claude-readonly
              permissionMode: dontAsk
"""

# Everything after the persona row: the standard tool surface, then the
# delegation plane. Indentation is 10 spaces for preset-level plugin rows.
BODY = """          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536

          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'

          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'

          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'

          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false

          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'

          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'

          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'

          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'

          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'

          - id: planning
            name: cordis:group
            group: true
            isolate:
              planMode: true
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
{PLAN_SECTION}

          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024

          # ---------------------------------------------------------------
          # Delegation plane. This group's `config` children mount the
          # model-facing tools; the providers above live OUTSIDE it because
          # they register into the host-plane `subagents` singleton.
          # Four product tools, one per provider/tier.
          #
          # `backgroundMode: one-shot` is required: these are one-shot product
          # providers with no `prepareContinuable` capability. `run_in_background`
          # stays available (enableRunInBackground defaults true), which is what
          # lets a session dispatch Codex and Claude Code simultaneously.
          # ---------------------------------------------------------------
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'

              - id: tool-subagent-list-agents
                name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'

              # In-harness DSH children, kept alongside the product workers.
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelectionSettings: true
                  backgroundMode: continuable

              - id: tool-subagent-fork
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: fork
                  toolName: subagent_fork
                  backgroundMode: continuable

              # --- Codex, full access ---
              - id: tool-subagent-codex
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: codex
                  toolName: subagent_codex
                  backgroundMode: one-shot
                  maxDepth: provider-managed

              # --- Codex, read-oriented ---
              - id: tool-subagent-codex-readonly
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: codex-readonly
                  toolName: subagent_codex_readonly
                  backgroundMode: one-shot
                  maxDepth: provider-managed

              # --- Claude Code, full access ---
              - id: tool-subagent-claude-code
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: claude-code
                  toolName: subagent_claude_code
                  backgroundMode: one-shot
                  maxDepth: provider-managed

              # --- Claude Code, hard read-only ---
              - id: tool-subagent-claude-readonly
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: claude-readonly
                  toolName: subagent_claude_readonly
                  backgroundMode: one-shot
                  maxDepth: provider-managed

              - id: workflow-ptc
                name: '@deepseek-ai/dsh-workflow-ptc'
                config:
                  provider: spawn

              - id: tool-workflow
                name: '@deepseek-ai/dsh-tool-workflow'

              - id: tool-ralph
                name: '@deepseek-ai/dsh-tool-ralph'
                disabled: true
                config:
                  subagentProvider: spawn
                  maxRounds: 64

          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'

          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true

          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000

          - id: present
            name: '@deepseek-ai/dsh-tool-present'
"""


def persona(prefix_lines):
    """Render a persona row whose `prefix` is a folded block scalar.

    A blank entry in `prefix_lines` renders as a truly empty line (no trailing
    spaces), which is what a YAML folded scalar needs for a paragraph break.
    """
    body = "\n".join(("" if line == "" else "                " + line) for line in prefix_lines)
    return (
        "          - id: persona\n"
        "            name: '@deepseek-ai/dsh-persona'\n"
        "            config:\n"
        "              suffix: Your working directory is {{cwd}}.\n"
        "              prefix: >-\n"
        f"{body}\n"
    )


# The plan-mode guidance is REQUIRED config (`PlanModeConfig.section`): the
# plugin throws "PlanModeConfig needs a non-empty `section`" at load when it
# is missing or blank, which fails the whole preset. Copied verbatim from the
# shipped standard preset; do not paraphrase or shorten it. Its paragraph
# breaks are significant and preserved by the triple-quoted literal below.
PLAN_SECTION = """You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation."""

PRESETS = [
    {
        "id": "codex-claude",
        "name": "Codex + Claude Code",
        "order": 20,
        "description": [
            "Standard coding tools plus four delegation subagents: Codex and Claude",
            "Code, each at a read-only and a full-access tier. Both products can be",
            "dispatched in parallel on one task.",
        ],
        "prefix": [
            "You are a coding agent powered by the {{model}} model. You have four",
            "delegation subagents: Codex (`subagent_codex`,",
            "`subagent_codex_readonly`) and Claude Code (`subagent_claude_code`,",
            "`subagent_claude_readonly`), each with a full-access and a read-only",
            "tier; use the read-only tier for analysis so it cannot modify the",
            "workspace. Each subagent starts fresh without this conversation, so its",
            "prompt must be self-contained. You may dispatch Codex and Claude Code at",
            "the same time with `run_in_background` to get independent work back in",
            "parallel, then reconcile their answers and own the final result. Pairing",
            "and delegation are offered, not required: use them when independent work",
            "would help, and otherwise just do the work yourself.",
        ],
    },
]


def indent_plan_section(text):
    """Indent every line of the plan guidance to sit under `section: |-`.

    The BODY template carries `{PLAN_SECTION}` at column 0, so this is the only
    place the block scalar's indentation is applied. The block scalar's content
    must be indented MORE than its `section:` key, which sits at column 18
    (10 for the preset's plugin list + 4 for `config:` + 2 for the sequence item
    + 2 for the mapping) — hence 20.
    """
    pad = " " * 20
    return "\n".join((pad + ln) if ln else "" for ln in text.split("\n"))


def render_preset(spec):
    desc = "\n".join("          " + line for line in spec["description"])
    return (
        "- insert:\n"
        "    - id: preset-{id}\n"
        "      name: '@deepseek-ai/dsh-agent-preset'\n"
        "      config:\n"
        "        id: {id}\n"
        "        name: {name}\n"
        "        description: >-\n"
        "{desc}\n"
        "        order: {order}\n"
        "        plugins:\n"
        "{providers}"
        "{persona}"
        "{body}"
    ).format(
        id=spec["id"],
        name=spec["name"],
        desc=desc,
        order=spec["order"],
        providers=PROVIDERS,
        persona=persona(spec["prefix"]),
        body=BODY.replace("{PLAN_SECTION}", indent_plan_section(PLAN_SECTION)),
    )


def main():
    rendered = []
    for spec in PRESETS:
        text = render_preset(spec)
        # One blank line between the persona row and the row that follows it.
        last = spec["prefix"][-1]
        text = text.replace(
            "                " + last + "\n          - id: agent-instructions",
            "                " + last + "\n\n          - id: agent-instructions",
        )
        rendered.append(text)
    out = HEADER + "\n".join(rendered)

    # --- structural self-check before writing ---
    for spec in PRESETS:
        start = out.index("id: preset-" + spec["id"])
        ends = [
            out.index("id: preset-" + o["id"])
            for o in PRESETS
            if o["id"] != spec["id"] and ("id: preset-" + o["id"]) in out
        ]
        end = min([e for e in ends if e > start], default=len(out))
        seg = out[start:end]
        must = [
            "subagent-codex-provider",
            "subagent-codex-readonly-provider",
            "subagent-claude-provider",
            "subagent-claude-readonly-provider",
            "id: persona",
            "id: tool-subagent-codex\n",
            "toolName: subagent_claude_readonly",
            "id: present",
            "id: delegation",
        ]
        missing = [m for m in must if m not in seg]
        if missing:
            sys.exit(f"FATAL: preset {spec['id']} missing rows: {missing}")

    fd, tmp = tempfile.mkstemp(dir=HERE, prefix=".cordis.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(out)
        os.replace(tmp, TARGET)  # atomic: breaks any hardlink, never mutates it
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    print(f"wrote {TARGET}: {len(out)} chars, {out.count(chr(10))} lines")


if __name__ == "__main__":
    main()
