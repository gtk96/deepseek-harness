/** MaxCompute identity and permission snapshot resolver for data-aid requests. */

import type {
  DataOrgCode,
  DataRole,
  DdUserId,
  GimpStaffId,
  GkUserId,
  TeamCode,
} from '@deepseek-ai/dsh-authenticated-principal'
import type {
  DataAidAuthorityPartition,
  DataAidPrincipalResolution,
  DataAidPrincipalResolutionInput,
  DataAidPrincipalResolver,
  DataAidTablePrincipalResolverOptions,
} from './types.ts'

const IDENTITY_TABLE = 'ods_pl_gimp__gk_dingtalk_user_hourly'
const AUTHORITY_TABLE = 'dmr_pty_staff_attribute_authority_hourly'
const DATE_PARTITION = /^\d{8}$/u
const HOUR_PARTITION = /^\d{2}$/u

/**
 * Build the fixed data-aid authority query for one DingTalk user and one MC snapshot.
 *
 * The query keeps the established identity and authority rules: both mapped ids
 * must agree, both source rows must be active, and both tables use the same
 * explicit `dt`/`ht` partition. User input is emitted as a SQL string literal
 * only after quote escaping; partition values are restricted to their formats.
 * @param input - DingTalk id and explicit MaxCompute partition.
 * @returns the read-only authority SQL submitted to the injected query executor.
 * @throws when the id or partition is missing or has an invalid format.
 */
export function buildDataAidAuthoritySql(input: {
  readonly ddUserId: DdUserId
  readonly partition: DataAidAuthorityPartition
}): string {
  assertAuthoritySqlInput(input)
  if (typeof input.ddUserId !== 'string' || input.ddUserId.length === 0) {
    throw new TypeError('data-aid authority SQL requires a non-empty ddUserId')
  }
  validatePartition(input.partition)

  const ddUserId = sqlStringLiteral(input.ddUserId)
  const dt = sqlStringLiteral(input.partition.dt)
  const ht = sqlStringLiteral(input.partition.ht)
  return `SELECT
  i.gk_userid AS gk_userid,
  a.gimp_staff_id AS gimp_staff_id,
  i.dd_userid AS dd_userid,
  a.dd_staff_id AS dd_staff_id,
  GET_JSON_OBJECT(a.staff_authority, '$.data_role') AS data_role,
  GET_JSON_OBJECT(a.staff_authority, '$.area_ids') AS team_codes,
  GET_JSON_OBJECT(a.staff_authority, '$.data_org') AS data_org_code
FROM ${IDENTITY_TABLE} AS i
JOIN ${AUTHORITY_TABLE} AS a
  ON i.gk_userid = a.gimp_staff_id
 AND i.dd_userid = a.dd_staff_id
WHERE i.dt = ${dt}
  AND i.ht = ${ht}
  AND a.dt = ${dt}
  AND a.ht = ${ht}
  AND i.dd_userid = ${ddUserId}
  AND i.status = '1'
  AND a.staff_status = '1'
LIMIT 2`
}

/**
 * Create a resolver backed by the confirmed MaxCompute identity and authority tables.
 *
 * The deployment supplies the query transport and explicit current-partition
 * selection. A query result is accepted only when it is one row whose mapped ids,
 * role, team codes, and organization codes are all non-empty strings. Any other
 * result is `undefined`, so the provider turns it into authentication failure.
 * @param options - injected query executor and partition resolver.
 * @returns a data-aid Principal resolver.
 * @throws when either injected hook is not callable.
 */
export function createDataAidTablePrincipalResolver(
  options: DataAidTablePrincipalResolverOptions,
): DataAidPrincipalResolver {
  assertResolverOptions(options)

  return {
    async resolve(input: DataAidPrincipalResolutionInput): Promise<DataAidPrincipalResolution | undefined> {
      const partition = await options.resolvePartition(input)
      const sql = buildDataAidAuthoritySql({
        ddUserId: input.visitor.ddUserId,
        partition,
      })
      const rows = await options.query(sql, input.signal)
      if (!Array.isArray(rows) || rows.length !== 1) return undefined
      return parseAuthorityRow(rows[0], input.visitor.ddUserId)
    },
  }
}

