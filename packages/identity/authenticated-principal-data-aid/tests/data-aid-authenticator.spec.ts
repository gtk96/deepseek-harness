import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { McpToolCallRequest } from '@deepseek-ai/dsh-mcp-client/mcp-clients'
import {
  PrincipalAuthenticationError,
  type AuthenticatedPrincipal,
} from '@deepseek-ai/dsh-authenticated-principal'
import {
  buildDataAidAuthoritySql,
  createDataAidMaxComputeMcpQuery,
  createDataAidTablePrincipalResolver,
  DataAidGatewayAuthenticator,
  DataAidVisitorError,
  parseDataAidGatewayVisitor,
  type DataAidAuthorityPartition,
  type DataAidAuthorityQuery,
  type DataAidPrincipalResolution,
  type DataAidPrincipalResolutionInput,
} from '../src/index.ts'

function jsonHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://dsh.internal/api/data', { headers })
}

function validRequest(userId = 'dd-001', clientId = '问数'): Request {
  return requestWithHeaders({
    'gk-service-user': jsonHeader({ id: userId, displayName: 'ignored' }),
    'gk-service-app': jsonHeader({ clientId }),
  })
}

function resolution(userId: string): DataAidPrincipalResolution {
  return {
    gkUserId: `gk:${userId}` as DataAidPrincipalResolution['gkUserId'],
    gimpStaffId: `staff:${userId}` as DataAidPrincipalResolution['gimpStaffId'],
    dataRole: 'data-reader' as DataAidPrincipalResolution['dataRole'],
    teamCodes: [`team:${userId}`] as unknown as DataAidPrincipalResolution['teamCodes'],
    dataOrgCodes: [`org:${userId}`] as unknown as DataAidPrincipalResolution['dataOrgCodes'],
    authorizedScope: { tenant: 'fixture', userId },
  }
}

function authorityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gk_userid: 'mapped-001',
    gimp_staff_id: 'mapped-001',
    dd_userid: 'dd-001',
    dd_staff_id: 'dd-001',
    data_role: '0',
    team_codes: 'team-a, team-b',
    data_org_code: 'org-a,org-b',
    ...overrides,
  }
}

function authorityInput(
  userId = 'dd-001',
  signal: AbortSignal = new AbortController().signal,
): DataAidPrincipalResolutionInput {
  const request = validRequest(userId)
  return {
    visitor: parseDataAidGatewayVisitor(request),
    request,
    signal,
  }
}

async function mounted(options: ConstructorParameters<typeof DataAidGatewayAuthenticator>[1]): Promise<{
  readonly ctx: Context
  readonly service: DataAidGatewayAuthenticator
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(DataAidGatewayAuthenticator, options)
  await fiber
  const service = ctx.get('authenticatedPrincipal')
  if (service === undefined) throw new Error('data-aid Principal service was not installed')
  return {
    ctx,
    service: service as DataAidGatewayAuthenticator,
    dispose: () => fiber.dispose(),
  }
}

async function expectAuthenticationFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(PrincipalAuthenticationError)
  await expect(operation).rejects.toMatchObject({ message: 'authentication failed' })
}

