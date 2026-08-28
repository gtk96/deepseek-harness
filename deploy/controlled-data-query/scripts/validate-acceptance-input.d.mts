/** Safe, non-sensitive summary returned after acceptance-input validation. */
export interface AcceptanceInputValidationResult {
  fingerprint: string
  publishedMetricCount: number
  publishedDimensionCount: number
  policyCount: number
}

/** Repository context used to keep real acceptance artifacts outside Git. */
export interface AcceptanceInputValidationOptions {
  repositoryRoot: string
}

/**
 * Validate a complete Task 15/16 acceptance input without returning its sensitive business values.
 * @param input Candidate JSON value.
 * @param options Required repository context for out-of-tree evidence enforcement.
 * @returns Counts and a canonical SHA-256 fingerprint safe for logs.
 */
export function validateAcceptanceInput(
  input: unknown,
  options: AcceptanceInputValidationOptions,
): AcceptanceInputValidationResult
