/** High-confidence secret and raw-query categories for assembled Data Aid artifacts. */
const PATTERNS = {
  accessKey: /(?:\b(?:ltai|akid)[a-z0-9]{12,}\b|\bak\b\s*[:=]\s*["']?[a-z0-9/+_=.-]{8,})/iu,
  secretKey: /(?:\b(?:secret|access)[_-]?key\b|\bsk\b)\s*[:=]\s*["']?[a-z0-9/+_=.-]{8,}/iu,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  authorization: /\bauthorization\b\s*[:=]\s*["']?(?:bearer\s+)?[a-z0-9._~+/-]{12,}/iu,
  cookie: /\b(?:cookie|set-cookie)\b\s*[:=]\s*["']?[^\s"']{8,}/iu,
  rawSql: /\b(?:select\b[\s\S]{0,200}\bfrom|insert\s+into|update\s+[a-z_][\w.]*\s+set|delete\s+from|(?:create|drop|alter)\s+table)\b/iu,
} as const

/** Return category names only so a failed test never echoes a matched secret. */
export function sensitiveContentKinds(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Object.entries(PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind)
}
