import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CODE = /^[a-z][a-z0-9_]{1,63}$/u
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const NAMESPACE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/u
const DATABASE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u
const PLACEHOLDER = /(?:__REQUIRED(?:_[A-Z0-9-]+)*__|\$\{|<[^>]+>|replace[-_ ]?me|change[-_ ]?me|placeholder|\b(?:todo|tbd|tbc|fixme|xxx)\b|example\.invalid)/iu
const ACCESS_KEY = /(?:LTAI|AKID)[A-Za-z0-9]{12,}/u
const KEY_ASSIGNMENT = /(?:AK|SK|access(?:[_-]?key)(?:[_-]?(?:id|secret))?|secret(?:[_-]?key)?|authorization|cookie|password|token)\s*[:=]/iu
const AUTHORIZATION_VALUE = /\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+\/-]+={0,2}/iu
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u
const AUTHORITY_SCOPE_FIELDS = new Set([
  'gimp_staff_id',
  'org_code',
  'family_name',
  'authority_currency_id',
  'authority_team_id',
  'authority_family_id',
  'authority_plat_id',
  'data_company_code',
  'data_family_code',
  'data_team_code',
  'data_dept_code',
  'data_group_code',
  'full_code',
  'down_gimp_staff_id',
])
const FILTER_OPERATORS = new Set(['eq', 'in', 'between', 'gte', 'lte'])
const DIMENSION_TYPES = new Set(['string', 'number', 'date', 'datetime', 'time'])
const AGGREGATIONS = new Set(['sum', 'count', 'avg', 'min', 'max'])
const SUBJECT_TYPES = new Set(['user', 'data_role'])
const RESOURCE_TYPES = new Set(['dataset', 'metric', 'dimension'])
const EFFECTS = new Set(['allow', 'deny'])
const OPEN_SUBJECTS = new Set(['*', 'all', 'anonymous', 'everyone', 'public'])
const FAILURE_CONTROL_EXPECTATIONS = new Map([
  ['rowLimit', 'MAX_100_ROWS'],
  ['timeout', 'DQ_QUERY_TIMEOUT'],
  ['cancellation', 'MAXCOMPUTE_JOB_CANCELLED'],
  ['sourceFailure', 'DQ_SOURCE_FAILED'],
  ['dshFailure', 'DQ_AGENT_FAILED'],
  ['resultIntegrity', 'DQ_RESULT_INVALID'],
])
const FAILURE_CONTROL_NAMES = [...FAILURE_CONTROL_EXPECTATIONS.keys()]
const VERIFIED_GIT_ROOTS = new Set()

function fail(path, reason) {
  throw new Error(`acceptance input invalid at ${path}: ${reason}`)
}

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  return value
}

function exactKeys(value, path, expected) {
  const actual = Object.keys(record(value, path)).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `must contain exactly: ${wanted.join(', ')}`)
  }
}

function array(value, path, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) fail(path, `must be an array with at least ${minimum} item(s)`)
  return value
}

function text(value, path, { min = 1, max = 4096, allowPlaceholder = false } = {}) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < min || value.length > max) {
    fail(path, `must be a trimmed string between ${min} and ${max} characters`)
  }
  if (!allowPlaceholder && PLACEHOLDER.test(value)) fail(path, 'must not contain a placeholder')
  return value
}

