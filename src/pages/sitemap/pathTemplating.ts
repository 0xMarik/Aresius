/**
 * Detects whether a single path segment looks "dynamic" (an ID, UUID, or
 * hash-like token) rather than a static route name, so it can be collapsed
 * into a templated placeholder like `{id}`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hex string of reasonable "hash-like" length: md5 (32), sha1 (40), sha256 (64),
// short git-sha (7-12), or general opaque hex tokens (>= 16 hex chars).
const HEX_HASH_RE = /^[0-9a-f]{16,64}$/i;

// Mongo ObjectId: 24 hex chars
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

// Pure numeric segment (integer IDs)
const NUMERIC_RE = /^\d+$/;

// Base62/base64url-ish opaque token: long, mixed-case alnum (with - or _) --
// used as a fallback for things like short-URL slugs or session tokens that
// are clearly not human-authored route names.
// Kept conservative: requires length >= 20 and a mix of upper+lower or digits,
// to avoid false-positives on real words like "users" or "dashboard".
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

function looksLikeOpaqueToken(segment: string): boolean {
    if (!OPAQUE_TOKEN_RE.test(segment)) return false;
    const hasDigit = /\d/.test(segment);
    const hasUpper = /[A-Z]/.test(segment);
    const hasLower = /[a-z]/.test(segment);
    // Require at least a digit alongside letters, or mixed case -- pure long
    // lowercase words (unlikely, but be safe) won't be flagged.
    return hasDigit || (hasUpper && hasLower);
}

/**
 * Returns true if the given path segment should be templated as a dynamic
 * parameter (e.g. replaced with "{id}") rather than kept as a literal route
 * segment.
 */
export function isDynamicSegment(segment: string): boolean {
    if (!segment) return false;
    if (NUMERIC_RE.test(segment)) return true;
    if (UUID_RE.test(segment)) return true;
    if (OBJECT_ID_RE.test(segment)) return true;
    if (HEX_HASH_RE.test(segment)) return true;
    if (looksLikeOpaqueToken(segment)) return true;
    return false;
}

/**
 * Splits a URL path into segments, filtering out empty strings from
 * leading/trailing/double slashes.
 */
export function splitPathSegments(path: string): string[] {
    return path.split('/').filter((s) => s.length > 0);
}

/**
 * Templates a full path's segments in place, replacing every dynamic
 * segment with "{id}". Returns the array of (possibly templated) segments.
 */
export function templatePathSegments(segments: string[]): string[] {
    return segments.map((seg) => (isDynamicSegment(seg) ? '{id}' : seg));
}