/** Assert runtime authority SQL input before reading its fields. */
function assertAuthoritySqlInput(input: unknown): asserts input is {
  readonly ddUserId: DdUserId
  readonly partition: DataAidAuthorityPartition
} {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('data-aid authority SQL input is required')
  }
}

/** Assert injected resolver hooks before capturing them. */
function assertResolverOptions(options: unknown): asserts options is DataAidTablePrincipalResolverOptions {
  if (options === null
    || typeof options !== 'object'
    || !('query' in options)
    || typeof options.query !== 'function'
    || !('resolvePartition' in options)
    || typeof options.resolvePartition !== 'function') {
    throw new TypeError('data-aid table resolver requires query and resolvePartition')
  }
}

/** Validate the explicit partition before it reaches the SQL text. */
function validatePartition(partition: unknown): asserts partition is DataAidAuthorityPartition {
  if (partition === null || typeof partition !== 'object') {
    throw new TypeError('data-aid authority partition is required')
  }
  const record = partition as Record<string, unknown>
  if (typeof record.dt !== 'string' || !DATE_PARTITION.test(record.dt)) {
    throw new TypeError('data-aid authority dt must be YYYYMMDD')
  }
  if (typeof record.ht !== 'string' || !HOUR_PARTITION.test(record.ht)) {
    throw new TypeError('data-aid authority ht must be HH')
  }
}

/** Quote one SQL string literal without allowing a user id to alter the query. */
function sqlStringLiteral(value: string): string {
  if (value.includes('\u0000')) throw new TypeError('data-aid authority SQL value contains NUL')
  return `'${value.replaceAll("'", "''")}'`
}

/** Parse one externally returned authority row without widening malformed values. */
function parseAuthorityRow(
  row: unknown,
  requestedDdUserId: DdUserId,
): DataAidPrincipalResolution | undefined {
  if (!isRecord(row)) return undefined

  const gkUserId = nonEmptyString(row.gk_userid)
  const gimpStaffId = nonEmptyString(row.gimp_staff_id)
  const rowDdUserId = nonEmptyString(row.dd_userid)
  const rowDdStaffId = nonEmptyString(row.dd_staff_id)
  const dataRole = nonEmptyString(row.data_role)
  const teamCodes = commaSeparatedCodes(row.team_codes)
  const dataOrgCodes = commaSeparatedCodes(row.data_org_code)
  if (gkUserId === undefined
    || gimpStaffId === undefined
    || rowDdUserId === undefined
    || rowDdStaffId === undefined
    || dataRole === undefined
    || teamCodes === undefined
    || dataOrgCodes === undefined) {
    return undefined
  }
  if (rowDdUserId !== requestedDdUserId
    || rowDdStaffId !== requestedDdUserId
    || gkUserId !== gimpStaffId) {
    return undefined
  }

  return {
    gkUserId: gkUserId as GkUserId,
    gimpStaffId: gimpStaffId as GimpStaffId,
    dataRole: dataRole as DataRole,
    teamCodes: teamCodes as readonly TeamCode[],
    dataOrgCodes: dataOrgCodes as readonly DataOrgCode[],
  }
}

/** Accept only object rows, not arrays or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep the source string unchanged while rejecting null, empty, and non-string values. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) return undefined
  return value
}

/** Convert the authority's comma-separated scope text into branded code values. */
function commaSeparatedCodes(value: unknown): readonly string[] | undefined {
  const text = nonEmptyString(value)
  if (text === undefined) return undefined
  const codes = text.split(',').map(code => code.trim())
  if (codes.some(code => code.length === 0)) return undefined
  return codes
}
