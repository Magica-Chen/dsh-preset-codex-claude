#!/usr/bin/env node
/** Static dependency and preset preflight; never starts DSH or a product worker. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BASELINE_DSH = '0.2.1-rc.3'
export const PROVIDERS = ['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code']
const ANCHOR = '@deepseek-ai/dsh-agent-preset'
const TOOL_PLUGIN = '@deepseek-ai/dsh-tool-subagent'
const EXPECTED_TOOLS = new Map([
  ['subagent_codex', [PROVIDERS[0], 'dangerously-bypass-approvals-and-sandbox']],
  ['subagent_codex_readonly', [PROVIDERS[0], 'never']],
  ['subagent_claude_code', [PROVIDERS[1], 'bypassPermissions']],
  ['subagent_claude_readonly', [PROVIDERS[1], 'dontAsk']],
])
const HERE = path.dirname(fileURLToPath(import.meta.url))

function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** This checks only this package's documented Node floor, not every dependency. */
export function supportsNode(version) {
  const [major, minor] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 12)
}

export function findRootByName(startPath, wanted) {
  let dir = path.resolve(startPath)
  for (;;) {
    try {
      if (readManifest(path.join(dir, 'package.json')).name === wanted) return dir
    } catch { /* no readable matching manifest here */ }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Read executable locations, not their output; shell launchers may need the override. */
export function findInstallRoot(env = process.env) {
  if (env.DSH_PRESET_CC_INSTALL) {
    const root = path.resolve(env.DSH_PRESET_CC_INSTALL)
    try {
      return readManifest(path.join(root, 'package.json')).name === '@deepseek-ai/dsh' ? root : null
    } catch { return null }
  }
  const names = process.platform === 'win32' ? ['dsh', 'dsh.exe', 'dsh.cmd', 'dsh.bat'] : ['dsh']
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      try {
        const executable = fs.realpathSync(path.join(dir, name))
        if (!fs.statSync(executable).isFile()) continue
        const root = findRootByName(path.dirname(executable), '@deepseek-ai/dsh')
        if (root) return root
      } catch { /* continue looking */ }
    }
  }
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh')
  for (const root of [path.join(home, 'installation'), home]) {
    try {
      if (readManifest(path.join(root, 'package.json')).name === '@deepseek-ai/dsh') return root
    } catch { /* not a conventional installation */ }
  }
  return null
}

/** Resolve metadata only. Native Node lookup here is NOT DSH's runtime table. */
export function resolvePackage(root, spec) {
  if (!root) return null
  const req = createRequire(path.join(path.resolve(root), 'package.json'))
  try {
    const manifestPath = req.resolve(`${spec}/package.json`)
    return { manifestPath, manifest: readManifest(manifestPath) }
  } catch { /* package.json may not be exported */ }
  try {
    const packageRoot = findRootByName(path.dirname(req.resolve(spec)), spec)
    if (!packageRoot) return null
    const manifestPath = path.join(packageRoot, 'package.json')
    return { manifestPath, manifest: readManifest(manifestPath) }
  } catch { return null }
}

/** Limited diagnostic lookup: installation first, then this bundle's own dependencies. */
export function resolveDependency(installRoot, bundleRoot, spec) {
  for (const [source, root] of [['installation', installRoot], ['bundle', bundleRoot]]) {
    const found = resolvePackage(root, spec)
    if (found) return { ...found, source }
  }
  return null
}

/** Loader expressions are retained as inert data, never evaluated by the doctor. */
export function parsePatch(text, bundleRoot, installRoot) {
  let yaml
  for (const root of [bundleRoot, installRoot]) {
    if (!root) continue
    try {
      yaml = createRequire(path.join(path.resolve(root), 'package.json'))('js-yaml')
      break
    } catch { /* try the installation's copy without installing anything */ }
  }
  if (!yaml) throw new Error('js-yaml is not reachable; install this bundle with its declared dependencies')
  const expression = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct: (value) => ({ __jsExpr: value }),
  })
  return yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([expression]) })
}

