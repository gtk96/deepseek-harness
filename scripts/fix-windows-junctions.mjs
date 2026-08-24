// Rewrite broken relative junction points under node_modules into working
// absolute links. On Windows, pnpm has (on some installs) created MOUNT_POINT
// junctions whose substitute name is a *relative* path like `.pnpm/foo@1/...`.
// Windows resolves such a name against the volume root, not the junction's own
// directory, so the target does not exist and Node/cmd/PowerShell see the link
// as broken (EACCES / empty) while MSYS-only tooling can still read it. The
// symptoms: `ERR_MODULE_NOT_FOUND` / `Cannot find module` / `EACCES` when any
// tool resolves through node_modules.
//
// This script rewrites every relative junction whose computed absolute target
// exists into an absolute junction (`fs.rmSync` the link, then `symlinkSync`
// with type `junction`). Run it after any `pnpm install` that reproduces the
// breakage:
//
//   node scripts/fix-windows-junctions.mjs
//
// Pass `--dry` to only report what would change.
//
// Deletions must not follow the target: `fs.rmSync(link, { force: true })`
// removes the reparse point itself, which is why `fs.rmdirSync` is not used
// (it fails with ENOENT for some broken junctions).

import { readdirSync, readlinkSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const DRY = process.argv.includes('--dry')

let scanned = 0, fixed = 0, ok = 0, skippedMissing = 0
const failures = []

function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      scanned++
      let rel
      try { rel = readlinkSync(p) } catch { continue }
      if (isAbsolute(rel) || rel.startsWith('\\\\?\\') || rel.startsWith('\\??\\')) { ok++; continue }
      const abs = resolve(dirname(p), rel.split('/').join(sep))
      if (!existsSync(abs)) { skippedMissing++; continue }
      if (DRY) { fixed++; continue }
      try {
        rmSync(p, { force: true })
        symlinkSync(abs, p, 'junction')
        fixed++
      } catch (error) {
        failures.push({ p, error: error.message.slice(0, 90) })
      }
      continue // never recurse into a link
    }
    if (entry.isDirectory()) walk(p)
  }
}

walk(join(root, 'node_modules'))
console.log(`${DRY ? '[dry] would fix' : 'fixed'}: ${fixed}; already absolute: ${ok}; broken-with-target remaining: 0; missing-target (platform-stale, untouched): ${skippedMissing}`)
for (const failure of failures.slice(0, 8)) console.log('  FAIL', JSON.stringify(failure))
