#!/usr/bin/env node
/**
 * dsh-preset-codex-claude — preflight.
 *
 * The preset's plugin rows are resolved by the DSH loader against the dsh
 * INSTALLATION (baseUrl), not against your profile. So the two product-subagent
 * provider packages must be resolvable from the installation tree, at versions
 * matching that installation. When they are missing, the Web GUI simply reports
 * "Failed to load" with no hint about why. This command exists to replace that
 * with a precise, actionable diagnosis.
 *
 * Usage:  npx dsh-preset-codex-claude doctor
 * Exit:   0 = ready, 1 = something must be fixed
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROVIDERS = ['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code']
const ANCHOR = '@deepseek-ai/dsh-agent-preset'
const SUPPORTED_DSH = process.env.DSH_PRESET_CC_DSH || '0.2.0-rc.2'

let errors = 0
let warnings = 0
const ok = (m) => console.log(`  \u2713 ${m}`)
const warn = (m) => { warnings++; console.log(`  ! ${m}`) }
const bad = (m) => { errors++; console.log(`  \u2717 ${m}`) }

function header(t) { console.log(`\n${t}`) }

/** Walk up from a path looking for a package.json with the given name. */
function findRootByName(startPath, wanted) {
  let dir = startPath
  for (let i = 0; i < 12 && dir && dir !== path.dirname(dir); i++) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === wanted) return dir
    } catch { /* not this level */ }
    dir = path.dirname(dir)
  }
  return null
}

/** Locate the dsh installation root that the running CLI belongs to. */
function findInstallRoot() {
  // Preferred: follow the `dsh` executable to its real path and walk up to the
  // manifest. This works whether the launcher is a symlink into the package
  // (`<root>/lib/bin.js`, the common case) or a shell shim, and it identifies
  // the root by package name rather than by guessing a directory depth.
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    if (bin) {
      const found = findRootByName(path.dirname(fs.realpathSync(bin)), '@deepseek-ai/dsh')
      if (found) return found
    }
  } catch { /* dsh not on PATH */ }

  // Fallback: the conventional installation location under DSH_HOME.
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  for (const candidate of [path.join(home, 'installation'), home]) {
    if (findRootByName(candidate, '@deepseek-ai/dsh')) return candidate
  }
  return null
}

/** Resolve a module the way the loader does: from the installation root. */
function resolveFromInstall(root, spec) {
  if (!root) return null
  try {
    const req = createRequire(path.join(root, 'package.json'))
    return req.resolve(`${spec}/package.json`)
  } catch { return null }
}

function pkgVersion(pkgJsonPath) {
  try { return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version } catch { return null }
}

function onPath(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true } catch { return false }
}

console.log('dsh-preset-codex-claude \u2014 preflight')

// ---------------------------------------------------------------- environment
header('Environment')
const [major] = process.versions.node.split('.').map(Number)
if (major >= 18) ok(`node ${process.versions.node}`)
else bad(`node ${process.versions.node} is too old (need >= 18)`)

const installRoot = findInstallRoot()
if (installRoot) {
  ok(`dsh installation: ${installRoot}`)
} else {
  bad('could not locate the dsh installation (is `dsh` on PATH?)')
}

// ---------------------------------------------------------------- anchor
header('Loader anchor')
const anchorPath = resolveFromInstall(installRoot, ANCHOR)
if (anchorPath) {
  ok(`${ANCHOR} resolves from the installation`)
} else {
  bad(`${ANCHOR} does not resolve from ${installRoot ?? '<unknown>'} \u2014 is this a dsh installation?`)
}

const dshVersion = installRoot ? pkgVersion(path.join(installRoot, 'package.json')) : null
if (dshVersion) {
  if (dshVersion === SUPPORTED_DSH) ok(`dsh ${dshVersion} (matches the pinned provider version)`)
  else warn(`dsh ${dshVersion} differs from the pinned ${SUPPORTED_DSH} \u2014 provider versions may not match the host`)
}

// ---------------------------------------------------------------- providers
header('Provider packages (must live in the INSTALLATION, not your profile)')
const missing = []
for (const p of PROVIDERS) {
  const found = resolveFromInstall(installRoot, p)
  if (!found) { missing.push(p); bad(`${p} NOT resolvable from the installation`) ; continue }
  const v = pkgVersion(found)
  if (dshVersion && v !== dshVersion) {
    bad(`${p}@${v} does not match dsh ${dshVersion} \u2014 a mismatched copy registers into its own service instance and delegation silently fails`)
  } else {
    ok(`${p}@${v}`)
  }
}

