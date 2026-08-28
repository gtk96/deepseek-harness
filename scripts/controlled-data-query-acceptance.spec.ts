import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { validateAcceptanceInput } from '../deploy/controlled-data-query/scripts/validate-acceptance-input.mjs'

const execFileAsync = promisify(execFile)


function runValidatorStdin(scriptPath: string, input: string): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', (code) => { resolvePromise({ code, stdout, stderr }) })
    child.stdin.end(input)
  })
}

const repositoryRoot = resolve(import.meta.dirname, '..')
const evidenceDirectory = resolve(repositoryRoot, '..', 'synthetic-controlled-query-evidence')
const declarationPath = resolve(
  repositoryRoot,
  'deploy/controlled-data-query/scripts/validate-acceptance-input.d.mts',
)
const templatePath = resolve(
  repositoryRoot,
  'deploy/controlled-data-query/acceptance/input.template.json',
)

function fixture(): Record<string, unknown> {
  return {
    version: 1,
    environment: {
      name: 'synthetic-validator-fixture',
      namespace: 'controlled-query-test',
      browserBaseUrl: 'https://dic.test.internal/fe/bigdata/dic/',
      maxCompute: {
        endpoint: 'https://service.cn-test.maxcompute.aliyun.com/api',
        project: 'analytics_test',
        quota: 'test_acceptance_quota',
        credentialRef: 'secret-manager://test-store/maxcompute-acceptance',
        jobListPermissionConfirmed: true,
      },
    },
    governance: {
      dataset: {
        code: 'sales_daily',
        name: 'Synthetic daily sales',
        sourceRef: 'analytics_test.sales_fact',
        status: 'published',
        maxRows: 100,
        queryTimeoutSeconds: 30,
        scopeRequired: true,
        scopeMappings: [
          { dimension: 'org_dim', op: 'eq', source: 'org_code' },
        ],
      },
      metrics: [
        {
          code: 'sales_amount',
          name: 'Synthetic sales amount',
          sourceField: 'sales_amount',
          aggregation: 'sum',
          status: 'published',
          definition: 'Synthetic gross sales amount for validator tests.',
        },
        {
          code: 'order_count',
          name: 'Synthetic order count',
          sourceField: 'order_id',
          aggregation: 'count',
          status: 'published',
          definition: 'Synthetic distinct order count for validator tests.',
        },
        {
          code: 'draft_margin',
          name: 'Synthetic draft margin',
          sourceField: 'margin_amount',
          aggregation: 'sum',
          status: 'draft',
          definition: 'Synthetic unpublished metric for rejection tests.',
        },
      ],
      dimensions: [
        {
          code: 'org_dim',
          name: 'Synthetic organization',
          sourceField: 'org_code',
          dataType: 'string',
          operators: ['eq', 'in'],
          status: 'published',
          definition: 'Synthetic governed organization dimension.',
        },
        {
          code: 'biz_date',
          name: 'Synthetic business date',
          sourceField: 'biz_date',
          dataType: 'date',
          operators: ['eq', 'between', 'gte', 'lte'],
          status: 'published',
          definition: 'Synthetic fixed business date dimension.',
        },
        {
          code: 'sensitive_dim',
          name: 'Synthetic denied dimension',
          sourceField: 'sensitive_class',
          dataType: 'string',
          operators: ['eq'],
          status: 'published',
          definition: 'Synthetic published but denied dimension.',
        },
      ],
    },
    subjects: {
      authorized: {
        userId: 'synthetic_authorized_user',
        dataRoles: ['synthetic_sales_reader'],
        authorityProfile: { org_code: ['SYNTHETIC_ORG'] },
      },
      unauthorized: {
        userId: 'synthetic_unauthorized_user',
        dataRoles: ['synthetic_no_access'],
        authorityProfile: {},
      },
    },
    policies: [
      {
        subjectType: 'user', subjectValue: 'synthetic_authorized_user',
        resourceType: 'dataset', resourceCode: 'sales_daily', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'data_role', subjectValue: 'synthetic_sales_reader',
        resourceType: 'metric', resourceCode: 'sales_amount', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'data_role', subjectValue: 'synthetic_sales_reader',
        resourceType: 'metric', resourceCode: 'order_count', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'data_role', subjectValue: 'synthetic_sales_reader',
        resourceType: 'dimension', resourceCode: 'org_dim', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'data_role', subjectValue: 'synthetic_sales_reader',
        resourceType: 'dimension', resourceCode: 'biz_date', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'user', subjectValue: 'synthetic_authorized_user',
        resourceType: 'dimension', resourceCode: 'sensitive_dim', effect: 'deny',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
      {
        subjectType: 'user', subjectValue: 'synthetic_unauthorized_user',
        resourceType: 'dataset', resourceCode: 'sales_daily', effect: 'deny',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      },
    ],
    baseline: {
      businessDate: '2026-08-24',
      question: 'Show synthetic sales and order count by organization for the fixed date.',
      semanticRequest: {
        datasetCode: 'sales_daily',
        metricCodes: ['sales_amount', 'order_count'],
        dimensionCodes: ['org_dim', 'biz_date'],
        filters: [{ dimensionCode: 'org_dim', operator: 'eq', value: ['SYNTHETIC_ORG'] }],
        timeRange: { dimensionCode: 'biz_date', start: '2026-08-24', end: '2026-08-25' },
        orderBy: [{ field: 'org_dim', direction: 'asc' }],
        limit: 100,
      },
      benchmarkSql: "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date = '2026-08-24' AND org_code = 'SYNTHETIC_ORG' GROUP BY org_code, biz_date ORDER BY org_dim ASC LIMIT 100",
      expectedResult: {
        columns: ['org_dim', 'biz_date', 'sales_amount', 'order_count'],
        rows: [['SYNTHETIC_ORG', '2026-08-24', 123.45, 3]],
        rowCount: 1,
      },
    },
    rejectionCases: {
      unauthorizedUser: {
        question: 'Show synthetic sales for an unauthorized subject.',
        expectedErrorCode: 'DQ_POLICY_DENIED',
      },
      unpublishedMetric: {
        question: 'Show the synthetic unpublished draft margin.',
        metricCode: 'draft_margin',
        expectedErrorCode: 'DQ_SEMANTIC_INVALID',
      },
      deniedDimension: {
        question: 'Show synthetic sales by the explicitly denied dimension.',
        dimensionCode: 'sensitive_dim',
        expectedErrorCode: 'DQ_POLICY_DENIED',
      },
      assertionReplay: {
        question: 'Replay the same synthetic one-time assertion.',
        expectedErrorCode: 'DQ_ASSERTION_REPLAYED',
      },
    },
    controls: Object.fromEntries(
      Object.entries({
        rowLimit: 'MAX_100_ROWS',
        timeout: 'DQ_QUERY_TIMEOUT',
        cancellation: 'MAXCOMPUTE_JOB_CANCELLED',
        sourceFailure: 'DQ_SOURCE_FAILED',
        dshFailure: 'DQ_AGENT_FAILED',
        resultIntegrity: 'DQ_RESULT_INVALID',
      }).map(([name, expected]) => [name, {
        procedure: `Execute the approved synthetic ${name} acceptance procedure.`,
        rollback: `Restore the synthetic ${name} fixture to its recorded baseline.`,
        approvedBy: 'synthetic_test_owner',
        expected,
      }]),
    ),
    evidenceDirectory,
  }
}

function at(input: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  let value: unknown = input
  for (const key of keys) value = (value as Record<string, unknown>)[key]
  return value as Record<string, unknown>
}

function expectInvalid(
  mutate: (input: Record<string, unknown>) => void,
  message: string,
): void {
  const input = structuredClone(fixture())
  mutate(input)
  expect(() => validateAcceptanceInput(input, { repositoryRoot })).toThrow(message)
}

describe('controlled data-query acceptance input', () => {
  it('accepts only a complete synthetic fixture and returns a safe deterministic summary', () => {
    const input = fixture()
    const result = validateAcceptanceInput(input, { repositoryRoot })
    const reordered = Object.fromEntries(Object.entries(input).reverse())

    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect({ ...result, fingerprint: undefined }).toEqual({
      fingerprint: undefined,
      publishedMetricCount: 2,
      publishedDimensionCount: 3,
      policyCount: 7,
    })
    expect(validateAcceptanceInput(reordered, { repositoryRoot }).fingerprint).toBe(result.fingerprint)
    expect(JSON.stringify(result)).not.toContain('synthetic_authorized_user')
    expect(JSON.stringify(result)).not.toContain('SELECT')
  })

  it('runs the CLI on an out-of-tree file and prints only safe summary fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'controlled-query-acceptance-'))
    try {
      const inputPath = join(directory, 'input.json')
      await writeFile(inputPath, JSON.stringify(fixture()))
      const scriptPath = resolve(
        repositoryRoot,
        'deploy/controlled-data-query/scripts/validate-acceptance-input.mjs',
      )
      const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, inputPath])
      expect(stderr).toBe('')
      expect(stdout).toMatch(/valid: publishedMetrics=2, publishedDimensions=3, policies=7, fingerprint=sha256:[a-f0-9]{64}/u)
      expect(stdout).not.toContain('sales_daily')
      expect(stdout).not.toContain('synthetic_authorized_user')
      expect(stdout).not.toContain('SELECT')
      expect(stdout).not.toContain('analytics_test.sales_fact')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('validates the exact stdin bytes without reopening an input path', async () => {
    const scriptPath = resolve(
      repositoryRoot,
      'deploy/controlled-data-query/scripts/validate-acceptance-input.mjs',
    )
    const result = await runValidatorStdin(scriptPath, JSON.stringify(fixture()))
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/valid: publishedMetrics=2, publishedDimensions=3, policies=7, fingerprint=sha256:[a-f0-9]{64}/u)
    expect(result.stdout).not.toContain('sales_daily')
    expect(result.stdout).not.toContain('synthetic_authorized_user')
  })

  it('rejects lexical and canonical repository containment through junctions', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'controlled-query-junction-'))
    const outward = resolve(repositoryRoot, `.tmp-acceptance-junction-${process.pid}`)
    const inward = join(outside, 'inward-repository')
    const junctionType = process.platform === 'win32' ? 'junction' : 'dir'
    try {
      await symlink(outside, outward, junctionType)
      await symlink(repositoryRoot, inward, junctionType)

      const lexicalInput = fixture()
      lexicalInput.evidenceDirectory = join(outward, 'evidence')
      expect(() => validateAcceptanceInput(lexicalInput, { repositoryRoot }))
        .toThrow('must be outside the repository')

      const canonicalInput = fixture()
      canonicalInput.evidenceDirectory = join(inward, 'evidence')
      expect(() => validateAcceptanceInput(canonicalInput, { repositoryRoot }))
        .toThrow('must be outside the repository')

      const inputPath = join(outside, 'input.json')
      await writeFile(inputPath, JSON.stringify(fixture()))
      const scriptPath = resolve(
        repositoryRoot,
        'deploy/controlled-data-query/scripts/validate-acceptance-input.mjs',
      )
      let stderr = ''
      try {
        await execFileAsync(process.execPath, [scriptPath, join(outward, 'input.json')])
      } catch (error) {
        if (error !== null && typeof error === 'object' && 'stderr' in error
          && typeof error.stderr === 'string') stderr = error.stderr
      }
      expect(stderr).toContain('real acceptance input must be outside the repository')
    } finally {
      await Promise.allSettled([unlink(outward), unlink(inward)])
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('requires a real Git repository directory in both the library type and runtime API', async () => {
    const callWithoutOptions = validateAcceptanceInput as unknown as (input: unknown) => unknown
    expect(() => callWithoutOptions(fixture())).toThrow('$options')
    expect(() => validateAcceptanceInput(fixture(), {
      repositoryRoot: resolve(repositoryRoot, 'package.json'),
    })).toThrow('existing Git repository directory')

    const fakeRoots = await mkdtemp(join(tmpdir(), 'controlled-query-fake-git-'))
    try {
      const fileMarkerRoot = join(fakeRoots, 'file-marker')
      const emptyDirectoryRoot = join(fakeRoots, 'empty-directory')
      const malformedMetadataRoot = join(fakeRoots, 'malformed-metadata')
      await mkdir(fileMarkerRoot)
      await writeFile(join(fileMarkerRoot, '.git'), 'not a repository')
      await mkdir(join(emptyDirectoryRoot, '.git'), { recursive: true })
      await mkdir(join(malformedMetadataRoot, '.git', 'objects'), { recursive: true })
      await mkdir(join(malformedMetadataRoot, '.git', 'refs'), { recursive: true })
      await writeFile(join(malformedMetadataRoot, '.git', 'HEAD'), 'not-a-valid-head')
      await writeFile(join(malformedMetadataRoot, '.git', 'config'), 'this is not valid git config')
      expect(() => validateAcceptanceInput(fixture(), { repositoryRoot: fileMarkerRoot }))
        .toThrow('existing Git repository directory')
      expect(() => validateAcceptanceInput(fixture(), { repositoryRoot: emptyDirectoryRoot }))
        .toThrow('existing Git repository directory')
      expect(() => validateAcceptanceInput(fixture(), { repositoryRoot: malformedMetadataRoot }))
        .toThrow('existing Git repository directory')
    } finally {
      await rm(fakeRoots, { recursive: true, force: true })
    }

    const declaration = await readFile(declarationPath, 'utf8')
    expect(declaration).toContain('options: AcceptanceInputValidationOptions')
    expect(declaration).not.toContain('options?: AcceptanceInputValidationOptions')
  })

  it('rejects the committed placeholder template by design', async () => {
    const template = JSON.parse(await readFile(templatePath, 'utf8')) as unknown
    expect(() => validateAcceptanceInput(template, { repositoryRoot })).toThrow('placeholder')
  })

  it.each([
    ['a second published metric', (input: Record<string, unknown>) => {
      const governance = at(input, 'governance')
      governance.metrics = (governance.metrics as unknown[]).slice(0, 1)
    }, 'at least 3'],
    ['a second authorized and a denied dimension', (input: Record<string, unknown>) => {
      const governance = at(input, 'governance')
      governance.dimensions = (governance.dimensions as unknown[]).slice(0, 2)
    }, 'at least 3'],
    ['the fixed 100-row maximum', (input: Record<string, unknown>) => {
      at(input, 'governance', 'dataset').maxRows = 101
    }, 'fixed product maximum of 100'],
    ['the fixed 30-second timeout', (input: Record<string, unknown>) => {
      at(input, 'governance', 'dataset').queryTimeoutSeconds = 31
    }, 'fixed product maximum of 30'],
    ['a scope value from the authorized staff profile', (input: Record<string, unknown>) => {
      at(input, 'subjects', 'authorized').authorityProfile = {}
    }, 'must provide every configured authoritative scope value'],
    ['an out-of-tree evidence directory', (input: Record<string, unknown>) => {
      input.evidenceDirectory = resolve(repositoryRoot, '.tmp-acceptance-evidence')
    }, 'must be outside the repository'],
  ])('rejects an input without %s', (_label, mutate, message) => {
    expectInvalid(mutate, message)
  })

  it('rejects placeholders, secret keys, credential values, and open policy subjects without echoing values', () => {
    const placeholder = 'REPLACE_ME_PRIVATE_PROJECT'
    const credential = 'LTAI1234567890123456'
    expectInvalid((input) => { at(input, 'environment', 'maxCompute').project = placeholder }, 'placeholder')
    expectInvalid((input) => { at(input, 'environment').name = 'TBD' }, 'placeholder')
    expectInvalid((input) => { at(input, 'environment').name = 'Authorization: Basic ZmFrZTpmYWtl' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'environment').name = 'Basic abc.def' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'environment').name = 'Bearer abc.def' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = '(Basic abc.def)' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = 'prefix(password=fake-value)' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = 'https://host.invalid/?token=fake-value' }, 'credential-like values')
    expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = '[authorization:Bearer abc.def]' }, 'credential-like values')
    for (const assignment of [
      'access_key=fake-value',
      'secret_key=fake-value',
      'accessKey=fake-value',
      'secretKey=fake-value',
      'accessKeySecret=fake-value',
    ]) {
      expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = assignment }, 'credential-like values')
    }
    expectInvalid((input) => { at(input, 'controls', 'timeout').procedure = 'password=fake-value-for-rejection' }, 'credential-like values')

    const withSecretKey = structuredClone(fixture())
    at(withSecretKey, 'environment').password = 'private-password-value'
    let keyMessage = ''
    try { validateAcceptanceInput(withSecretKey, { repositoryRoot }) } catch (error) {
      keyMessage = error instanceof Error ? error.message : String(error)
    }
    expect(keyMessage).toContain('secret-bearing keys')
    expect(keyMessage).not.toContain('private-password-value')

    const withCredential = structuredClone(fixture())
    at(withCredential, 'environment').name = credential
    let credentialMessage = ''
    try { validateAcceptanceInput(withCredential, { repositoryRoot }) } catch (error) {
      credentialMessage = error instanceof Error ? error.message : String(error)
    }
    expect(credentialMessage).toContain('credential-like values')
    expect(credentialMessage).not.toContain(credential)

    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies[0]!.subjectValue = '*'
    }, 'open policy subjects are forbidden')
  })

  it('rejects subject collisions and grants to the unauthorized subject', () => {
    expectInvalid((input) => {
      at(input, 'subjects', 'unauthorized').userId = 'synthetic_authorized_user'
    }, 'must be distinct')
    expectInvalid((input) => {
      at(input, 'subjects', 'unauthorized').dataRoles = ['synthetic_sales_reader']
    }, 'must not share acceptance data roles')
    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies.push({
        subjectType: 'user', subjectValue: 'synthetic_unauthorized_user',
        resourceType: 'metric', resourceCode: 'sales_amount', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      })
    }, 'allows must be the exact')
  })

  it('rejects mutation, an unrelated table, missing fixed date, and mismatched semantic aliases', () => {
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date = '2026-08-24'; DELETE FROM analytics_test.sales_fact"
    }, 'must be one uncommented statement')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.unrelated_table WHERE biz_date = '2026-08-24' GROUP BY org_code, biz_date"
    }, 'must read exactly the declared MaxCompute project.table')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact, analytics_test.unrelated_table WHERE biz_date = '2026-08-24' GROUP BY org_code, biz_date"
    }, 'must exactly match the semantic request and authority scope')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(rogue_amount) + sales_amount AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date = '2026-08-24' GROUP BY org_code, biz_date"
    }, 'metric SELECT items must be exactly')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date != '2026-08-24' GROUP BY org_code, biz_date"
    }, 'must exactly match the semantic request and authority scope')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = 'SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact GROUP BY org_code, biz_date'
    }, 'must exactly match the semantic request and authority scope')
    expectInvalid((input) => {
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS wrong_alias, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date = '2026-08-24' GROUP BY org_code, biz_date"
    }, 'semantic code as its exact AS alias')
  })

  it('rejects expected-result columns, width, count, and product-limit violations', () => {
    expectInvalid((input) => {
      at(input, 'baseline', 'expectedResult').columns = ['unrelated_column']
    }, 'must exactly equal dimensionCodes followed by metricCodes')
    expectInvalid((input) => {
      at(input, 'baseline', 'expectedResult').rows = [['SYNTHETIC_ORG']]
    }, 'must match the column width')
    expectInvalid((input) => {
      at(input, 'baseline', 'expectedResult').rowCount = 2
    }, 'must equal rows.length')
    expectInvalid((input) => {
      const expected = at(input, 'baseline', 'expectedResult')
      const row = ['SYNTHETIC_ORG', '2026-08-24', 1, 1]
      expected.rows = Array.from({ length: 101 }, () => row)
      expected.rowCount = 101
    }, 'must not exceed the product row limit')
  })

  it('rejects the designated denied dimension everywhere in the success request', () => {
    expectInvalid((input) => {
      const semanticRequest = at(input, 'baseline', 'semanticRequest')
      const filters = semanticRequest.filters as Array<Record<string, unknown>>
      filters.push({
        dimensionCode: 'sensitive_dim',
        operator: 'eq',
        value: ['DENIED_FILTER_VALUE'],
      })
      at(input, 'baseline').benchmarkSql = "SELECT org_code AS org_dim, biz_date AS biz_date, SUM(sales_amount) AS sales_amount, COUNT(order_id) AS order_count FROM analytics_test.sales_fact WHERE biz_date = '2026-08-24' AND org_code = 'SYNTHETIC_ORG' AND sensitive_class = 'DENIED_FILTER_VALUE' GROUP BY org_code, biz_date ORDER BY org_dim ASC LIMIT 100"
    }, 'unused by the success request')
  })

  it('enforces deny precedence and an exact policy set', () => {
    expectInvalid((input) => {
      input.policies = (input.policies as Array<Record<string, unknown>>)
        .filter(item => item.resourceCode !== 'order_count')
    }, 'one effective allow')
    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies.push({
        subjectType: 'user', subjectValue: 'synthetic_authorized_user',
        resourceType: 'metric', resourceCode: 'sales_amount', effect: 'deny',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      })
    }, 'denies must be the exact')
    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies.push({
        subjectType: 'user', subjectValue: 'synthetic_authorized_user',
        resourceType: 'metric', resourceCode: 'draft_margin', effect: 'allow',
        status: 'published', validFrom: null, expiresAt: null, createdBy: 'synthetic_publisher',
      })
    }, 'allows must be the exact')
  })

  it('rejects wrong stable rejection codes', () => {
    expectInvalid((input) => {
      at(input, 'rejectionCases', 'unpublishedMetric').expectedErrorCode = 'DQ_POLICY_DENIED'
    }, 'must equal DQ_SEMANTIC_INVALID')
    expectInvalid((input) => {
      at(input, 'rejectionCases', 'assertionReplay').expectedErrorCode = 'DQ_ASSERTION_INVALID'
    }, 'must equal DQ_ASSERTION_REPLAYED')
  })

  it('rejects policy timestamps that the governance database projection cannot preserve', () => {
    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies[0]!.validFrom = '2026-08-23T00:00:00.123456Z'
    }, 'second-precision ISO timestamp')
    expectInvalid((input) => {
      const policies = input.policies as Array<Record<string, unknown>>
      policies[0]!.expiresAt = '2026-02-30T00:00:00Z'
    }, 'second-precision ISO timestamp')

    const input = fixture()
    const policies = input.policies as Array<Record<string, unknown>>
    policies[0]!.validFrom = '2026-08-23T08:00:00+08:00'
    expect(() => validateAcceptanceInput(input, { repositoryRoot })).not.toThrow()
  })

  it('requires exact keys and an approved rollback for every limit and fault control', () => {
    expectInvalid((input) => { at(input, 'environment').unexpected = true }, 'must contain exactly')
    expectInvalid((input) => { delete at(input, 'controls', 'sourceFailure').rollback }, 'must contain exactly')
    expectInvalid((input) => { at(input, 'controls', 'timeout').approvedBy = '__REQUIRED__' }, 'placeholder')
  })
})
