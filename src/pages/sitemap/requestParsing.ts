export interface ParsedRequestLine {
    method: string;
    path: string;
    queryParams: string[]; // sorted, deduped param names
}

/**
 * Parses the first line of a raw HTTP request ("METHOD /path?query HTTP/1.1")
 * plus enough of the header block to know if it's HTTPS-implied (not
 * determinable from the request alone -- callers combine with connection info).
 */
export function parseRequestLine(rawRequest: string): ParsedRequestLine {
    const firstLineEnd = rawRequest.indexOf('\r\n');
    const requestLine = firstLineEnd === -1 ? rawRequest : rawRequest.slice(0, firstLineEnd);

    const parts = requestLine.split(' ');
    const method = (parts[0] || 'GET').toUpperCase();
    const target = parts[1] || '/';

    const [path, queryString = ''] = splitOnce(target, '?');
    const queryParams = parseParamNames(queryString);

    return { method, path: path || '/', queryParams };
}

function splitOnce(str: string, sep: string): [string, string?] {
    const idx = str.indexOf(sep);
    if (idx === -1) return [str];
    return [str.slice(0, idx), str.slice(idx + 1)];
}

function parseParamNames(queryString: string): string[] {
    if (!queryString) return [];
    const names = new Set<string>();
    for (const pair of queryString.split('&')) {
        if (!pair) continue;
        const [name] = splitOnce(pair, '=');
        const decoded = safeDecodeURIComponent(name);
        if (decoded) names.add(decoded);
    }
    return Array.from(names).sort();
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Extracts the raw body from a raw HTTP message (request or response),
 * i.e. everything after the first blank line (\r\n\r\n).
 */
export function extractBody(raw: string): string {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) return '';
    return raw.slice(headerEnd + 4);
}

/**
 * Best-effort extraction of top-level field names from a JSON request body.
 * Returns a sorted, deduped list. Non-JSON or unparsable bodies yield [].
 * Only applies to methods that typically carry a body (POST/PUT/PATCH).
 */
export function parseBodyFieldNames(rawRequest: string, method: string): string[] {
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return [];

    const body = extractBody(rawRequest).trim();
    if (!body) return [];

    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.keys(parsed).sort();
        }
        return [];
    } catch {
        // Not JSON -- try to parse as urlencoded form body
        if (/^[^=&]+=.*/.test(body) && !body.includes('{')) {
            return parseFormFieldNames(body);
        }
        return [];
    }
}

function parseFormFieldNames(body: string): string[] {
    const names = new Set<string>();
    for (const pair of body.split('&')) {
        if (!pair) continue;
        const [name] = splitOnce(pair, '=');
        const decoded = safeDecodeURIComponent(name);
        if (decoded) names.add(decoded);
    }
    return Array.from(names).sort();
}

/**
 * Extracts the hostname portion from a "host:port" or "host" string
 * (e.g. HttpHistory.host, which may include a port).
 */
export function parseHostname(hostWithPort: string): string {
    // Handle IPv6 literals like "[::1]:443"
    if (hostWithPort.startsWith('[')) {
        const closeIdx = hostWithPort.indexOf(']');
        if (closeIdx !== -1) return hostWithPort.slice(1, closeIdx);
    }
    const colonIdx = hostWithPort.lastIndexOf(':');
    if (colonIdx === -1) return hostWithPort;
    return hostWithPort.slice(0, colonIdx);
}