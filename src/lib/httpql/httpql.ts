export interface HttpqlFieldDef {
    name: string;
    aliases?: string[];
    description: string;
    type: 'string' | 'integer' | 'datetime' | 'boolean' | 'enum' | 'header';
    category: 'Request' | 'Response' | 'Generic';
    allowedOperators: string[];
    example: string;
    presetValues?: string[];
}

export const HTTPQL_FIELDS: HttpqlFieldDef[] = [
    // -------------------------------------------------------------------------
    // Request Namespace (`req`)
    // -------------------------------------------------------------------------
    {
        name: 'req.created_at',
        aliases: ['created_at'],
        description: 'Date and time the request was sent (RFC3339, ISO8601, ISO9075)',
        type: 'datetime',
        category: 'Request',
        allowedOperators: ['.gt:', '.lt:', ':'],
        example: 'req.created_at.gt:"2026-08-20T00:00:00Z"',
        presetValues: ['"2026-01-01"', '"2026-08-01"', '"2026-08-20T00:00:00Z"'],
    },
    {
        name: 'req.ext',
        aliases: ['ext', 'req.extension'],
        description: 'Extension of requested file (e.g. .js, .json, .html)',
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.ext.eq:".json"',
        presetValues: ['.js', '.json', '.html', '.css', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.php', '.aspx', '.xml', '.ico', '.map', '.woff2'],
    },
    {
        name: 'req.host',
        aliases: ['host'],
        description: "Value of the request's Host header / domain",
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.host.cont:"example.com"',
    },
    {
        name: 'req.len',
        aliases: ['req.length'],
        description: 'Request size in bytes (request line + headers + body)',
        type: 'integer',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'req.len.gt:500',
        presetValues: ['0', '500', '1000', '5000'],
    },
    {
        name: 'req.method',
        aliases: ['method'],
        description: 'HTTP method used (GET, POST, etc.)',
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.method.eq:"POST"',
        presetValues: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    },
    {
        name: 'req.path',
        aliases: ['path'],
        description: 'URL path, including files',
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.path.cont:"/api/v1"',
    },
    {
        name: 'req.port',
        aliases: ['port'],
        description: 'Port of the target server',
        type: 'integer',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'req.port.eq:443',
        presetValues: ['80', '443', '8080', '8443', '3000', '5000'],
    },
    {
        name: 'req.query',
        aliases: ['query'],
        description: 'URL query string, excluding leading "?"',
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.query.cont:"admin=true"',
    },
    {
        name: 'req.raw',
        aliases: ['req.body'],
        description: 'Full raw request data (line + headers + body)',
        type: 'string',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.raw.cont:"password"',
    },
    {
        name: 'req.tls',
        aliases: ['req.https', 'is_https'],
        description: 'Whether the connection used TLS/SSL encryption',
        type: 'boolean',
        category: 'Request',
        allowedOperators: ['.eq:', ':'],
        example: 'req.tls.eq:true',
        presetValues: ['true', 'false'],
    },
    {
        name: 'req.header',
        aliases: ['req.headers'],
        description: 'HTTP request headers by name',
        type: 'header',
        category: 'Request',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'req.header["authorization"].cont:"Bearer"',
        presetValues: ['authorization', 'content-type', 'user-agent', 'cookie', 'accept', 'host', 'origin', 'referer', 'x-forwarded-for'],
    },

    // -------------------------------------------------------------------------
    // Response Namespace (`resp`)
    // -------------------------------------------------------------------------
    {
        name: 'resp.code',
        aliases: ['resp.status', 'status', 'code'],
        description: 'Status code of the response',
        type: 'integer',
        category: 'Response',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'resp.code.gte:400',
        presetValues: ['200', '201', '204', '301', '302', '304', '400', '401', '403', '404', '405', '500', '502', '503'],
    },
    {
        name: 'resp.len',
        aliases: ['resp.length', 'resp.size'],
        description: 'Response size in bytes (response line + headers + body)',
        type: 'integer',
        category: 'Response',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'resp.len.gt:0',
        presetValues: ['0', '500', '1000', '5000', '10000'],
    },
    {
        name: 'resp.raw',
        aliases: ['resp.body'],
        description: 'Full raw response data (response line + headers + body)',
        type: 'string',
        category: 'Response',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'resp.raw.cont:"error"',
    },
    {
        name: 'resp.roundtrip',
        aliases: ['resp.time', 'resp.duration', 'roundtrip', 'duration', 'time'],
        description: 'Total request/response cycle time in milliseconds',
        type: 'integer',
        category: 'Response',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'resp.roundtrip.gt:1000',
        presetValues: ['100', '500', '1000', '2000', '5000'],
    },
    {
        name: 'resp.header',
        aliases: ['resp.headers'],
        description: 'HTTP response headers by name',
        type: 'header',
        category: 'Response',
        allowedOperators: ['.eq:', '.ne:', '.cont:', '.ncont:', '.like:', '.nlike:', '.regex:', '.nregex:', ':'],
        example: 'resp.header["content-type"].cont:"json"',
        presetValues: ['content-type', 'set-cookie', 'server', 'location', 'cache-control', 'content-security-policy', 'access-control-allow-origin'],
    },

    // -------------------------------------------------------------------------
    // Row Namespace (`row`)
    // -------------------------------------------------------------------------
    {
        name: 'row.id',
        aliases: ['id', 'req.id'],
        description: 'Numerical identifier of a traffic table row',
        type: 'integer',
        category: 'Generic',
        allowedOperators: ['.eq:', '.ne:', '.gt:', '.gte:', '.lt:', '.lte:', ':'],
        example: 'row.id.gt:50',
    },

    // -------------------------------------------------------------------------
    // Preset Namespace (`preset`)
    // -------------------------------------------------------------------------
    {
        name: 'preset',
        description: 'Apply a named filter preset',
        type: 'enum',
        category: 'Generic',
        allowedOperators: [':', '.eq:'],
        example: 'preset:"hide-static"',
        presetValues: ['"hide-static"', '"errors-only"', '"2xx-success"', '"mutating-methods"', '"json-only"', '"slow-requests"', '"has-params"'],
    },
];

export interface HttpqlPreset {
    id: string;
    label: string;
    description: string;
    query: string;
    badge?: string;
}

export const HTTPQL_PRESETS: HttpqlPreset[] = [
    {
        id: 'hide-static',
        label: 'Hide Static',
        description: 'Hide static assets (images, CSS, JS, fonts, maps)',
        query: 'preset:"hide-static"',
        badge: 'Noise',
    },
    {
        id: 'errors-only',
        label: '4xx / 5xx Errors',
        description: 'Filter for client and server error responses',
        query: 'resp.code.gte:400',
        badge: 'Errors',
    },
    {
        id: 'success-only',
        label: '2xx Success',
        description: 'Filter for successful responses (200-299)',
        query: 'resp.code.gte:200 and resp.code.lt:300',
        badge: '2xx',
    },
    {
        id: 'mutating-methods',
        label: 'POST / PUT / DELETE',
        description: 'Filter for mutating HTTP request methods',
        query: 'preset:"mutating-methods"',
        badge: 'Mutating',
    },
    {
        id: 'json-only',
        label: 'JSON Traffic',
        description: 'Filter for JSON requests or responses',
        query: 'resp.header["content-type"].cont:"json"',
        badge: 'API',
    },
    {
        id: 'slow-requests',
        label: 'Slow (>1s)',
        description: 'Requests taking longer than 1,000ms',
        query: 'resp.roundtrip.gt:1000',
        badge: 'Perf',
    },
    {
        id: 'has-params',
        label: 'With Query Params',
        description: 'Requests containing URL query parameters',
        query: 'preset:"has-params"',
    },
];

/**
 * Recursively resolves any preset:"alias" references in an HTTPQL expression string.
 */
export function expandHttpqlPresets(
    query: string,
    presets: { alias: string; expression: string }[],
    visited = new Set<string>(),
    depth = 0
): string {
    if (!query || depth > 10) return query;

    const presetRegex = /preset:(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+))/gi;

    return query.replace(presetRegex, (fullMatch, q1, q2, unquoted) => {
        const alias = (q1 || q2 || unquoted || '').toLowerCase();
        if (!alias || visited.has(alias)) return fullMatch;

        const match = presets.find((p) => p.alias.toLowerCase() === alias);
        if (!match) return fullMatch;

        visited.add(alias);
        const expanded = expandHttpqlPresets(`(${match.expression})`, presets, visited, depth + 1);
        visited.delete(alias);
        return expanded;
    });
}

export const OPERATOR_LABELS: Record<string, { label: string; desc: string }> = {
    ':': { label: ':', desc: 'Exact match / equality shorthand' },
    '.eq:': { label: '.eq:', desc: 'Equal to (case-sensitive)' },
    '.ne:': { label: '.ne:', desc: 'Not equal to (case-sensitive)' },
    '.cont:': { label: '.cont:', desc: 'Contains substring (case-insensitive)' },
    '.ncont:': { label: '.ncont:', desc: 'Does not contain substring (case-insensitive)' },
    '.like:': { label: '.like:', desc: 'SQLite LIKE (% = 0+ chars, _ = 1 char)' },
    '.nlike:': { label: '.nlike:', desc: 'SQLite NOT LIKE' },
    '.regex:': { label: '.regex:', desc: 'Matches regular expression (Rust regex)' },
    '.nregex:': { label: '.nregex:', desc: 'Does not match regular expression' },
    '.gt:': { label: '.gt:', desc: 'Greater than' },
    '.gte:': { label: '.gte:', desc: 'Greater than or equal to' },
    '.lt:': { label: '.lt:', desc: 'Less than' },
    '.lte:': { label: '.lte:', desc: 'Less than or equal to' },
};
