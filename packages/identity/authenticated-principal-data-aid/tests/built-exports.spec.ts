/** Plain-Node smoke for every published non-index Loader entry. */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const examplesDirectory = fileURLToPath(new URL('../../../../examples/', import.meta.url))
const subpaths = [
  'mse-gateway',
  'loopback-test',
  'turn-principal',
  'data-query-tool',
  'direct-query-tools',
  'dic-be-turn-ingress',
  'data-aid-health',
] as const
const built = subpaths.every(subpath => existsSync(join(packageDirectory, 'lib', `${subpath}.js`)))
const execFileAsync = promisify(execFile)

const probe = `
const packageName = '@deepseek-ai/dsh-authenticated-principal-data-aid/'
const subpaths = ${JSON.stringify(subpaths)}
const modules = await Promise.all(subpaths.map(subpath => import(packageName + subpath)))
const valid = modules.every((module, index) => index < 3
  ? typeof module.default === 'function'
  : typeof module.apply === 'function')
if (!valid) throw new Error('published data-aid subpath has an unexpected module interface')
console.log(JSON.stringify(subpaths))
`

describe.skipIf(!built)('authenticated-principal-data-aid built exports', () => {
  it('imports every declared Loader subpath from the package tarball view', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: examplesDirectory,
      timeout: 15_000,
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout) as unknown).toEqual(subpaths)
  })
})
