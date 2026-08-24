/** Strict parser for the data-aid gateway visitor headers. */

import { Buffer } from 'node:buffer'
import type { DataAidClientId, DdUserId } from '@deepseek-ai/dsh-authenticated-principal'
import type { DataAidGatewayVisitor } from './types.ts'

const USER_HEADER = 'gk-service-user'
const APP_HEADER = 'gk-service-app'
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/** Stable parser failure; the provider replaces it with a generic auth error. */
export class DataAidVisitorError extends Error {
  /** Construct a parser failure without embedding header contents. */
  constructor() {
    super('invalid data-aid gateway visitor')
    this.name = 'DataAidVisitorError'
  }
}

/**
 * Parse the required user and optional application visitor headers.
 *
 * This matches data-aid's standard-base64 UTF-8 JSON convention but is strict
 * about canonical padding, JSON object values, and non-empty identity fields.
 * Fetch Headers combines duplicate values, so a repeated identity header is
 * rejected by the same strict base64 check rather than selected arbitrarily.
 * @param request - Fetch request carrying the gateway headers.
 * @returns parsed visitor identity.
 * @throws {@link DataAidVisitorError} when a header is absent, duplicated, malformed, or incomplete.
 */
export function parseDataAidGatewayVisitor(request: Request): DataAidGatewayVisitor {
  const userInfo = decodeObject(requiredHeader(request, USER_HEADER))
  const userId = userInfo.id
  if (typeof userId !== 'string' || userId.trim().length === 0) throw new DataAidVisitorError()

  const appHeader = request.headers.get(APP_HEADER)
  const appInfo = appHeader === null ? undefined : decodeObject(nonemptyHeader(appHeader))
  const clientId = appInfo?.clientId
  if (clientId !== undefined && (typeof clientId !== 'string' || clientId.trim().length === 0)) {
    throw new DataAidVisitorError()
  }

  return Object.freeze({
    ddUserId: userId as DdUserId,
    ...(clientId === undefined ? {} : { clientId: clientId as DataAidClientId }),
  })
}

/** Require a non-empty header value before decoding it. */
function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)
  if (value === null) throw new DataAidVisitorError()
  return nonemptyHeader(value)
}

/** Reject an empty value; duplicate values remain invalid base64 later. */
function nonemptyHeader(value: string): string {
  if (value.length === 0) throw new DataAidVisitorError()
  return value
}

/** Decode one canonical standard-base64 JSON object without exposing its contents in errors. */
function decodeObject(value: string): Record<string, unknown> {
  if (!STANDARD_BASE64.test(value) || value.length % 4 !== 0) throw new DataAidVisitorError()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new DataAidVisitorError()

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new DataAidVisitorError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DataAidVisitorError()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DataAidVisitorError()
  }
  return parsed as Record<string, unknown>
}
