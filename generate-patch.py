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

HEADER = """# Bundle patch: four Host providers and one `codex-claude` agent preset.
# Codex uses the official app-server; Claude Code uses the official Agent SDK.
# Each vendor has a full-access and a native unattended-policy registration.
# Pairing and delegation are optional. Managed activations return a child id
# immediately; the runtime delivers each external worker's final result later.
#
# The historical *_readonly tool names are NOT filesystem security boundaries:
# Codex `never` inherits native sandbox settings; Claude Code `dontAsk` denies
# permission prompts, but native user/project settings can pre-authorize tools.
# Use an independently enforced sandbox for tasks requiring strict read-only.
# Full-access workers bypass native permission checks and can modify files/run
# commands. Choose that tier only when the user's task authorizes those effects.
#
# Providers belong on the Host, not in eagerly retained preset revisions.
# Names are private to this bundle, avoiding collisions with optional standalone
# Codex/Claude bundles. Only this preset exposes these four named tools.
# `maxDepth: provider-managed` delegates nested-agent policy to each product.
"""

# ---------------------------------------------------------------- canonical rows
# The four host-plane provider registrations. `subagents` is a process
# singleton, so these names must stay unique across the whole process.
PROVIDERS = """    - id: provider-preset-codex-claude-codex
      name: '@deepseek-ai/dsh-subagent-codex'
      config:
        providerName: preset-codex-claude-codex
        permissionMode: dangerously-bypass-approvals-and-sandbox

    - id: provider-preset-codex-claude-codex-readonly
      name: '@deepseek-ai/dsh-subagent-codex'
      config:
        providerName: preset-codex-claude-codex-readonly
        permissionMode: never

    - id: provider-preset-codex-claude-claude
      name: '@deepseek-ai/dsh-subagent-claude-code'
      config:
        providerName: preset-codex-claude-claude
        permissionMode: bypassPermissions

    - id: provider-preset-codex-claude-claude-readonly
      name: '@deepseek-ai/dsh-subagent-claude-code'
      config:
        providerName: preset-codex-claude-claude-readonly
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
          # Scoped model-facing tools for the four Host provider registrations.
          # Every delegation returns a child id immediately. External workers
          # deliver a completion notice but do not accept follow-up messages.
          # Start independent work together; pairing is never mandatory.
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

              - id: tool-subagent-fork
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: fork
                  toolName: subagent_fork

              # --- Codex, full access ---
              - id: tool-subagent-codex
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: preset-codex-claude-codex
                  toolName: subagent_codex
                  maxDepth: provider-managed

              # --- Codex, read-oriented ---
              - id: tool-subagent-codex-readonly
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: preset-codex-claude-codex-readonly
                  toolName: subagent_codex_readonly
                  maxDepth: provider-managed

              # --- Claude Code, full access ---
              - id: tool-subagent-claude-code
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: preset-codex-claude-claude
                  toolName: subagent_claude_code
                  maxDepth: provider-managed

              # --- Claude Code, native unattended policy ---
              - id: tool-subagent-claude-readonly
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: preset-codex-claude-claude-readonly
                  toolName: subagent_claude_readonly
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
            "Code, each with full-access and native unattended-policy tiers.",
            "Pairing is optional; neither unattended tier guarantees read-only.",
        ],
        "prefix": [
            "You are a coding agent powered by the {{model}} model. Codex",
            "(`subagent_codex`, `subagent_codex_readonly`) and Claude Code",
            "(`subagent_claude_code`, `subagent_claude_readonly`) are optional",
            "delegation tools; use either, both, or neither as the task warrants.",
            "Full-access tools bypass native permission checks and may write files",
            "and run commands; use them only for effects the user has authorized.",
            "The *_readonly names are legacy labels, not read-only enforcement:",
            "Codex inherits native sandbox settings, and Claude Code may use tools",
            "already allowed by native settings. For strict read-only work, require",
            "an independently enforced sandbox instead. Reconcile delegated results",
            "and take responsibility for the final answer.",
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
        "    - id: preset-{id}\n"
        "      name: '@deepseek-ai/dsh-agent-preset'\n"
        "      config:\n"
        "        id: {id}\n"
        "        name: {name}\n"
        "        description: >-\n"
        "{desc}\n"
        "        order: {order}\n"
        "        plugins:\n"
        "{persona}"
        "{body}"
    ).format(
        id=spec["id"],
        name=spec["name"],
        desc=desc,
        order=spec["order"],
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
    out = HEADER + "- insert:\n" + PROVIDERS + "\n".join(rendered)

    # --- structural self-check before writing ---
    for provider_name in (
        "preset-codex-claude-codex", "preset-codex-claude-codex-readonly",
        "preset-codex-claude-claude", "preset-codex-claude-claude-readonly",
    ):
        if f"        providerName: {provider_name}\n" not in PROVIDERS:
            sys.exit(f"FATAL: missing Host provider {provider_name}")
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