describe('data-aid gateway visitor parser', () => {
  it('parses strict Base64 UTF-8 visitor and optional application headers', () => {
    const parsed = parseDataAidGatewayVisitor(validRequest())
    expect(parsed).toEqual({ ddUserId: 'dd-001', clientId: '问数' })
    expect(Object.isFrozen(parsed)).toBe(true)

    const withoutApp = parseDataAidGatewayVisitor(requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-002' }),
    }))
    expect(withoutApp).toEqual({ ddUserId: 'dd-002' })
  })

  it.each([
    requestWithHeaders({}),
    requestWithHeaders({ 'gk-service-user': '' }),
    requestWithHeaders({ 'gk-service-user': 'not-base64' }),
    requestWithHeaders({ 'gk-service-user': 'AB==' }),
    requestWithHeaders({ 'gk-service-user': jsonHeader([]) }),
    requestWithHeaders({ 'gk-service-user': jsonHeader({}) }),
    requestWithHeaders({ 'gk-service-user': jsonHeader({ id: '' }) }),
    requestWithHeaders({ 'gk-service-user': jsonHeader({ id: '   ' }) }),
    requestWithHeaders({ 'gk-service-user': jsonHeader({ id: 1 }) }),
    requestWithHeaders({ 'gk-service-user': Buffer.from('{', 'utf8').toString('base64') }),
    requestWithHeaders({ 'gk-service-user': Buffer.from([0xff]).toString('base64') }),
    requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-001' }),
      'gk-service-app': '',
    }),
    requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-001' }),
      'gk-service-app': jsonHeader([]),
    }),
    requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-001' }),
      'gk-service-app': jsonHeader({ clientId: '' }),
    }),
    requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-001' }),
      'gk-service-app': jsonHeader({ clientId: 7 }),
    }),
  ])('rejects incomplete or malformed visitor %#', (request) => {
    expect(() => parseDataAidGatewayVisitor(request)).toThrow(DataAidVisitorError)
  })

  it('rejects a duplicate user header instead of selecting one value', () => {
    const headers = new Headers()
    headers.append('gk-service-user', jsonHeader({ id: 'first' }))
    headers.append('gk-service-user', jsonHeader({ id: 'second' }))
    expect(() => parseDataAidGatewayVisitor(new Request('https://dsh.internal/api', { headers })))
      .toThrow(DataAidVisitorError)
  })
})

