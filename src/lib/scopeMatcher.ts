import type { Scope } from '@/store/slices/scopeSlice';

/**
 * Converts a glob-like scope pattern to a RegExp.
 * Supported wildcards:
 *   *  – matches any sequence of characters within a segment (host or path segment)
 *   ** – matches across segment boundaries (not currently supported, treated same as *)
 *
 * Examples:
 *   *.example.com  → matches sub.example.com but not example.com
 *   example.com/*  → matches example.com/api, example.com/login
 *   *.example.com/api/* → matches sub.example.com/api/users
 */
function patternToRegex(pattern: string): RegExp {
    // Escape all regex special chars except *
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*'); // * matches anything except /
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Parse a raw URL or bare host string into { host, path }.
 * Accepts:
 *   - Full URLs:      https://example.com/api/v1
 *   - Host+path:      example.com/api/v1
 *   - Bare host:      example.com
 */
function parseTarget(url: string): { host: string; path: string } {
    try {
        // Try to parse as full URL
        const u = new URL(url.includes('://') ? url : `https://${url}`);
        return { host: u.hostname, path: u.pathname };
    } catch {
        // Fallback: split on first /
        const slashIdx = url.indexOf('/');
        if (slashIdx === -1) return { host: url, path: '/' };
        return { host: url.slice(0, slashIdx), path: url.slice(slashIdx) };
    }
}

/**
 * Check whether a single pattern matches a given host + path.
 * The pattern may be:
 *   - host only:        *.example.com
 *   - host + path:      *.example.com/api/*
 */
export function urlMatchesPattern(pattern: string, host: string, path = '/'): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;

    // Separate pattern into host-part and path-part
    const slashIdx = trimmed.indexOf('/');
    const patternHost = slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
    const patternPath = slashIdx === -1 ? null : trimmed.slice(slashIdx);

    // Match host
    if (!patternToRegex(patternHost).test(host)) return false;

    // If pattern has no path component, any path is allowed
    if (patternPath === null) return true;

    // Match path
    return patternToRegex(patternPath).test(path || '/');
}

/**
 * Main entry point used everywhere in the UI.
 *
 * Returns true when:
 *   - scope is null (no active scope → everything is in scope)
 *   - The given host+path matches at least one allow rule AND zero deny rules
 */
export function isInScope(
    scope: Scope | null,
    host: string,
    path = '/',
): boolean {
    if (!scope) return true; // No active scope = all traffic passes

    const allowRules = scope.allow;
    const denyRules = scope.deny;

    // Must match at least one allow rule (empty allow = nothing in scope)
    if (allowRules.length === 0) return false;

    const allowed = allowRules.some((rule) => urlMatchesPattern(rule.pattern, host, path));
    if (!allowed) return false;

    // Must not match any deny rule
    const denied = denyRules.some((rule) => urlMatchesPattern(rule.pattern, host, path));
    return !denied;
}

/**
 * Convenience wrapper: accepts a raw URL string (e.g. from a text input).
 */
export function isUrlInScope(scope: Scope | null, rawUrl: string): boolean {
    const { host, path } = parseTarget(rawUrl);
    return isInScope(scope, host, path);
}
