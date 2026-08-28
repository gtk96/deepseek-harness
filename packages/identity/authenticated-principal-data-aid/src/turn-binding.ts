/** Validation shared by trusted turn ingress and ephemeral turn binding. */

import type { DataAidTrustedTurnBinding } from './types.ts'

/**
 * Validate the complete principal and business-id tuple before it reaches Agent state.
 * @param binding - service-authenticated binding parsed outside model input.
 * @returns after every opaque id is normalized and bounded.
 */
export function assertDataAidTrustedTurnBinding(binding: DataAidTrustedTurnBinding): void {
  assertOpaqueId('principalId', binding.principalId, 64)
  assertOpaqueId('conversationId', binding.conversationId, 36)
  assertOpaqueId('turnId', binding.turnId, 36)
}

/** Validate one UUID/ULID-sized opaque identifier without interpreting its value. */
function assertOpaqueId(name: string, value: string, maxChars: number): void {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`data-aid turn binding ${name} must be a normalized opaque id of at most ${maxChars} characters`)
  }
}