describe('DataAidGatewayAuthenticator', () => {
  it('rejects incomplete provider options at construction', () => {
    const verifier = () => true
    const resolver = { resolve: () => undefined }
    const invalidOptions: unknown[] = [
      undefined,
      {},
      { verifyGatewayRequest: true, resolver },
      { verifyGatewayRequest: verifier },
      { verifyGatewayRequest: verifier, resolver: null },
      { verifyGatewayRequest: verifier, resolver: {} },
    ]
    for (const options of invalidOptions) {
      const ctx = new Context()
      expect(() => new DataAidGatewayAuthenticator(ctx, options as never))
        .toThrow('requires verifyGatewayRequest and resolver.resolve')
    }
  })

  it('passes trusted transport metadata to the existing resolver and freezes its result', async () => {
    const signal = new AbortController().signal
    const request = validRequest('dd-100', '问数-web')
    const inputs: DataAidPrincipalResolutionInput[] = []
    const teams = ['team:dd-100'] as unknown as DataAidPrincipalResolution['teamCodes']
    const orgs = ['org:dd-100'] as unknown as DataAidPrincipalResolution['dataOrgCodes']
    const { service, dispose } = await mounted({
      verifyGatewayRequest: async (received, receivedSignal) => {
        expect(received).toBe(request)
        expect(receivedSignal).toBe(signal)
        return true
      },
      resolver: {
        resolve: (input) => {
          inputs.push(input)
          return {
            ...resolution('dd-100'),
            teamCodes: teams,
            dataOrgCodes: orgs,
          }
        },
      },
    })

    const result = await service.authenticate(request, signal)
    expect(result).toMatchObject({
      ddUserId: 'dd-100',
      clientId: '问数-web',
      gkUserId: 'gk:dd-100',
      gimpStaffId: 'staff:dd-100',
      dataRole: 'data-reader',
      teamCodes: ['team:dd-100'],
      dataOrgCodes: ['org:dd-100'],
      authorizedScope: { tenant: 'fixture', userId: 'dd-100' },
    })
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ visitor: { ddUserId: 'dd-100', clientId: '问数-web' } })
    expect(inputs[0]?.request).toBe(request)
    expect(inputs[0]?.signal).toBe(signal)
    expect((result as AuthenticatedPrincipal).teamCodes).not.toBe(teams)
    expect((result as AuthenticatedPrincipal).dataOrgCodes).not.toBe(orgs)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.teamCodes)).toBe(true)
    expect(Object.isFrozen(result.dataOrgCodes)).toBe(true)
    expect(Object.isFrozen(result.authorizedScope)).toBe(true)
    await dispose()
  })

  it('omits optional visitor and resolver fields when they are absent', async () => {
    const request = requestWithHeaders({
      'gk-service-user': jsonHeader({ id: 'dd-optional' }),
    })
    const { service, dispose } = await mounted({
      verifyGatewayRequest: () => true,
      resolver: {
        resolve: () => {
          const resolved = resolution('dd-optional')
          const { authorizedScope: _authorizedScope, ...withoutScope } = resolved
          return withoutScope
        },
      },
    })

    const result = await service.authenticate(request, new AbortController().signal)
    expect(result).toMatchObject({
      ddUserId: 'dd-optional',
      gkUserId: 'gk:dd-optional',
      gimpStaffId: 'staff:dd-optional',
      dataRole: 'data-reader',
      teamCodes: ['team:dd-optional'],
      dataOrgCodes: ['org:dd-optional'],
    })
    expect(result).not.toHaveProperty('clientId')
    expect(result).not.toHaveProperty('authorizedScope')
    await dispose()
  })

  it('fails closed when the gateway verifier rejects or throws', async () => {
    let resolverCalls = 0
    const rejected = await mounted({
      verifyGatewayRequest: () => false,
      resolver: { resolve: () => { resolverCalls += 1; return resolution('never') } },
    })
    await expectAuthenticationFailure(rejected.service.authenticate(validRequest(), new AbortController().signal))
    expect(resolverCalls).toBe(0)
    await rejected.dispose()

    const thrown = await mounted({
      verifyGatewayRequest: () => { throw new Error('proxy unavailable') },
      resolver: { resolve: () => { resolverCalls += 1; return resolution('never') } },
    })
    await expectAuthenticationFailure(thrown.service.authenticate(validRequest(), new AbortController().signal))
    expect(resolverCalls).toBe(0)
    await thrown.dispose()
  })

  it('fails closed on parser, missing mapping, and resolver failures', async () => {
    const parserFailure = await mounted({
      verifyGatewayRequest: () => true,
      resolver: { resolve: () => resolution('never') },
    })
    await expectAuthenticationFailure(parserFailure.service.authenticate(
      requestWithHeaders({ 'gk-service-user': 'bad' }),
      new AbortController().signal,
    ))
    await parserFailure.dispose()

    const unexpectedParserFailure = await mounted({
      verifyGatewayRequest: () => true,
      resolver: { resolve: () => resolution('never') },
    })
    const throwingRequest = {
      headers: {
        get: () => { throw new Error('header access failed') },
      },
    } as unknown as Request
    await expectAuthenticationFailure(unexpectedParserFailure.service.authenticate(
      throwingRequest,
      new AbortController().signal,
    ))
    await unexpectedParserFailure.dispose()

    const missing = await mounted({
      verifyGatewayRequest: () => true,
      resolver: { resolve: () => undefined },
    })
    await expectAuthenticationFailure(missing.service.authenticate(validRequest(), new AbortController().signal))
    await missing.dispose()

    const failed = await mounted({
      verifyGatewayRequest: () => true,
      resolver: { resolve: () => { throw new Error('authority unavailable') } },
    })
    await expectAuthenticationFailure(failed.service.authenticate(validRequest(), new AbortController().signal))
    await failed.dispose()
  })
})

