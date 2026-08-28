/** Keyless assembled-application transcript for the dedicated Data Aid agent. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { sensitiveContentKinds } from './sensitive-content.ts'

const driver = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/data-aid/driver.ts', import.meta.url))
const config = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/data-aid/cordis.yml', import.meta.url))
const expected = fileURLToPath(new URL('./snapshots/data-query-transcript.expected.jsonl', import.meta.url))
const tsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('dedicated Data Aid runnable snapshot', () => {
  it('shows one governed success and one fake-broker policy rejection', async () => {
    const result = await runLoaderSmoke({
      label: 'Data Aid keyless transcript',
      tempDirPrefix: 'data-aid-snapshot-',
      binScript: driver,
      libBinScript: driver,
      configPath: config,
      binArgs: [config],
      tsconfigPath: tsconfig,
      env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
    })
    expect(result.stderr).toBe('')
    expect(sensitiveContentKinds(result.stdout)).toEqual([])
    expect(result.stdout).toBe(await readFile(expected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('detects each sensitive category without returning matched values', () => {
    const fixture = [
      'LTAI1234567890ABCDEF',
      'secretKey=super-secret-value-123',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.signature123',
      'Authorization: Bearer bearer-token-value-123',
      'Cookie: session=private-value',
      'SELECT amount FROM governed_table',
    ].join('\n')
    expect(sensitiveContentKinds(fixture).sort()).toEqual([
      'accessKey', 'authorization', 'cookie', 'jwt', 'rawSql', 'secretKey',
    ])
    expect(sensitiveContentKinds('lTaI1234567890aBcDeF')).toEqual(['accessKey'])
    expect(sensitiveContentKinds('AK=access-value-123')).toEqual(['accessKey'])
    expect(sensitiveContentKinds('SK=secret-value-123')).toEqual(['secretKey'])
  })
})
