#!/usr/bin/env node
/**
 * CI gate: replica of DSH's `evaluatePluginCompatibility`
 * (deepseek-harness `packages/boot/app-boot/src/plugin-compatibility.ts`).
 *
 * Checks this package's `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer
 * requirements against a given DSH runtime version. Prereleases participate
 * in ranges; `workspace:^`, `workspace:~`, and `workspace:*` refer to the
 * runtime itself; an empty range is incompatible.
 *
 * Usage:
 *   node scripts/check-peer-compat.mjs <dsh-runtime-version>
 *   node scripts/check-peer-compat.mjs            # resolves the installed @deepseek-ai/dsh
 *
 * Exits 0 when every dsh peer is satisfied by the runtime, 1 when at least
 * one is not, 2 on usage or manifest errors.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import semver from 'semver'

const require = createRequire(import.meta.url)

function runtimeVersionOf(value) {
  if (typeof value !== 'string' || semver.valid(value) === null) {
    throw new Error(`Invalid dsh runtime version: ${JSON.stringify(value)}; expected a semantic version`)
  }
  return value
}

function resolveRuntimeVersion() {
  const arg = process.argv[2]
  if (arg !== undefined) return runtimeVersionOf(arg)
  try {
    const entry = require.resolve('@deepseek-ai/dsh')
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8'))
    return runtimeVersionOf(manifest.version)
  } catch {
    console.error('usage: node scripts/check-peer-compat.mjs <dsh-runtime-version>')
    process.exit(2)
  }
}

const manifestPath = path.join(import.meta.dirname, '..', 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
  console.error('package.json must be an object')
  process.exit(2)
}
if (!Object.hasOwn(manifest, 'peerDependencies')) {
  console.log('ok: no peerDependencies; nothing to check')
  process.exit(0)
}
const dependencies = manifest.peerDependencies
if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
  console.error('peerDependencies must be an object')
  process.exit(2)
}

let runtimeVersion
try {
  runtimeVersion = resolveRuntimeVersion()
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exit(2)
}

const peers = {}
for (const [name, range] of Object.entries(dependencies)) {
  if (typeof range !== 'string') {
    console.error(`peerDependencies[${JSON.stringify(name)}] must be a string`)
    process.exit(2)
  }
  if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
  const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range
  if (requirement.trim() === '' || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) {
    peers[name] = range
  }
}

if (Object.keys(peers).length === 0) {
  console.log(`ok: all dsh peers satisfied by runtime ${runtimeVersion}`)
  process.exit(0)
}

console.error(`FAIL: ${manifest.name}@${manifest.version} is incompatible with dsh ${runtimeVersion}: peerDependencies ${JSON.stringify(peers)}.`)
console.error('Update the plugin or install a plugin version compatible with this dsh runtime.')
console.error('In a live profile the explicit remedy is `dsh plugin allow-version <name>@<version> --dsh-version <runtime> --accept-risk`.')
process.exit(1)
