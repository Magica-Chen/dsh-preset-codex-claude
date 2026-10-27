import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_DSH, PROVIDERS, findInstallRoot, inspectPatch, resolveDependency, resolvePackage, supportsNode,
} from '../bin/doctor.mjs'

const doctor = fileURLToPath(new URL('../bin/doctor.mjs', import.meta.url))

function validPatch() {
  const bindings = [
    ['codex', PROVIDERS[0], 'dangerously-bypass-approvals-and-sandbox', 'subagent_codex'],
    ['codex-readonly', PROVIDERS[0], 'never', 'subagent_codex_readonly'],
    ['claude', PROVIDERS[1], 'bypassPermissions', 'subagent_claude_code'],
    ['claude-readonly', PROVIDERS[1], 'dontAsk', 'subagent_claude_readonly'],
  ]
  const providers = bindings.map(([name, plugin, permissionMode]) => ({
    id: `provider-${name}`, name: plugin,
    config: { providerName: `preset-codex-claude-${name}`, permissionMode },
  }))
  const tools = bindings.map(([name, , , toolName]) => ({
    id: `tool-${name}`, name: '@deepseek-ai/dsh-tool-subagent',
    config: { provider: `preset-codex-claude-${name}`, toolName, maxDepth: 'provider-managed' },
  }))
  return [{ insert: [...providers, {
    id: 'preset-codex-claude', name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: 'codex-claude',
      plugins: [
        { id: 'planning', name: 'cordis:group', group: true, config: [
          { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: 'Plan before making changes.' } },
        ] },
        { id: 'delegation', name: 'cordis:group', group: true, config: tools },
      ],
    },
  }] }]
}

function tempRoot(t) {
  const prefix = path.join(os.tmpdir(), 'preset-doctor-test-')
  const root = fs.mkdtempSync(prefix)
  t.after(() => {
    const resolved = fs.realpathSync(root)
    assert.equal(resolved, path.resolve(root))
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'preset-doctor-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  return root
}

function addPackage(root, name, version, extras = {}) {
  const dir = path.join(root, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, ...extras }))
  return dir
}

function presetOf(doc) { return doc[0].insert.at(-1).config }
function toolsOf(doc) { return presetOf(doc).plugins[1].config }

test('baseline and Node floor reflect rc.3 target', () => {
  assert.equal(BASELINE_DSH, '0.2.1-rc.3')
  assert.equal(supportsNode('18.20.0'), false)
  assert.equal(supportsNode('20.19.0'), false)
  assert.equal(supportsNode('22.11.0'), false)
  assert.equal(supportsNode('22.12.0'), true)
  assert.equal(supportsNode('24.7.0'), true)
})

test('accepts namespaced Host providers with scoped product tools', () => {
  assert.deepEqual(inspectPatch(validPatch()).errors, [])
})

test('requires a section on the actual plan-mode row, not unrelated text', () => {
  const doc = validPatch()
  presetOf(doc).plugins[0].config[0].config.section = '  '
  presetOf(doc).plugins.push({ id: 'unrelated', name: 'example', config: { section: 'section: | fake guidance' } })
  assert.ok(inspectPatch(doc).errors.some((error) => error.includes('actual plan-mode row')))
})

test('rejects duplicate provider names and broken tool bindings', () => {
  const doc = validPatch()
  doc[0].insert[1].config.providerName = doc[0].insert[0].config.providerName
  const errors = inspectPatch(doc).errors
  assert.ok(errors.includes('duplicate provider names'))
  assert.ok(errors.some((error) => error.includes('subagent_codex_readonly must bind')))
})

test('validates the permission tier, not just tool presence', () => {
  const doc = validPatch()
  doc[0].insert[3].config.permissionMode = 'bypassPermissions'
  assert.ok(inspectPatch(doc).errors.some((error) => error.includes('subagent_claude_readonly must bind')))
})

test('rejects absent or duplicated product tools', () => {
  const doc = validPatch()
  toolsOf(doc).pop()
  assert.ok(inspectPatch(doc).errors.some((error) => error.includes('expected one delegation tool subagent_claude_readonly')))
  const duplicated = validPatch()
  toolsOf(duplicated).push(structuredClone(toolsOf(duplicated)[0]))
  assert.ok(inspectPatch(duplicated).errors.includes('duplicate delegation tool names'))
  assert.ok(inspectPatch(duplicated).errors.includes('preset plugins has duplicate row ids'))
})

test('rejects obsolete rc.2 tool scheduling fields', () => {
  const doc = validPatch()
  toolsOf(doc)[0].config.backgroundMode = 'one-shot'
  assert.ok(inspectPatch(doc).errors.some((error) => error.includes('obsolete tool config backgroundMode')))
})

test('requires Host provider placement and provider-managed depth', () => {
  const doc = validPatch()
  const provider = doc[0].insert.shift()
  presetOf(doc).plugins.push(provider)
  toolsOf(doc)[0].config.maxDepth = 1
  const errors = inspectPatch(doc).errors
  assert.ok(errors.includes('product providers must be Host rows, outside preset.plugins'))
  assert.ok(errors.some((error) => error.includes('requires maxDepth: provider-managed')))
})

test('reports malformed structure without throwing', () => {
  for (const value of [null, {}, [], [{ insert: [null] }], [{ insert: [{ name: '@deepseek-ai/dsh-agent-preset', config: { plugins: 'invalid' } }] }]]) {
    assert.ok(inspectPatch(value).errors.length > 0)
  }
})

test('dependency lookup prefers installation and falls back to the bundle', (t) => {
  const root = tempRoot(t)
  const installation = path.join(root, 'installation')
  const bundle = path.join(root, 'bundle')
  addPackage(installation, PROVIDERS[0], '0.2.0-rc.2')
  addPackage(bundle, PROVIDERS[0], '0.2.1-rc.3')
  addPackage(bundle, PROVIDERS[1], '0.2.1-rc.3')
  const first = resolveDependency(installation, bundle, PROVIDERS[0])
  assert.equal(first.source, 'installation')
  assert.equal(first.manifest.version, '0.2.0-rc.2')
  assert.equal(resolveDependency(installation, bundle, PROVIDERS[1]).source, 'bundle')
  assert.equal(resolveDependency(installation, bundle, 'missing-package'), null)
})

test('metadata lookup supports packages that do not export package.json without evaluating code', (t) => {
  const root = tempRoot(t)
  const dir = addPackage(root, 'example-provider', '1.0.0', { exports: { '.': './index.js' } })
  fs.writeFileSync(path.join(dir, 'index.js'), 'throw new Error("provider code must not run")')
  assert.equal(resolvePackage(root, 'example-provider').manifest.version, '1.0.0')
})

test('explicit installation root is validated without invoking a CLI', (t) => {
  const root = tempRoot(t)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: BASELINE_DSH }))
  assert.equal(findInstallRoot({ DSH_PRESET_CC_INSTALL: root }), root)
  assert.equal(findInstallRoot({ DSH_PRESET_CC_INSTALL: path.join(root, 'missing') }), null)
})

test('help is dependency-free and states preflight limits', () => {
  const result = spawnSync(process.execPath, [doctor, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /static preflight/)
  assert.match(result.stdout, /0\.2\.1-rc\.3/)
  assert.match(result.stdout, /not guarantee enforced read-only/)
  assert.doesNotMatch(result.stdout, /must resolve from the dsh INSTALLATION|ready — restart/)
})