if (missing.length) {
  console.log('\n  Fix (installs into the dsh installation, pinned, without touching its package.json):')
  console.log(`    npm install --no-save --prefix "${installRoot}" \\`)
  for (const [i, p] of missing.entries()) {
    const last = i === missing.length - 1
    console.log(`      ${p}@${SUPPORTED_DSH}${last ? '' : ' \\'}`)
  }
}

// ---------------------------------------------------------------- CLIs
header('Agent CLIs and authentication')
for (const [cmd, hint] of [
  ['codex', 'codex login'],
  ['claude', 'claude login'],
]) {
  if (!onPath(cmd)) { warn(`${cmd} is not on PATH \u2014 that worker cannot run (install it, or just do not delegate to it)`) ; continue }
  ok(`${cmd} found`)
  try {
    if (cmd === 'codex') execFileSync('codex', ['login', 'status'], { stdio: 'pipe' })
    else execFileSync('claude', ['--version'], { stdio: 'pipe' })
    ok(`${cmd} responds`)
  } catch {
    warn(`${cmd} did not respond \u2014 if delegation fails, run \`${hint}\``)
  }
}

// ---------------------------------------------------------------- preset file
header('Preset declaration')
const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [path.join(here, '..', 'cordis.patch.yml')]
try {
  // When installed via `dsh plugin add`, this package is linked into the profile.
  const req = createRequire(import.meta.url)
  candidates.push(path.join(path.dirname(req.resolve('dsh-preset-codex-claude/package.json')), 'cordis.patch.yml'))
} catch { /* not installed as a package yet */ }

const patchPath = candidates.find((c) => fs.existsSync(c))
if (!patchPath) {
  bad('cordis.patch.yml not found next to this command')
} else {
  ok(`preset file: ${patchPath}`)
  const text = fs.readFileSync(patchPath, 'utf8')
  // Parse with js-yaml when reachable; the structural checks below are the ones
  // that turn an otherwise invisible "Failed to load" into a clear diagnosis.
  let parsed = null
  for (const base of [
    import.meta.url,
    path.join(path.dirname(patchPath), 'package.json'),
    installRoot ? path.join(installRoot, 'package.json') : null,
  ]) {
    if (!base) continue
    try {
      const y = createRequire(base)('js-yaml')
      parsed = y.load(text.replace(/!!js/g, ''))
      break
    } catch { /* try the next resolution base */ }
  }
  if (!parsed) {
    warn('could not parse cordis.patch.yml (no yaml library reachable) \u2014 skipping structural checks')
  } else {
    const preset = parsed?.[0]?.insert?.find((r) => r.name === ANCHOR)?.config
    if (!preset) bad('the patch does not declare an agent preset')
    else {
      ok(`preset id=${preset.id} name="${preset.name}"`)
      const flat = []
      const walk = (list) => {
        for (const r of list ?? []) {
          if (r.name === 'cordis:group') { walk(r.config); continue }
          flat.push(r)
        }
      }
      walk(preset.plugins)
      const ids = flat.map((r) => r.id)
      if (ids.length === new Set(ids).size) ok(`${flat.length} plugin rows, no duplicate ids`)
      else bad('duplicate row ids')

      // The failure that is otherwise invisible: a required config left out.
      if (text.includes('section: |') || text.includes('section: |-')) ok('plan-mode carries its required `section` guidance')
      else bad('the plan-mode row has no `section` \u2014 PlanModeConfig requires a non-empty section, and the whole preset will fail to load')

      const providers = flat
        .filter((r) => /dsh-subagent-(codex|claude-code)$/.test(r.name ?? ''))
        .map((r) => r.config?.providerName)
      if (providers.length === 4) ok(`4 providers declared: ${providers.join(', ')}`)
      else bad(`expected 4 provider registrations, found ${providers.length}`)

      const tools = flat.filter((r) => r.config?.toolName).map((r) => r.config.toolName)
      const want = ['subagent_codex', 'subagent_codex_readonly', 'subagent_claude_code', 'subagent_claude_readonly']
      const absent = want.filter((t) => !tools.includes(t))
      if (!absent.length) ok(`4 delegation tools: ${want.join(', ')}`)
      else bad(`missing delegation tools: ${absent.join(', ')}`)
    }
  }
}

// ---------------------------------------------------------------- verdict
header('Verdict')
if (errors === 0) {
  console.log(warnings === 0 ? '  Ready. Restart dsh, then create a NEW session and pick the mode.' : '  Ready, with warnings above.')
  console.log('  Note: an existing session keeps the preset it started with \u2014 you must create a new one.')
  process.exit(0)
} else {
  console.log(`  ${errors} problem(s) must be fixed before the mode will load.`)
  process.exit(1)
}