describe('MaxCompute data-aid table resolver', () => {
  const partition: DataAidAuthorityPartition = { dt: '20260819', ht: '14' }

  it('builds the confirmed fields, dual-id join, active filters, and escaped user literal', () => {
    const ddUserId = parseDataAidGatewayVisitor(validRequest("dd-'quoted")).ddUserId
    const sql = buildDataAidAuthoritySql({ ddUserId, partition })

    expect(sql).toContain('i.gk_userid AS gk_userid')
    expect(sql).toContain('a.gimp_staff_id AS gimp_staff_id')
    expect(sql).toContain('i.dd_userid AS dd_userid')
    expect(sql).toContain('a.dd_staff_id AS dd_staff_id')
    expect(sql).toContain("GET_JSON_OBJECT(a.staff_authority, '$.data_role') AS data_role")
    expect(sql).toContain("GET_JSON_OBJECT(a.staff_authority, '$.area_ids') AS team_codes")
    expect(sql).toContain("GET_JSON_OBJECT(a.staff_authority, '$.data_org') AS data_org_code")
    expect(sql).toContain('ON i.gk_userid = a.gimp_staff_id')
    expect(sql).toContain('AND i.dd_userid = a.dd_staff_id')
    expect(sql).toContain("i.dt = '20260819'")
    expect(sql).toContain("i.ht = '14'")
    expect(sql).toContain("a.dt = '20260819'")
    expect(sql).toContain("a.ht = '14'")
    expect(sql).toContain("i.dd_userid = 'dd-''quoted'")
    expect(sql).toContain("i.status = '1'")
    expect(sql).toContain("a.staff_status = '1'")
    expect(sql).toContain("a.staff_status = '1'\nLIMIT 2")
  })

  it.each([
    { dt: '', ht: '14' },
    { dt: '2026081', ht: '14' },
    { dt: '202608190', ht: '14' },
    { dt: '20260819', ht: '' },
    { dt: '20260819', ht: '1' },
    { dt: '20260819', ht: '140' },
    { dt: '20260819', ht: 'x4' },
  ])('rejects an invalid explicit partition %#', (invalidPartition) => {
    const ddUserId = parseDataAidGatewayVisitor(validRequest()).ddUserId
    expect(() => buildDataAidAuthoritySql({
      ddUserId,
      partition: invalidPartition,
    })).toThrow('data-aid authority')
  })

  it('rejects a missing id and a NUL-containing SQL value', () => {
    const validId = parseDataAidGatewayVisitor(validRequest()).ddUserId
    expect(() => buildDataAidAuthoritySql({
      ddUserId: '' as typeof validId,
      partition,
    })).toThrow('non-empty ddUserId')
    expect(() => buildDataAidAuthoritySql({
      ddUserId: '\u0000' as typeof validId,
      partition,
    })).toThrow('contains NUL')
  })

  it('passes the request signal to the partition and query hooks and maps one valid row', async () => {
    const signal = new AbortController().signal
    const input = authorityInput('dd-table-001', signal)
    const partitionInputs: DataAidPrincipalResolutionInput[] = []
    const querySignals: AbortSignal[] = []
    const queries: string[] = []
    const query: DataAidAuthorityQuery = async (sql, querySignal) => {
      queries.push(sql)
      querySignals.push(querySignal)
      return [authorityRow({ dd_userid: 'dd-table-001', dd_staff_id: 'dd-table-001' })]
    }
    const resolver = createDataAidTablePrincipalResolver({
      resolvePartition: (received) => {
        partitionInputs.push(received)
        return partition
      },
      query,
    })

    const result = await resolver.resolve(input)

    expect(result).toEqual({
      gkUserId: 'mapped-001',
      gimpStaffId: 'mapped-001',
      dataRole: '0',
      teamCodes: ['team-a', 'team-b'],
      dataOrgCodes: ['org-a', 'org-b'],
    })
    expect(partitionInputs).toEqual([input])
    expect(querySignals).toEqual([signal])
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain("i.dd_userid = 'dd-table-001'")
  })

  it('fails closed for zero, multiple, non-array, and malformed query results', async () => {
    const rows: readonly unknown[][] = [
      [],
      [authorityRow(), authorityRow()],
      [null],
      [[]],
    ]
    for (const resultRows of rows) {
      const resolver = createDataAidTablePrincipalResolver({
        resolvePartition: () => partition,
        query: async () => resultRows,
      })
      await expect(resolver.resolve(authorityInput())).resolves.toBeUndefined()
    }

    const nonArrayResolver = createDataAidTablePrincipalResolver({
      resolvePartition: () => partition,
      query: async () => null as never,
    })
    await expect(nonArrayResolver.resolve(authorityInput())).resolves.toBeUndefined()
  })

  it.each([
    ['gk_userid is null', { gk_userid: null }],
    ['gimp_staff_id is numeric', { gimp_staff_id: 0 }],
    ['dd_userid does not match the request', { dd_userid: 'other-dd' }],
    ['dd_staff_id does not match the request', { dd_staff_id: 'other-dd' }],
    ['mapped ids do not agree', { gimp_staff_id: 'other-mapped' }],
    ['data_role is null', { data_role: null }],
    ['data_role is empty', { data_role: '' }],
    ['data_role is whitespace', { data_role: '   ' }],
    ['team_codes is numeric', { team_codes: 0 }],
    ['team_codes is null', { team_codes: null }],
    ['team_codes is empty', { team_codes: '' }],
    ['team_codes contains an empty item', { team_codes: 'team-a,' }],
    ['data_org_code is numeric', { data_org_code: 0 }],
    ['data_org_code is null', { data_org_code: null }],
    ['data_org_code is empty', { data_org_code: '' }],
    ['data_org_code contains an empty item', { data_org_code: ',org-a' }],
  ])('fails closed when %s', async (_name, override) => {
    const resolver = createDataAidTablePrincipalResolver({
      resolvePartition: () => partition,
      query: async () => [authorityRow(override)],
    })
    await expect(resolver.resolve(authorityInput())).resolves.toBeUndefined()
  })

  it('propagates query failure to the provider and preserves fail-closed authentication', async () => {
    const resolver = createDataAidTablePrincipalResolver({
      resolvePartition: () => partition,
      query: async () => { throw new Error('MaxCompute unavailable') },
    })
    await expect(resolver.resolve(authorityInput())).rejects.toThrow('MaxCompute unavailable')

    const { service, dispose } = await mounted({
      verifyGatewayRequest: () => true,
      resolver,
    })
    await expectAuthenticationFailure(service.authenticate(validRequest(), new AbortController().signal))
    await dispose()
  })

  it('rejects incomplete factory hooks instead of creating a partial resolver', () => {
    const invalidOptions: unknown[] = [
      undefined,
      {},
      { query: true, resolvePartition: () => partition },
      { query: async () => [], resolvePartition: true },
    ]
    for (const options of invalidOptions) {
      expect(() => createDataAidTablePrincipalResolver(options as never))
        .toThrow('requires query and resolvePartition')
    }
  })
})


