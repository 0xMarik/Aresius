import type { Scope } from '@/store/slices/scopeSlice';

/**
 * Strips protocol schemes (http://, https://, ws://, wss://, *://, ://) from pattern.
 */
function stripProtocol(pattern: string): string {
    return pattern.replace(/^([a-zA-Z0-9*]+:\/\/|:\/\/)/, '');
}

/**
 * Extract hostname from "host:port" or "host" string (e.g. "example.com:443" -> "example.com", "[::1]:8080" -> "[::1]").
 */
export function parseHostname(hostWithPort: string): string {
    if (!hostWithPort) return '';
    const trimmed = hostWithPort.trim();
    if (trimmed.startsWith('[')) {
        const closeIdx = trimmed.indexOf(']');
        if (closeIdx !== -1) return trimmed.slice(0, closeIdx + 1);
    }
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx === -1) return trimmed;
    return trimmed.slice(0, colonIdx);
}

/**
 * Converts a glob-like scope host pattern to a RegExp.
 * Supported wildcards:
 *   *  – matches any character sequence
 *   *. – at start of domain matches the domain itself and all subdomains (e.g. *.example.com matches example.com and sub.example.com)
 */
function hostPatternToRegex(patternHost: string): RegExp {
    const p = patternHost.trim();
    if (p === '*' || p === '*:*') {
        return /^.*$/i;
    }

    if (p.startsWith('*.')) {
        const baseDomain = p.slice(2);
        const escapedBase = baseDomain.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^(?:[a-zA-Z0-9_.-]+\\.)?${escapedBase}$`, 'i');
    }

    if (p.startsWith('.')) {
        const baseDomain = p.slice(1);
        const escapedBase = baseDomain.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^(?:[a-zA-Z0-9_.-]+\\.)?${escapedBase}$`, 'i');
    }

    const escaped = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Converts a path pattern to a RegExp.
 */
function pathPatternToRegex(patternPath: string): RegExp {
    const p = patternPath.trim();
    if (!p || p === '/' || p === '/*') {
        return /^.*$/i;
    }

    const escaped = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');

    return new RegExp(`^${escaped}(?:/.*)?$`, 'i');
}

/**
 * Parse a raw URL or bare host string into { host, path }.
 * Accepts:
 *   - Full URLs:      https://example.com/api/v1
 *   - Host+path:      example.com/api/v1
 *   - Bare host:      example.com
 */
export function parseTarget(url: string): { host: string; path: string } {
    const cleaned = stripProtocol(url.trim());
    const slashIdx = cleaned.indexOf('/');
    if (slashIdx === -1) {
        return { host: cleaned, path: '/' };
    }
    return {
        host: cleaned.slice(0, slashIdx),
        path: cleaned.slice(slashIdx) || '/',
    };
}

/**
 * Check whether a single pattern matches a given host + path.
 * The pattern may be:
 *   - host only:        example.com, *.example.com, example.com:8080
 *   - protocol + host:  https://example.com
 *   - host + path:      *.example.com/api/*
 */
export function urlMatchesPattern(pattern: string, host: string, path = '/'): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;

    // 1. Strip protocol scheme if present (e.g. https://example.com -> example.com)
    const cleanedPattern = stripProtocol(trimmed);

    // 2. Separate pattern into host and path
    const slashIdx = cleanedPattern.indexOf('/');
    const patternHost = slashIdx === -1 ? cleanedPattern : cleanedPattern.slice(0, slashIdx);
    const patternPath = slashIdx === -1 ? null : cleanedPattern.slice(slashIdx);

    if (!patternHost) return false;

    // 3. Determine if patternHost specifies a port
    const hasPort = patternHost.startsWith('[')
        ? patternHost.indexOf(']:') !== -1
        : patternHost.includes(':');

    // 4. Compare host: if pattern has no port, test against host without port
    const targetHostToTest = hasPort ? host : parseHostname(host);
    if (!hostPatternToRegex(patternHost).test(targetHostToTest)) {
        return false;
    }

    // 5. Compare path (if pattern has no path component, any path is allowed)
    if (patternPath === null) return true;

    const targetPathToTest = path || '/';
    return pathPatternToRegex(patternPath).test(targetPathToTest);
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