function choice(value, path, choices) {
  if (typeof value !== 'string' || !choices.has(value)) fail(path, 'contains an unsupported closed-set value')
  return value
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

function integer(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(path, `must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function code(value, path) {
  const result = text(value, path, { max: 64 })
  if (!CODE.test(result)) fail(path, 'must be a lowercase semantic code')
  return result
}

function sourceField(value, path) {
  const result = text(value, path, { max: 128 })
  if (!IDENTIFIER.test(result)) fail(path, 'must be a single physical field identifier')
  return result
}

function date(value, path) {
  const result = text(value, path, { min: 10, max: 10 })
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!BUSINESS_DATE.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    fail(path, 'must be a canonical calendar date')
  }
  return result
}

function optionalTimestamp(value, path) {
  if (value === null) return null
  const result = text(value, path, { max: 40 })
  const parsed = new Date(result)
  const calendar = new Date(`${result.slice(0, 10)}T00:00:00Z`)
  if (
    !DATABASE_TIMESTAMP.test(result)
    || Number.isNaN(parsed.valueOf())
    || Number.isNaN(calendar.valueOf())
    || calendar.toISOString().slice(0, 10) !== result.slice(0, 10)
  ) {
    fail(path, 'must be null or a second-precision ISO timestamp')
  }
  return result
}

function nextDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

function forbiddenKey(key) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .toLowerCase()
  const parts = normalized.split('_')
  return parts.some(part => ['ak', 'sk', 'secret', 'token', 'password', 'authorization', 'cookie', 'jwt'].includes(part))
    || normalized.includes('access_key')
}

function scanSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKey(key)) fail(`${path}.${key}`, 'secret-bearing keys are forbidden')
      scanSecrets(item, `${path}.${key}`)
    }
    return
  }
  if (typeof value === 'string' && PLACEHOLDER.test(value)) fail(path, 'must not contain a placeholder')
  if (typeof value === 'string' && (
    ACCESS_KEY.test(value) || JWT.test(value) || KEY_ASSIGNMENT.test(value) || AUTHORIZATION_VALUE.test(value)
  )) {
    fail(path, 'credential-like values are forbidden')
  }
}

function subject(value, path) {
  exactKeys(value, path, ['userId', 'dataRoles', 'authorityProfile'])
  const userId = text(value.userId, `${path}.userId`, { max: 64 })
  if (OPEN_SUBJECTS.has(userId.toLowerCase())) fail(`${path}.userId`, 'must identify one real authenticated subject')
  const dataRoles = array(value.dataRoles, `${path}.dataRoles`).map((item, index) => {
    const role = text(item, `${path}.dataRoles[${index}]`, { max: 128 })
    if (OPEN_SUBJECTS.has(role.toLowerCase())) fail(`${path}.dataRoles[${index}]`, 'open roles are forbidden')
    return role
  })
  if (new Set(dataRoles).size !== dataRoles.length) fail(`${path}.dataRoles`, 'must be unique')
  const profile = record(value.authorityProfile, `${path}.authorityProfile`)
  for (const [field, rawValues] of Object.entries(profile)) {
    if (!AUTHORITY_SCOPE_FIELDS.has(field)) fail(`${path}.authorityProfile.${field}`, 'is not an authoritative scope field')
    const values = array(rawValues, `${path}.authorityProfile.${field}`, 1)
    values.forEach((item, index) => text(item, `${path}.authorityProfile.${field}[${index}]`, { max: 128 }))
  }
  return { userId, dataRoles, profile }
}

function metric(value, path) {
  exactKeys(value, path, ['code', 'name', 'sourceField', 'aggregation', 'status', 'definition'])
  return {
    code: code(value.code, `${path}.code`),
    name: text(value.name, `${path}.name`, { max: 128 }),
    sourceField: sourceField(value.sourceField, `${path}.sourceField`),
    aggregation: choice(value.aggregation, `${path}.aggregation`, AGGREGATIONS),
    status: choice(value.status, `${path}.status`, new Set(['draft', 'published'])),
    definition: text(value.definition, `${path}.definition`, { min: 8, max: 1000 }),
  }
}

function dimension(value, path) {
  exactKeys(value, path, ['code', 'name', 'sourceField', 'dataType', 'operators', 'status', 'definition'])
  const operators = array(value.operators, `${path}.operators`, 1).map((item, index) =>
    choice(item, `${path}.operators[${index}]`, FILTER_OPERATORS),
  )
  if (new Set(operators).size !== operators.length) fail(`${path}.operators`, 'must be unique')
  return {
    code: code(value.code, `${path}.code`),
    name: text(value.name, `${path}.name`, { max: 128 }),
    sourceField: sourceField(value.sourceField, `${path}.sourceField`),
    dataType: choice(value.dataType, `${path}.dataType`, DIMENSION_TYPES),
    operators,
    status: choice(value.status, `${path}.status`, new Set(['draft', 'published'])),
    definition: text(value.definition, `${path}.definition`, { min: 8, max: 1000 }),
  }
}

function policy(value, path, resources) {
  exactKeys(value, path, [
    'subjectType', 'subjectValue', 'resourceType', 'resourceCode', 'effect', 'status',
    'validFrom', 'expiresAt', 'createdBy',
  ])
  const result = {
    subjectType: choice(value.subjectType, `${path}.subjectType`, SUBJECT_TYPES),
    subjectValue: text(value.subjectValue, `${path}.subjectValue`, { max: 128 }),
    resourceType: choice(value.resourceType, `${path}.resourceType`, RESOURCE_TYPES),
    resourceCode: code(value.resourceCode, `${path}.resourceCode`),
    effect: choice(value.effect, `${path}.effect`, EFFECTS),
    status: choice(value.status, `${path}.status`, new Set(['published'])),
    validFrom: optionalTimestamp(value.validFrom, `${path}.validFrom`),
    expiresAt: optionalTimestamp(value.expiresAt, `${path}.expiresAt`),
    createdBy: text(value.createdBy, `${path}.createdBy`, { max: 64 }),
  }
  if (OPEN_SUBJECTS.has(result.subjectValue.toLowerCase())) fail(`${path}.subjectValue`, 'open policy subjects are forbidden')
  if (!resources[result.resourceType].has(result.resourceCode)) fail(`${path}.resourceCode`, 'does not reference a declared resource')
  if (result.validFrom !== null && result.expiresAt !== null && Date.parse(result.validFrom) >= Date.parse(result.expiresAt)) {
    fail(path, 'validFrom must be earlier than expiresAt')
  }
  return result
}

function expectedResult(value, path, expectedColumns) {
  exactKeys(value, path, ['columns', 'rows', 'rowCount'])
  const columns = array(value.columns, `${path}.columns`, 1).map((item, index) =>
    text(item, `${path}.columns[${index}]`, { max: 128 }),
  )
  if (columns.length !== expectedColumns.length || columns.some((item, index) => item !== expectedColumns[index])) {
    fail(`${path}.columns`, 'must exactly equal dimensionCodes followed by metricCodes')
  }
  const rows = array(value.rows, `${path}.rows`, 1)
  if (rows.length > 100) fail(`${path}.rows`, 'must not exceed the product row limit')
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) fail(`${path}.rows[${rowIndex}]`, 'must match the column width')
    row.forEach((cell, columnIndex) => {
      const scalar = cell === null || ['string', 'number', 'boolean'].includes(typeof cell)
      if (!scalar || (typeof cell === 'number' && !Number.isFinite(cell))) {
        fail(`${path}.rows[${rowIndex}][${columnIndex}]`, 'must be a finite JSON scalar')
      }
    })
  })
  integer(value.rowCount, `${path}.rowCount`, 0, 100)
  if (value.rowCount !== rows.length) fail(`${path}.rowCount`, 'must equal rows.length')
  return { columns, rows, rowCount: value.rowCount }
}

function tokenizeBenchmarkSql(sql, path) {
  const tokens = []
  let index = 0
  while (index < sql.length) {
    const character = sql[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (character === "'") {
      let value = ''
      index += 1
      let closed = false
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          value += "'"
          index += 2
        } else if (sql[index] === "'") {
          index += 1
          closed = true
          break
        } else {
          value += sql[index]
          index += 1
        }
      }
      if (!closed) fail(path, 'contains an unterminated string literal')
      tokens.push({ type: 'string', value })
      continue
    }
    const word = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0]
    if (word) {
      tokens.push({ type: 'word', value: word })
      index += word.length
      continue
    }
    const number = sql.slice(index).match(/^\d+(?:\.\d+)?/u)?.[0]
    if (number) {
      tokens.push({ type: 'number', value: number })
      index += number.length
      continue
    }
    const operator = sql.slice(index).match(/^(?:>=|<=|<>|!=|=|>|<|\+|-|\/|%)/u)?.[0]
    if (operator) {
      tokens.push({ type: 'operator', value: operator })
      index += operator.length
      continue
    }
    if ('(),.*'.includes(character)) {
      tokens.push({ type: 'punctuation', value: character })
      index += 1
      continue
    }
    fail(path, 'contains syntax outside the accepted benchmark SELECT subset')
  }
  return tokens
}

function keyword(token, expected) {
  return token?.type === 'word' && token.value.toUpperCase() === expected
}

function selectItems(tokens, fromIndex, path) {
  const items = []
  let start = 1
  let depth = 0
  for (let index = 1; index < fromIndex; index += 1) {
    const token = tokens[index]
    if (token.type === 'punctuation' && token.value === '(') depth += 1
    if (token.type === 'punctuation' && token.value === ')') {
      depth -= 1
      if (depth < 0) fail(path, 'contains unbalanced parentheses')
    }
    if (token.type === 'punctuation' && token.value === ',' && depth === 0) {
      if (index === start) fail(path, 'contains an empty SELECT item')
      items.push(tokens.slice(start, index))
      start = index + 1
    }
  }
  if (depth !== 0 || start === fromIndex) fail(path, 'contains invalid SELECT items')
  items.push(tokens.slice(start, fromIndex))
  return items
}

function sqlLiteral(value) {
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function filterSql(field, operator, values) {
  const rendered = values.map(sqlLiteral)
  if (operator === 'eq') return `${field} = ${rendered[0]}`
  if (operator === 'in') return `${field} IN (${rendered.join(', ')})`
  if (operator === 'between') return `${field} BETWEEN ${rendered[0]} AND ${rendered[1]}`
  if (operator === 'gte') return `${field} >= ${rendered[0]}`
  if (operator === 'lte') return `${field} <= ${rendered[0]}`
  fail('benchmarkSql', 'contains an unsupported filter operator')
}

function sameTokens(actual, expected) {
  return actual.length === expected.length && actual.every((token, index) => {
    const expectedToken = expected[index]
    if (token.type !== expectedToken.type) return false
    return token.type === 'word'
      ? token.value.toUpperCase() === expectedToken.value.toUpperCase()
      : token.value === expectedToken.value
  })
}

function safeBenchmarkSql(value, path, context) {
  const sql = text(value, path, { min: 16, max: 20000 })
  if (/[;]/u.test(sql) || /--|\/\*|\*\//u.test(sql)) fail(path, 'must be one uncommented statement')
  const tokens = tokenizeBenchmarkSql(sql, path)
  if (!keyword(tokens[0], 'SELECT')) fail(path, 'must use the accepted single-table SELECT subset')
  const forbidden = new Set([
    'WITH', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'MERGE', 'CALL',
    'GRANT', 'REVOKE', 'TRUNCATE', 'INTO', 'JOIN', 'CROSS', 'UNION', 'INTERSECT', 'EXCEPT',
  ])
  for (const token of tokens) {
    if (token.type === 'word' && forbidden.has(token.value.toUpperCase())) {
      fail(path, 'must not contain mutation, privilege, multi-source, or compound-query syntax')
    }
  }
  const selectIndexes = tokens.flatMap((token, index) => keyword(token, 'SELECT') ? [index] : [])
  const fromIndexes = tokens.flatMap((token, index) => keyword(token, 'FROM') ? [index] : [])
  if (selectIndexes.length !== 1 || fromIndexes.length !== 1 || fromIndexes[0] <= 1) {
    fail(path, 'must contain exactly one SELECT and one FROM')
  }
  const fromIndex = fromIndexes[0]
  const [project, table] = context.sourceRef.split('.')
  const sourceTokens = tokens.slice(fromIndex + 1, fromIndex + 4)
  if (sourceTokens.length !== 3
    || sourceTokens[0].type !== 'word' || sourceTokens[0].value !== project
    || sourceTokens[1].type !== 'punctuation' || sourceTokens[1].value !== '.'
    || sourceTokens[2].type !== 'word' || sourceTokens[2].value !== table
    || (tokens[fromIndex + 4]?.type === 'punctuation' && tokens[fromIndex + 4]?.value === '.')) {
    fail(path, 'must read exactly the declared MaxCompute project.table')
  }

  const sourceEnd = fromIndex + 4

  const items = selectItems(tokens, fromIndex, path)
  if (items.length !== context.expectedColumns.length) {
    fail(path, 'SELECT item count must equal the semantic expected columns')
  }
  items.forEach((item, index) => {
    const asIndexes = item.flatMap((token, tokenIndex) => keyword(token, 'AS') ? [tokenIndex] : [])
    const asIndex = asIndexes.at(-1)
    const alias = asIndex === undefined ? undefined : item[asIndex + 1]
    if (asIndexes.length !== 1 || asIndex !== item.length - 2 || alias?.type !== 'word'
      || alias.value !== context.expectedColumns[index]) {
      fail(path, 'every SELECT item must use the semantic code as its exact AS alias')
    }
    const semantic = context.semanticFields.get(context.expectedColumns[index])
    const expression = item.slice(0, asIndex)
    if (!semantic) fail(path, 'SELECT alias does not resolve to a semantic field')
    if (semantic.aggregation === null) {
      if (expression.length !== 1 || expression[0].type !== 'word'
        || expression[0].value !== semantic.sourceField) {
        fail(path, 'dimension SELECT items must be exactly their governed physical field')
      }
    } else if (expression.length !== 4
      || !keyword(expression[0], semantic.aggregation.toUpperCase())
      || expression[1].type !== 'punctuation' || expression[1].value !== '('
      || expression[2].type !== 'word' || expression[2].value !== semantic.sourceField
      || expression[3].type !== 'punctuation' || expression[3].value !== ')') {
      fail(path, 'metric SELECT items must be exactly their governed aggregation and physical field')
    }
  })

  const expectedTail = tokenizeBenchmarkSql(context.expectedTail, path)
  if (!sameTokens(tokens.slice(sourceEnd), expectedTail)) {
    fail(path, 'WHERE, GROUP BY, ORDER BY, and LIMIT must exactly match the semantic request and authority scope')
  }
  return sql
}

function semanticRequest(value, path, context) {
  exactKeys(value, path, [
    'datasetCode', 'metricCodes', 'dimensionCodes', 'filters', 'timeRange', 'orderBy', 'limit',
  ])
  if (value.datasetCode !== context.datasetCode) fail(`${path}.datasetCode`, 'must select the declared dataset')
  const metricCodes = array(value.metricCodes, `${path}.metricCodes`, 1).map((item, index) => code(item, `${path}.metricCodes[${index}]`))
  const dimensionCodes = array(value.dimensionCodes, `${path}.dimensionCodes`, 1).map((item, index) => code(item, `${path}.dimensionCodes[${index}]`))
  for (const item of metricCodes) if (!context.publishedMetrics.has(item)) fail(`${path}.metricCodes`, 'must use published metrics')
  for (const item of dimensionCodes) if (!context.publishedDimensions.has(item)) fail(`${path}.dimensionCodes`, 'must use published dimensions')
  if (new Set(metricCodes).size !== metricCodes.length || new Set(dimensionCodes).size !== dimensionCodes.length) {
    fail(path, 'selected semantic fields must be unique')
  }
  const filters = array(value.filters, `${path}.filters`).map((item, index) => {
    const itemPath = `${path}.filters[${index}]`
    exactKeys(item, itemPath, ['dimensionCode', 'operator', 'value'])
    const dimensionCode = code(item.dimensionCode, `${itemPath}.dimensionCode`)
    const dimension = context.dimensions.get(dimensionCode)
    if (!dimension || dimension.status !== 'published') fail(`${itemPath}.dimensionCode`, 'must use a published dimension')
    const operator = choice(item.operator, `${itemPath}.operator`, FILTER_OPERATORS)
    if (!dimension.operators.includes(operator)) fail(`${itemPath}.operator`, 'is not allowed by the dimension')
    const values = array(item.value, `${itemPath}.value`, 1)
    if (values.length > 100) fail(`${itemPath}.value`, 'must contain at most 100 scalar values')
    if ((operator === 'between' && values.length !== 2) || (!['in', 'between'].includes(operator) && values.length !== 1)) {
      fail(`${itemPath}.value`, 'has the wrong cardinality for its operator')
    }
    values.forEach((rawValue, valueIndex) => {
      if (!['string', 'number', 'boolean'].includes(typeof rawValue)
        || (typeof rawValue === 'number' && !Number.isFinite(rawValue))) {
        fail(`${itemPath}.value[${valueIndex}]`, 'must be a finite JSON scalar')
      }
    })
    return { dimensionCode, operator, values }
  })
  exactKeys(value.timeRange, `${path}.timeRange`, ['dimensionCode', 'start', 'end'])
  const timeDimension = code(value.timeRange.dimensionCode, `${path}.timeRange.dimensionCode`)
  const timePolicy = context.dimensions.get(timeDimension)
  if (!timePolicy || timePolicy.status !== 'published' || !['date', 'datetime'].includes(timePolicy.dataType)) {
    fail(`${path}.timeRange.dimensionCode`, 'must reference a published date or datetime dimension')
  }
  if (value.timeRange.start !== context.businessDate || value.timeRange.end !== nextDate(context.businessDate)) {
    fail(`${path}.timeRange`, 'must cover exactly the declared business date with an exclusive next-day end')
  }
  const orderBy = array(value.orderBy, `${path}.orderBy`).map((item, index) => {
    const itemPath = `${path}.orderBy[${index}]`
    exactKeys(item, itemPath, ['field', 'direction'])
    const field = code(item.field, `${itemPath}.field`)
    if (![...metricCodes, ...dimensionCodes].includes(field)) fail(`${itemPath}.field`, 'must be selected')
    const direction = choice(item.direction, `${itemPath}.direction`, new Set(['asc', 'desc']))
    return { field, direction }
  })
  if (new Set(orderBy.map(item => item.field)).size !== orderBy.length) fail(`${path}.orderBy`, 'must be unique')
  integer(value.limit, `${path}.limit`, 1, 100)
  return { metricCodes, dimensionCodes, filters, timeDimension, orderBy, limit: value.limit }
}

function control(value, path, expected) {
  exactKeys(value, path, ['procedure', 'rollback', 'approvedBy', 'expected'])
  text(value.procedure, `${path}.procedure`, { min: 12, max: 2000 })
  text(value.rollback, `${path}.rollback`, { min: 12, max: 2000 })
  text(value.approvedBy, `${path}.approvedBy`, { min: 2, max: 128 })
  if (value.expected !== expected) fail(`${path}.expected`, 'must match the stable acceptance expectation')
}

function matchesSubject(item, subject) {
  return item.subjectType === 'user'
    ? item.subjectValue === subject.userId
    : subject.dataRoles.includes(item.subjectValue)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

function canonicalPath(candidate) {
  let existing = resolve(candidate)
  const suffix = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) fail('path', 'must have a resolvable existing ancestor')
    suffix.unshift(basename(existing))
    existing = parent
  }
  return resolve(realpathSync.native(existing), ...suffix)
}

function pathInside(root, candidate) {
  const relation = relative(root, candidate)
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function inside(root, candidate) {
  return pathInside(resolve(root), resolve(candidate))
    || pathInside(canonicalPath(root), canonicalPath(candidate))
}

function gitMetadataDirectory(repositoryRoot) {
  const marker = resolve(repositoryRoot, '.git')
  if (!existsSync(marker)) return null
  if (statSync(marker).isDirectory()) return marker
  if (!statSync(marker).isFile()) return null
  const match = readFileSync(marker, 'utf8').trim().match(/^gitdir:\s*(.+)$/u)
  return match ? resolve(dirname(marker), match[1]) : null
}

function isGitCheckout(repositoryRoot) {
  const gitDirectory = gitMetadataDirectory(repositoryRoot)
  if (!gitDirectory || !existsSync(gitDirectory) || !statSync(gitDirectory).isDirectory()
    || !existsSync(resolve(gitDirectory, 'HEAD'))) return false
  const commonDirFile = resolve(gitDirectory, 'commondir')
  const commonDirectory = existsSync(commonDirFile)
    ? resolve(gitDirectory, readFileSync(commonDirFile, 'utf8').trim())
    : gitDirectory
  if (!existsSync(resolve(commonDirectory, 'config'))
    || !existsSync(resolve(commonDirectory, 'objects'))
    || !statSync(resolve(commonDirectory, 'objects')).isDirectory()
    || !existsSync(resolve(commonDirectory, 'refs'))
    || !statSync(resolve(commonDirectory, 'refs')).isDirectory()) return false

  const canonicalRoot = canonicalPath(repositoryRoot)
  if (VERIFIED_GIT_ROOTS.has(canonicalRoot)) return true
  const result = spawnSync(
    'git',
    ['-C', repositoryRoot, 'rev-parse', '--show-toplevel', '--is-inside-work-tree'],
    { encoding: 'utf8', shell: false, timeout: 5000, windowsHide: true },
  )
  if (result.status !== 0 || result.error) return false
  const lines = result.stdout.trim().split(/\r?\n/u)
  if (lines.length !== 2 || lines[1] !== 'true' || canonicalPath(lines[0]) !== canonicalRoot) return false
  VERIFIED_GIT_ROOTS.add(canonicalRoot)
  return true
}

/**
 * Validate a complete out-of-tree Task 15/16 acceptance input without returning sensitive values.
 * @param {unknown} input Candidate JSON value.
 * @param {{ repositoryRoot: string }} options Repository root used to reject input evidence inside Git.
 * @returns {{ fingerprint: string, publishedMetricCount: number, publishedDimensionCount: number, policyCount: number }} Safe validation summary.
 */
export function validateAcceptanceInput(input, options) {
  exactKeys(options, '$options', ['repositoryRoot'])
  const repositoryRoot = text(options.repositoryRoot, '$options.repositoryRoot', { max: 1024 })
  if (!isAbsolute(repositoryRoot) || !existsSync(repositoryRoot)
    || !statSync(repositoryRoot).isDirectory() || !isGitCheckout(repositoryRoot)) {
    fail('$options.repositoryRoot', 'must be an existing Git repository directory')
  }
  scanSecrets(input)
  exactKeys(input, '$', [
    'version', 'environment', 'governance', 'subjects', 'policies', 'baseline',
    'rejectionCases', 'controls', 'evidenceDirectory',
  ])
  if (input.version !== 1) fail('$.version', 'must equal 1')

  exactKeys(input.environment, '$.environment', ['name', 'namespace', 'browserBaseUrl', 'maxCompute'])
  text(input.environment.name, '$.environment.name', { min: 3, max: 64 })
  const namespace = text(input.environment.namespace, '$.environment.namespace', { max: 63 })
  if (!NAMESPACE.test(namespace)) fail('$.environment.namespace', 'must be a Kubernetes namespace name')
  const browserBaseUrl = text(input.environment.browserBaseUrl, '$.environment.browserBaseUrl', { max: 512 })
  let browserUrl
  try { browserUrl = new URL(browserBaseUrl) } catch { fail('$.environment.browserBaseUrl', 'must be an absolute HTTPS URL') }
  if (browserUrl.protocol !== 'https:' || browserUrl.username || browserUrl.password || browserUrl.hash) {
    fail('$.environment.browserBaseUrl', 'must be credential-free HTTPS without a fragment')
  }
  exactKeys(input.environment.maxCompute, '$.environment.maxCompute', [
    'endpoint', 'project', 'quota', 'credentialRef', 'jobListPermissionConfirmed',
  ])
  const endpoint = text(input.environment.maxCompute.endpoint, '$.environment.maxCompute.endpoint', { max: 512 })
  let endpointUrl
  try { endpointUrl = new URL(endpoint) } catch { fail('$.environment.maxCompute.endpoint', 'must be an absolute HTTPS URL') }
  if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password || endpointUrl.hash) {
    fail('$.environment.maxCompute.endpoint', 'must be credential-free HTTPS without a fragment')
  }
  const project = text(input.environment.maxCompute.project, '$.environment.maxCompute.project', { max: 128 })
  if (!IDENTIFIER.test(project)) fail('$.environment.maxCompute.project', 'must be a MaxCompute project identifier')
  text(input.environment.maxCompute.quota, '$.environment.maxCompute.quota', { max: 128 })
  const credentialRef = text(input.environment.maxCompute.credentialRef, '$.environment.maxCompute.credentialRef', { max: 512 })
  if (!/^secret-manager:\/\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/u.test(credentialRef)) {
    fail('$.environment.maxCompute.credentialRef', 'must be a secret-manager reference, never a credential value')
  }
  if (!boolean(input.environment.maxCompute.jobListPermissionConfirmed, '$.environment.maxCompute.jobListPermissionConfirmed')) {
    fail('$.environment.maxCompute.jobListPermissionConfirmed', 'must be confirmed before rejection-path acceptance')
  }

  exactKeys(input.governance, '$.governance', ['dataset', 'metrics', 'dimensions'])
  const datasetPath = '$.governance.dataset'
  exactKeys(input.governance.dataset, datasetPath, [
    'code', 'name', 'sourceRef', 'status', 'maxRows', 'queryTimeoutSeconds', 'scopeRequired', 'scopeMappings',
  ])
  const datasetCode = code(input.governance.dataset.code, `${datasetPath}.code`)
  text(input.governance.dataset.name, `${datasetPath}.name`, { max: 128 })
  const sourceRef = text(input.governance.dataset.sourceRef, `${datasetPath}.sourceRef`, { max: 256 })
  const sourceRefPattern = new RegExp(`^${project}\\.[A-Za-z_][A-Za-z0-9_]{0,127}$`, 'u')
  if (!sourceRefPattern.test(sourceRef)) {
    fail(`${datasetPath}.sourceRef`, 'must be one table in the declared MaxCompute project')
  }
  if (input.governance.dataset.status !== 'published') fail(`${datasetPath}.status`, 'must be published')
  if (input.governance.dataset.maxRows !== 100) fail(`${datasetPath}.maxRows`, 'must equal the fixed product maximum of 100')
  if (input.governance.dataset.queryTimeoutSeconds !== 30) fail(`${datasetPath}.queryTimeoutSeconds`, 'must equal the fixed product maximum of 30')
  if (input.governance.dataset.scopeRequired !== true) fail(`${datasetPath}.scopeRequired`, 'must be true for the first real governed dataset')

  const metrics = array(input.governance.metrics, '$.governance.metrics', 3).map((item, index) => metric(item, `$.governance.metrics[${index}]`))
  const dimensions = array(input.governance.dimensions, '$.governance.dimensions', 3).map((item, index) => dimension(item, `$.governance.dimensions[${index}]`))
  if (new Set(metrics.map(item => item.code)).size !== metrics.length) fail('$.governance.metrics', 'codes must be globally unique')
  if (new Set(dimensions.map(item => item.code)).size !== dimensions.length) fail('$.governance.dimensions', 'codes must be globally unique')
  if (metrics.some(metricItem => dimensions.some(dimensionItem => dimensionItem.code === metricItem.code))) {
    fail('$.governance', 'metric and dimension codes must not overlap')
  }
  const publishedMetrics = new Set(metrics.filter(item => item.status === 'published').map(item => item.code))
  const draftMetrics = new Set(metrics.filter(item => item.status === 'draft').map(item => item.code))
  const publishedDimensions = new Set(dimensions.filter(item => item.status === 'published').map(item => item.code))
  if (publishedMetrics.size < 2 || draftMetrics.size < 1) fail('$.governance.metrics', 'must include two published metrics and one draft metric for rejection testing')
  if (publishedDimensions.size < 3) fail('$.governance.dimensions', 'must include two authorized dimensions and one denied dimension')
  const dimensionsByCode = new Map(dimensions.map(item => [item.code, item]))

  const scopeMappings = array(input.governance.dataset.scopeMappings, `${datasetPath}.scopeMappings`, 1).map((item, index) => {
    const itemPath = `${datasetPath}.scopeMappings[${index}]`
    exactKeys(item, itemPath, ['dimension', 'op', 'source'])
    const dimensionCode = code(item.dimension, `${itemPath}.dimension`)
    const target = dimensionsByCode.get(dimensionCode)
    if (!target || target.status !== 'published') fail(`${itemPath}.dimension`, 'must reference a published dimension')
    const operator = choice(item.op, `${itemPath}.op`, FILTER_OPERATORS)
    if (!target.operators.includes(operator)) fail(`${itemPath}.op`, 'must be allowed by the target dimension')
    const source = text(item.source, `${itemPath}.source`, { max: 64 })
    if (!AUTHORITY_SCOPE_FIELDS.has(source)) fail(`${itemPath}.source`, 'must use an authoritative staff scope field')
    return { dimensionCode, source, operator }
  })
  if (new Set(scopeMappings.map(item => item.dimensionCode)).size !== scopeMappings.length) {
    fail(`${datasetPath}.scopeMappings`, 'target dimensions must be unique')
  }

  exactKeys(input.subjects, '$.subjects', ['authorized', 'unauthorized'])
  const authorized = subject(input.subjects.authorized, '$.subjects.authorized')
  const unauthorized = subject(input.subjects.unauthorized, '$.subjects.unauthorized')
  if (authorized.userId === unauthorized.userId) fail('$.subjects', 'authorized and unauthorized users must be distinct')
  if (authorized.dataRoles.some(role => unauthorized.dataRoles.includes(role))) {
    fail('$.subjects', 'authorized and unauthorized users must not share acceptance data roles')
  }
  for (const mapping of scopeMappings) {
    const values = authorized.profile[mapping.source]
    if (!Array.isArray(values) || values.length === 0) {
      fail('$.subjects.authorized.authorityProfile', 'must provide every configured authoritative scope value')
    }
    if ((mapping.operator === 'between' && values.length !== 2)
      || (!['in', 'between'].includes(mapping.operator) && values.length !== 1)) {
      fail('$.subjects.authorized.authorityProfile', 'scope value cardinality must match its mapping operator')
    }
  }

  const resources = {
    dataset: new Set([datasetCode]),
    metric: new Set(metrics.map(item => item.code)),
    dimension: new Set(dimensions.map(item => item.code)),
  }
  const policies = array(input.policies, '$.policies', 1).map((item, index) =>
    policy(item, `$.policies[${index}]`, resources),
  )
  const policyKeys = policies.map(item => `${item.subjectType}|${item.subjectValue}|${item.resourceType}|${item.resourceCode}`)
  if (new Set(policyKeys).size !== policyKeys.length) fail('$.policies', 'subject/resource combinations must be unique')

  exactKeys(input.baseline, '$.baseline', ['businessDate', 'question', 'semanticRequest', 'benchmarkSql', 'expectedResult'])
  const businessDate = date(input.baseline.businessDate, '$.baseline.businessDate')
  text(input.baseline.question, '$.baseline.question', { min: 5, max: 2000 })
  const semantic = semanticRequest(input.baseline.semanticRequest, '$.baseline.semanticRequest', {
    datasetCode,
    businessDate,
    publishedMetrics,
    publishedDimensions,
    dimensions: dimensionsByCode,
  })
  const expectedColumns = [...semantic.dimensionCodes, ...semantic.metricCodes]
  const semanticFields = new Map([
    ...semantic.dimensionCodes.map(item => {
      const selected = dimensionsByCode.get(item)
      return [item, { sourceField: selected.sourceField, aggregation: null }]
    }),
    ...semantic.metricCodes.map(item => {
      const selected = metrics.find(candidate => candidate.code === item)
      return [item, { sourceField: selected.sourceField, aggregation: selected.aggregation }]
    }),
  ])
  const predicates = [
    filterSql(dimensionsByCode.get(semantic.timeDimension).sourceField, 'eq', [businessDate]),
    ...semantic.filters.map(item => filterSql(
      dimensionsByCode.get(item.dimensionCode).sourceField,
      item.operator,
      item.values,
    )),
    ...scopeMappings.map(item => filterSql(
      dimensionsByCode.get(item.dimensionCode).sourceField,
      item.operator,
      authorized.profile[item.source],
    )),
  ]
  const uniquePredicates = [...new Set(predicates)]
  const groupBy = semantic.dimensionCodes.map(item => dimensionsByCode.get(item).sourceField).join(', ')
  const orderBy = semantic.orderBy.length === 0
    ? ''
    : ` ORDER BY ${semantic.orderBy.map(item => `${item.field} ${item.direction.toUpperCase()}`).join(', ')}`
  const expectedTail = `WHERE ${uniquePredicates.join(' AND ')} GROUP BY ${groupBy}${orderBy} LIMIT ${semantic.limit}`
  safeBenchmarkSql(input.baseline.benchmarkSql, '$.baseline.benchmarkSql', {
    sourceRef,
    expectedColumns,
    semanticFields,
    expectedTail,
  })
  expectedResult(input.baseline.expectedResult, '$.baseline.expectedResult', expectedColumns)

  exactKeys(input.rejectionCases, '$.rejectionCases', [
    'unauthorizedUser', 'unpublishedMetric', 'deniedDimension', 'assertionReplay',
  ])
  exactKeys(input.rejectionCases.unauthorizedUser, '$.rejectionCases.unauthorizedUser', ['question', 'expectedErrorCode'])
  text(input.rejectionCases.unauthorizedUser.question, '$.rejectionCases.unauthorizedUser.question', { min: 5, max: 2000 })
  if (input.rejectionCases.unauthorizedUser.expectedErrorCode !== 'DQ_POLICY_DENIED') {
    fail('$.rejectionCases.unauthorizedUser.expectedErrorCode', 'must equal DQ_POLICY_DENIED')
  }
  exactKeys(input.rejectionCases.unpublishedMetric, '$.rejectionCases.unpublishedMetric', ['question', 'metricCode', 'expectedErrorCode'])
  text(input.rejectionCases.unpublishedMetric.question, '$.rejectionCases.unpublishedMetric.question', { min: 5, max: 2000 })
  const unpublishedMetricCode = code(input.rejectionCases.unpublishedMetric.metricCode, '$.rejectionCases.unpublishedMetric.metricCode')
  if (!draftMetrics.has(unpublishedMetricCode)) fail('$.rejectionCases.unpublishedMetric.metricCode', 'must reference a declared draft metric')
  if (input.rejectionCases.unpublishedMetric.expectedErrorCode !== 'DQ_SEMANTIC_INVALID') {
    fail('$.rejectionCases.unpublishedMetric.expectedErrorCode', 'must equal DQ_SEMANTIC_INVALID')
  }
  exactKeys(input.rejectionCases.deniedDimension, '$.rejectionCases.deniedDimension', ['question', 'dimensionCode', 'expectedErrorCode'])
  text(input.rejectionCases.deniedDimension.question, '$.rejectionCases.deniedDimension.question', { min: 5, max: 2000 })
  const deniedDimensionCode = code(input.rejectionCases.deniedDimension.dimensionCode, '$.rejectionCases.deniedDimension.dimensionCode')
  const deniedUsedBySuccess = semantic.dimensionCodes.includes(deniedDimensionCode)
    || semantic.timeDimension === deniedDimensionCode
    || semantic.filters.some(item => item.dimensionCode === deniedDimensionCode)
    || scopeMappings.some(item => item.dimensionCode === deniedDimensionCode)
  if (!publishedDimensions.has(deniedDimensionCode) || deniedUsedBySuccess) {
    fail('$.rejectionCases.deniedDimension.dimensionCode', 'must be a separate published dimension unused by the success request')
  }
  if (input.rejectionCases.deniedDimension.expectedErrorCode !== 'DQ_POLICY_DENIED') {
    fail('$.rejectionCases.deniedDimension.expectedErrorCode', 'must equal DQ_POLICY_DENIED')
  }
  exactKeys(input.rejectionCases.assertionReplay, '$.rejectionCases.assertionReplay', ['question', 'expectedErrorCode'])
  text(input.rejectionCases.assertionReplay.question, '$.rejectionCases.assertionReplay.question', { min: 5, max: 2000 })
  if (input.rejectionCases.assertionReplay.expectedErrorCode !== 'DQ_ASSERTION_REPLAYED') {
    fail('$.rejectionCases.assertionReplay.expectedErrorCode', 'must equal DQ_ASSERTION_REPLAYED')
  }

  const policyActiveOnBusinessDate = (item) => {
    const instant = Date.parse(`${businessDate}T12:00:00Z`)
    return (item.validFrom === null || Date.parse(item.validFrom) <= instant)
      && (item.expiresAt === null || Date.parse(item.expiresAt) > instant)
  }
  if (semantic.metricCodes.length !== publishedMetrics.size
    || semantic.metricCodes.some(item => !publishedMetrics.has(item))) {
    fail('$.baseline.semanticRequest.metricCodes', 'must exercise every published acceptance metric')
  }
  const authorizedDimensions = new Set([
    ...semantic.dimensionCodes,
    ...semantic.filters.map(item => item.dimensionCode),
    semantic.timeDimension,
    ...scopeMappings.map(mapping => mapping.dimensionCode),
  ])
  if (authorizedDimensions.size < 2) {
    fail('$.baseline.semanticRequest.dimensionCodes', 'must exercise at least two authorized dimensions')
  }
  const coveredPublishedDimensions = new Set([...authorizedDimensions, deniedDimensionCode])
  if (coveredPublishedDimensions.size !== publishedDimensions.size
    || [...publishedDimensions].some(item => !coveredPublishedDimensions.has(item))) {
    fail('$.governance.dimensions', 'published dimensions must be authorized by the baseline or used as the one denied dimension')
  }

  const requiredAllows = new Set([
    `dataset|${datasetCode}`,
    ...semantic.metricCodes.map(item => `metric|${item}`),
    ...[...authorizedDimensions].map(item => `dimension|${item}`),
  ])
  for (const item of policies) {
    if (!policyActiveOnBusinessDate(item)) fail('$.policies', 'every acceptance policy must be active on the business date')
    const forAuthorized = matchesSubject(item, authorized)
    const forUnauthorized = matchesSubject(item, unauthorized)
    if (forAuthorized === forUnauthorized) fail('$.policies', 'every policy must target exactly one declared acceptance subject')
    const resourceKey = `${item.resourceType}|${item.resourceCode}`
    if (item.effect === 'allow' && (!forAuthorized || !requiredAllows.has(resourceKey))) {
      fail('$.policies', 'allows must be the exact authorized success-path resources')
    }
    const expectedDeny = (forAuthorized && resourceKey === `dimension|${deniedDimensionCode}`)
      || (forUnauthorized && resourceKey === `dataset|${datasetCode}`)
    if (item.effect === 'deny' && !expectedDeny) {
      fail('$.policies', 'denies must be the exact authorized-dimension and unauthorized-dataset rejection resources')
    }
  }

  const effectiveAllowCount = (resourceKey) => policies.filter(item =>
    item.effect === 'allow' && `${item.resourceType}|${item.resourceCode}` === resourceKey
      && matchesSubject(item, authorized) && policyActiveOnBusinessDate(item),
  ).length
  const effectiveDenyCount = (resourceKey, target) => policies.filter(item =>
    item.effect === 'deny' && `${item.resourceType}|${item.resourceCode}` === resourceKey
      && matchesSubject(item, target) && policyActiveOnBusinessDate(item),
  ).length
  for (const resourceKey of requiredAllows) {
    if (effectiveAllowCount(resourceKey) !== 1 || effectiveDenyCount(resourceKey, authorized) !== 0) {
      fail('$.policies', 'each success-path resource needs one effective allow and no matching deny')
    }
  }
  if (effectiveDenyCount(`dimension|${deniedDimensionCode}`, authorized) !== 1) {
    fail('$.policies', 'must contain one effective deny for the authorized subject and denied dimension')
  }
  if (effectiveDenyCount(`dataset|${datasetCode}`, unauthorized) !== 1) {
    fail('$.policies', 'must contain one effective deny for the unauthorized subject and dataset')
  }

  exactKeys(input.controls, '$.controls', FAILURE_CONTROL_NAMES)
  for (const name of FAILURE_CONTROL_NAMES) {
    control(input.controls[name], `$.controls.${name}`, FAILURE_CONTROL_EXPECTATIONS.get(name))
  }

  const evidenceDirectory = text(input.evidenceDirectory, '$.evidenceDirectory', { max: 1024 })
  if (!isAbsolute(evidenceDirectory)) fail('$.evidenceDirectory', 'must be an absolute out-of-tree path')
  if (inside(repositoryRoot, evidenceDirectory)) {
    fail('$.evidenceDirectory', 'must be outside the repository')
  }

  return {
    fingerprint: createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex'),
    publishedMetricCount: publishedMetrics.size,
    publishedDimensionCount: publishedDimensions.size,
    policyCount: policies.length,
  }
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: node validate-acceptance-input.mjs <out-of-tree-input.json|->')
  const repositoryRoot = resolve(import.meta.dirname, '../../..')
  const inputArgument = process.argv[2]
  let raw
  if (inputArgument === '-') {
    raw = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) raw += chunk
  } else {
    const inputPath = resolve(inputArgument)
    if (inside(repositoryRoot, inputPath)) fail('inputPath', 'real acceptance input must be outside the repository')
    raw = await readFile(inputPath, 'utf8')
  }
  const parsed = JSON.parse(raw)
  const result = validateAcceptanceInput(parsed, { repositoryRoot })
  console.log(
    `controlled-data-query acceptance input valid: publishedMetrics=${result.publishedMetricCount}, `
    + `publishedDimensions=${result.publishedDimensionCount}, policies=${result.policyCount}, `
    + `fingerprint=sha256:${result.fingerprint}`,
  )
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invoked) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'acceptance input validation failed')
    process.exitCode = 1
  })
}