describe('MaxCompute MCP authority query', () => {
  const options = {
    serverName: 'maxcompute-authority',
    toolName: 'execute_sql',
    project: 'giikin',
    maxCU: 10,
    timeoutSeconds: 30,
  }

  it('uses the direct raw MCP call with the request signal and accepts a complete structured result', async () => {
    const signal = new AbortController().signal
    const calls: unknown[] = []
    const rows = [authorityRow()]
    const query = createDataAidMaxComputeMcpQuery({
      call: async (call: McpToolCallRequest) => {
        calls.push(call)
        return {
          structuredContent: {
            success: true,
            truncated: false,
            rowCount: 1,
            rowsReturned: 1,
            data: rows,
          },
        }
      },
    } as never, options)

    await expect(query('SELECT authority', signal)).resolves.toEqual(rows)
    expect(calls).toEqual([{
      serverName: 'maxcompute-authority',
      toolName: 'execute_sql',
      arguments: {
        project: 'giikin',
        sql: 'SELECT authority',
        async: false,
        maxCU: 10,
        timeout: 30,
      },
      signal,
    }])
  })

  it.each([
    undefined,
    { isError: true },
    { structuredContent: { success: false, truncated: false, rowCount: 0, rowsReturned: 0, data: [] } },
    { structuredContent: { success: true, truncated: true, rowCount: 1, rowsReturned: 1, data: [authorityRow()] } },
    { structuredContent: { success: true, truncated: false, rowCount: 2, rowsReturned: 1, data: [authorityRow()] } },
    { structuredContent: { success: true, truncated: false, rowCount: 1, rowsReturned: 1, data: null } },
  ])('rejects incomplete or unstructured MCP result %#', async (result) => {
    const query = createDataAidMaxComputeMcpQuery({
      call: async () => result as never,
    } as never, options)
    await expect(query('SELECT authority', new AbortController().signal)).rejects.toThrow('data-aid MaxCompute MCP query')
  })

  it.each([
    undefined,
    { ...options, serverName: '' },
    { ...options, toolName: '' },
    { ...options, project: '' },
    { ...options, maxCU: 0 },
    { ...options, timeoutSeconds: 1.5 },
  ])('rejects invalid deployment options %#', (invalid) => {
    expect(() => createDataAidMaxComputeMcpQuery({ call: async () => ({}) } as never, invalid as never))
      .toThrow('data-aid MaxCompute MCP query')
  })
})