/** Validate this bundle's known structure, not the complete Cordis schema or runtime. */
export function inspectPatch(parsed) {
  const errors = []
  const checks = []
  if (!Array.isArray(parsed)) return { errors: ['patch must be a list'], checks }
  const host = []
  const flatten = (rows, target, label) => {
    if (!Array.isArray(rows)) { errors.push(`${label} must be a row list`); return }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`${label} contains a non-object row`)
        continue
      }
      target.push(row)
      if (row.name === 'cordis:group') flatten(row.config, target, `${label} group ${row.id ?? '<unnamed>'}`)
    }
  }
  for (const patch of parsed) {
    if (!patch || typeof patch !== 'object' || !Array.isArray(patch.insert)) {
      errors.push('expected insert patches for this standalone bundle')
      continue
    }
    flatten(patch.insert, host, 'Host rows')
  }
  const declarations = host.filter((row) => row.name === ANCHOR)
  if (declarations.length !== 1) errors.push(`expected one agent preset declaration, found ${declarations.length}`)
  const preset = declarations[0]?.config
  const scoped = []
  if (preset) {
    if (preset.id !== 'codex-claude') errors.push('expected preset id codex-claude')
    else checks.push('preset id=codex-claude')
    flatten(preset.plugins, scoped, 'preset plugins')
  }
  const uniqueIds = (rows, label) => {
    const ids = rows.map((row) => row.id)
    if (ids.some((id) => typeof id !== 'string' || !id.trim())) errors.push(`${label} has a missing row id`)
    if (new Set(ids).size !== ids.length) errors.push(`${label} has duplicate row ids`)
  }
  uniqueIds(host, 'Host rows')
  uniqueIds(scoped, 'preset plugins')
  const rows = [...host, ...scoped]
  const providerRows = rows.filter((row) => PROVIDERS.includes(row.name))
  if (providerRows.length !== 4) errors.push(`expected 4 provider registrations, found ${providerRows.length}`)
  const names = providerRows.map((row) => row.config?.providerName)
  if (names.some((name) => typeof name !== 'string' || !name.trim())) errors.push('providerName must be non-empty')
  if (new Set(names).size !== names.length) errors.push('duplicate provider names')
  if (providerRows.length === 4 && names.every((name) => typeof name === 'string' && name.trim()) && new Set(names).size === 4) {
    checks.push(`4 unique provider registrations: ${names.join(', ')}`)
  }
  if (providerRows.some((row) => !host.includes(row))) errors.push('product providers must be Host rows, outside preset.plugins')
  const tools = scoped.filter((row) => row.name === TOOL_PLUGIN)
  const toolNames = tools.map((row) => row.config?.toolName)
  if (new Set(toolNames).size !== toolNames.length) errors.push('duplicate delegation tool names')
  for (const [name, [plugin, permission]] of EXPECTED_TOOLS) {
    const matching = tools.filter((row) => row.config?.toolName === name)
    if (matching.length !== 1) { errors.push(`expected one delegation tool ${name}, found ${matching.length}`); continue }
    const tool = matching[0]
    const provider = providerRows.find((row) => row.config?.providerName === tool.config.provider)
    if (!provider || provider.name !== plugin || provider.config.permissionMode !== permission) {
      errors.push(`${name} must bind to its declared ${plugin} ${permission} provider`)
    }
    if (tool.config.maxDepth !== 'provider-managed') errors.push(`${name} requires maxDepth: provider-managed`)
  }
  for (const row of tools) {
    for (const field of ['backgroundMode', 'enableRunInBackground', 'persona', 'toolFilter']) {
      if (Object.hasOwn(row.config ?? {}, field)) errors.push(`${row.config?.toolName ?? row.id} uses obsolete tool config ${field}`)
    }
  }
  const planning = scoped.filter((row) => row.name === '@deepseek-ai/dsh-plan-mode')
  if (planning.length !== 1 || typeof planning[0]?.config?.section !== 'string' || !planning[0].config.section.trim()) {
    errors.push('the actual plan-mode row requires a non-empty config.section')
  } else checks.push('plan-mode carries a non-empty config.section')
  if (!errors.length) checks.push(`4 product tool bindings; ${host.length} Host rows and ${scoped.length} preset rows checked`)
  return { errors, checks }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`dsh-preset-codex-claude — static preflight

Usage: node <bundle>/bin/doctor.mjs

Checks dependency manifests and the bundle's preset structure without starting
DSH, loading provider code, running product CLIs, or reading credentials.
Lookup is installation-first, then this bundle's own dependencies. It does not
reproduce the active profile's full runtime package table or verify activation,
native payloads, authentication, settings, or effective permissions.

Exit: 0 = static checks passed (possibly with warnings); 1 = a static check failed.

Environment overrides:
  DSH_PRESET_CC_INSTALL  directory containing the DSH installation's package.json
  DSH_PRESET_CC_DSH      diagnostic baseline (default: ${BASELINE_DSH}); not a pin
  DSH_HOME              conventional DSH home (default: ~/.dsh)

After installation, follow DSH's restart instructions and validate a new session.
The historical *_readonly names do not guarantee enforced read-only execution.`)
    return 0
  }
  let errors = 0
  let warnings = 0
  const ok = (message) => console.log(`  ✓ ${message}`)
  const warn = (message) => { warnings++; console.log(`  ! ${message}`) }
  const bad = (message) => { errors++; console.log(`  ✗ ${message}`) }
  const bundleRoot = path.resolve(HERE, '..')
  const baseline = env.DSH_PRESET_CC_DSH || BASELINE_DSH
  console.log('dsh-preset-codex-claude — static preflight')
  console.log('\nEnvironment')
  if (supportsNode(process.versions.node)) ok(`node ${process.versions.node}`)
  else bad(`node ${process.versions.node} is too old (need >=22.12.0)`)
  const installRoot = findInstallRoot(env)
  if (!installRoot) bad('could not locate DSH; set DSH_PRESET_CC_INSTALL to its package directory')
  else {
    const version = readManifest(path.join(installRoot, 'package.json')).version
    ok(`dsh installation: ${installRoot} (version ${version ?? '<missing>'})`)
    if (version !== baseline) warn(`DSH ${version ?? '<missing>'} differs from baseline ${baseline}; compatibility is not verified`)
    if (resolvePackage(installRoot, ANCHOR)) ok(`${ANCHOR} is reachable from the installation`)
    else bad(`${ANCHOR} is not reachable from the installation`)
  }
  let bundleManifest
  try { bundleManifest = readManifest(path.join(bundleRoot, 'package.json')) }
  catch { bad('could not read this bundle\'s package.json') }
  console.log('\nProvider dependencies (limited static lookup)')
  for (const provider of PROVIDERS) {
    const range = bundleManifest?.dependencies?.[provider]
    if (typeof range !== 'string' || !range.trim()) bad(`${provider} is not declared as a bundle dependency`)
    else ok(`${provider} declared ${range}`)
    const found = resolveDependency(installRoot, bundleRoot, provider)
    if (!found) {
      bad(`${provider} is not reachable from the installation or this bundle; install/reinstall the preset with its dependencies through DSH`)
      continue
    }
    const version = found.manifest.version
    ok(`${provider}@${version ?? '<missing>'} from ${found.source}: ${found.manifestPath}`)
    if (version !== baseline) warn(`${provider} differs from baseline ${baseline}; check DSH's actual selection and compatibility diagnostics`)
    if (typeof found.manifest.engines?.dsh === 'string') console.log(`    declared engines.dsh: ${found.manifest.engines.dsh}`)
    else {
      const peers = Object.entries(found.manifest.peerDependencies ?? {})
        .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
      if (peers.length) console.log(`    declared DSH peer requirements: ${[...new Set(peers.map(([, value]) => value))].join(', ')}`)
    }
  }
  console.log('\nPreset declaration')
  try {
    const text = fs.readFileSync(path.join(bundleRoot, 'cordis.patch.yml'), 'utf8')
    const result = inspectPatch(parsePatch(text, bundleRoot, installRoot))
    result.checks.forEach(ok)
    result.errors.forEach(bad)
  } catch (error) { bad(`could not validate cordis.patch.yml: ${error.message}`) }
  console.log('\nNot verified')
  console.log('  Active profile resolution, DSH compatibility admission, live mount, native payloads,')
  console.log('  authentication, native settings, and effective permissions are not verified.')
  console.log('  No product CLI or model was run; no credentials were read.')
  console.log('\nVerdict')
  if (errors) {
    console.log(`  ${errors} static check(s) failed; ${warnings} warning(s).`)
    return 1
  }
  console.log(`  Static checks passed${warnings ? ` with ${warnings} warning(s)` : ''}. Runtime readiness is not established.`)
  console.log('  Follow DSH activation/restart diagnostics and validate a new session.')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
