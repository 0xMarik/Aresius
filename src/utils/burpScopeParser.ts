import { z } from 'zod';
import type { Scope } from '@/store/slices/scopeSlice';

// ─── Zod Schemas for Burp Scope JSON ──────────────────────────────────────────

export const BurpAdvancedRuleSchema = z.object({
    enabled: z.boolean().optional().default(true),
    protocol: z.enum(['any', 'http', 'https']).or(z.string()).optional().default('any'),
    host: z.string().optional(),
    port: z.string().optional(),
    file: z.string().optional(),
});

export type BurpAdvancedRule = z.infer<typeof BurpAdvancedRuleSchema>;

export const BurpSimpleRuleSchema = z.object({
    enabled: z.boolean().optional().default(true),
    include_subdomains: z.boolean().optional().default(false),
    prefix: z.string(),
});

export type BurpSimpleRule = z.infer<typeof BurpSimpleRuleSchema>;

export const BurpRuleSchema = z.union([
    BurpAdvancedRuleSchema,
    BurpSimpleRuleSchema,
]);

export const BurpScopeContentSchema = z.object({
    advanced_mode: z.boolean().optional().default(false),
    include: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    exclude: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});

export const BurpTargetScopeSchema = z.object({
    target: z.object({
        scope: BurpScopeContentSchema,
    }),
});

export const BurpTopScopeSchema = z.object({
    scope: BurpScopeContentSchema,
});

// ─── Types & Output Formats ───────────────────────────────────────────────────

export interface ParsedScopeRule {
    id: string;
    pattern: string;
    enabled: boolean;
    type: 'regex' | 'prefix' | 'glob';
    original?: {
        protocol?: string;
        host?: string;
        port?: string;
        file?: string;
        prefix?: string;
        include_subdomains?: boolean;
    };
}

export interface ParsedScopeResult {
    success: boolean;
    error?: string;
    advancedMode: boolean;
    include: ParsedScopeRule[];
    exclude: ParsedScopeRule[];
    totalRulesCount: number;
    enabledRulesCount: number;
}

export interface BurpExportAdvancedRule {
    enabled: boolean;
    protocol: string;
    host: string;
    port: string;
    file: string;
}

export interface BurpExportJson {
    target: {
        scope: {
            advanced_mode: true;
            include: BurpExportAdvancedRule[];
            exclude: BurpExportAdvancedRule[];
        };
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Strips protocol schemes (http://, https://, ws://, wss://, *://, ://) from pattern.
 */
export function stripProtocol(pattern: string): string {
    return pattern.replace(/^([a-zA-Z0-9*]+:\/\/|:\/\/)/, '');
}

/**
 * Checks if a string appears to be a regular expression.
 */
export function isRegexPattern(pattern: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('^') || trimmed.endsWith('$')) return true;
    if (trimmed.startsWith('regex:') || trimmed.startsWith('(?i)')) return true;
    if (/^\/.*\/[gimsuy]*$/.test(trimmed)) return true;
    // Check for escaped characters or regex constructs
    if (/\\[dDwWsSbB]/.test(trimmed)) return true;
    if (/(\(\?|\(\?=|\[.*\]|\(.*\)|\|)/.test(trimmed)) return true;
    if (/(\.\*|\.\+|\\[.+*?^${}()|[\]\\])/.test(trimmed)) return true;
    return false;
}

/**
 * Normalizes a Burp Advanced Mode rule into an internal scope pattern string.
 */
export function burpAdvancedRuleToPattern(rule: Partial<BurpAdvancedRule>): string {
    let host = (rule.host ?? '').trim();
    let file = (rule.file ?? '').trim();
    const port = (rule.port ?? '').trim();
    const protocol = (rule.protocol ?? 'any').toLowerCase().trim();

    // If host is empty and file is empty, fallback to wildcard
    if (!host && !file) {
        return '.*';
    }

    // Default catch-all file patterns
    const isCatchAllFile =
        !file ||
        file === '^/.*$' ||
        file === '^/.*' ||
        file === '.*' ||
        file === '^/.*' ||
        file === '^/$' ||
        file === '/';

    const isStandardPort =
        !port ||
        port === '.*' ||
        port === '^.*$' ||
        port === '443' ||
        port === '^443$' ||
        port === '80' ||
        port === '^80$' ||
        port === '^(80|443)$' ||
        port === '^80|443$' ||
        port === '(80|443)';

    // Check if host specifies full URL regex
    if (
        host.startsWith('^https?:') ||
        host.startsWith('https?:') ||
        host.startsWith('http://') ||
        host.startsWith('https://')
    ) {
        return host;
    }

    // If file is specific, combine host and file
    if (!isCatchAllFile) {
        // Strip trailing $ from host if present
        if (host.endsWith('$')) {
            host = host.slice(0, -1);
        }
        // Strip leading ^ from file if present
        if (file.startsWith('^')) {
            file = file.slice(1);
        }
        if (!file.startsWith('/') && !host.endsWith('/')) {
            file = '/' + file;
        }

        let combined = `${host}${file}`;
        if (!combined.startsWith('^')) {
            combined = '^' + combined;
        }
        if (!combined.endsWith('$')) {
            combined = combined + '$';
        }
        return combined;
    }

    // When file is catch-all:
    if (host) {
        // If non-standard port is specified and we want to preserve it
        if (!isStandardPort && protocol !== 'any' && protocol !== '') {
            const cleanHost = host.startsWith('^') ? host.slice(1) : host;
            const finalHost = cleanHost.endsWith('$') ? cleanHost.slice(0, -1) : cleanHost;
            const cleanPort = port.startsWith('^') ? port.slice(1) : port;
            const finalPort = cleanPort.endsWith('$') ? cleanPort.slice(0, -1) : cleanPort;
            return `^${protocol}://${finalHost}:${finalPort}/.*$`;
        }
        return host;
    }

    return file || '.*';
}

/**
 * Normalizes a Burp Simple Mode rule into internal scope pattern strings.
 * If include_subdomains is true (e.g. for "google.com"), returns TWO patterns:
 * ["*.google.com", "google.com"]
 * If include_subdomains is false, returns ONE pattern:
 * ["google.com"]
 */
export function burpSimpleRuleToPatterns(rule: Partial<BurpSimpleRule>): string[] {
    const rawPrefix = (rule.prefix ?? '').trim();
    if (!rawPrefix) return ['.*'];

    const includeSubdomains = rule.include_subdomains === true;

    // Strip protocol (http://, https://, etc.)
    const cleanPrefix = stripProtocol(rawPrefix);
    const slashIdx = cleanPrefix.indexOf('/');
    let host = slashIdx === -1 ? cleanPrefix : cleanPrefix.slice(0, slashIdx);
    const path = slashIdx === -1 ? '' : cleanPrefix.slice(slashIdx);

    host = host.trim();
    const formattedPath = path && path !== '/' ? path : '';

    if (includeSubdomains && host && !host.startsWith('*.') && !host.startsWith('*') && !host.startsWith('^')) {
        const subPattern = `*.${host}${formattedPath}`;
        const mainPattern = `${host}${formattedPath}`;
        return [subPattern, mainPattern];
    }

    const singlePattern = `${host}${formattedPath}` || '.*';
    return [singlePattern];
}

/**
 * Backwards-compatible single pattern helper.
 */
export function burpSimpleRuleToPattern(rule: Partial<BurpSimpleRule>): string {
    const patterns = burpSimpleRuleToPatterns(rule);
    return patterns[0] || '.*';
}

/**
 * Parses raw JSON string representing a Burp Suite scope export.
 * Supports:
 * - `{ target: { scope: { advanced_mode, include, exclude } } }`
 * - `{ scope: { advanced_mode, include, exclude } }`
 * - `{ advanced_mode, include, exclude }`
 * - `{ include: [...], exclude: [...] }`
 */
export function parseBurpScope(jsonString: string): ParsedScopeResult {
    const trimmed = jsonString.trim();
    if (!trimmed) {
        return {
            success: false,
            error: 'Empty JSON content. Please provide a valid Burp Suite scope export.',
            advancedMode: false,
            include: [],
            exclude: [],
            totalRulesCount: 0,
            enabledRulesCount: 0,
        };
    }

    let rawJson: unknown;
    try {
        rawJson = JSON.parse(trimmed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Invalid JSON format';
        return {
            success: false,
            error: `JSON syntax error: ${message}`,
            advancedMode: false,
            include: [],
            exclude: [],
            totalRulesCount: 0,
            enabledRulesCount: 0,
        };
    }

    if (!rawJson || typeof rawJson !== 'object') {
        return {
            success: false,
            error: 'Expected a JSON object representing Burp Suite scope.',
            advancedMode: false,
            include: [],
            exclude: [],
            totalRulesCount: 0,
            enabledRulesCount: 0,
        };
    }

    // Extract scope content based on structure variants
    let scopeContent: z.infer<typeof BurpScopeContentSchema> | null = null;

    // Variant 1: { target: { scope: ... } }
    const targetParsed = BurpTargetScopeSchema.safeParse(rawJson);
    if (targetParsed.success) {
        scopeContent = targetParsed.data.target.scope;
    } else {
        // Variant 2: { scope: ... }
        const scopeParsed = BurpTopScopeSchema.safeParse(rawJson);
        if (scopeParsed.success) {
            scopeContent = scopeParsed.data.scope;
        } else {
            // Variant 3: { advanced_mode, include, exclude } or { include, exclude }
            const directParsed = BurpScopeContentSchema.safeParse(rawJson);
            if (directParsed.success && (directParsed.data.include.length > 0 || directParsed.data.exclude.length > 0 || 'advanced_mode' in (rawJson as object))) {
                scopeContent = directParsed.data;
            }
        }
    }

    if (!scopeContent) {
        return {
            success: false,
            error: 'Could not detect a valid Burp Suite scope configuration. Expected "target.scope", "scope", or "include"/"exclude" keys.',
            advancedMode: false,
            include: [],
            exclude: [],
            totalRulesCount: 0,
            enabledRulesCount: 0,
        };
    }

    // Detect if content is advanced mode
    let isAdvanced = scopeContent.advanced_mode ?? false;

    // If not explicitly flagged as advanced_mode, inspect rule structures
    const allRawRules = [...scopeContent.include, ...scopeContent.exclude];
    if (!isAdvanced && allRawRules.some((r) => 'host' in r || 'file' in r || 'port' in r || 'protocol' in r)) {
        isAdvanced = true;
    }

    const processRule = (raw: Record<string, unknown>): ParsedScopeRule[] => {
        const isEnabled = raw.enabled !== false;

        if (isAdvanced || ('host' in raw || 'file' in raw || 'port' in raw)) {
            const advParsed = BurpAdvancedRuleSchema.safeParse(raw);
            const advRule: BurpAdvancedRule = advParsed.success
                ? advParsed.data
                : {
                    enabled: isEnabled,
                    host: typeof raw.host === 'string' ? raw.host : undefined,
                    file: typeof raw.file === 'string' ? raw.file : undefined,
                    port: typeof raw.port === 'string' ? raw.port : undefined,
                    protocol: typeof raw.protocol === 'string' ? raw.protocol : 'any',
                };

            const pattern = burpAdvancedRuleToPattern(advRule);
            return [
                {
                    id: generateId(),
                    pattern,
                    enabled: isEnabled,
                    type: isRegexPattern(pattern) ? 'regex' : 'glob',
                    original: {
                        protocol: advRule.protocol,
                        host: advRule.host,
                        port: advRule.port,
                        file: advRule.file,
                    },
                },
            ];
        } else {
            const prefix = typeof raw.prefix === 'string' ? raw.prefix : String(raw.prefix ?? '');
            const includeSubdomains = raw.include_subdomains === true;
            const patterns = burpSimpleRuleToPatterns({
                enabled: isEnabled,
                include_subdomains: includeSubdomains,
                prefix,
            });

            return patterns.map((pat) => ({
                id: generateId(),
                pattern: pat,
                enabled: isEnabled,
                type: pat.startsWith('*.') ? 'glob' : (isRegexPattern(pat) ? 'regex' : 'prefix'),
                original: {
                    prefix: prefix,
                    include_subdomains: includeSubdomains,
                },
            }));
        }
    };

    const includeRules = scopeContent.include.flatMap(processRule);
    const excludeRules = scopeContent.exclude.flatMap(processRule);

    const totalRulesCount = includeRules.length + excludeRules.length;
    const enabledRulesCount =
        includeRules.filter((r) => r.enabled).length +
        excludeRules.filter((r) => r.enabled).length;

    return {
        success: true,
        advancedMode: isAdvanced,
        include: includeRules,
        exclude: excludeRules,
        totalRulesCount,
        enabledRulesCount,
    };
}

/**
 * Converts a pattern string into a standard Burp Advanced Mode rule.
 * If the user used wildcards or globs, it converts them to regex before exporting.
 */
export function patternToBurpAdvancedRule(pattern: string): BurpExportAdvancedRule {
    const trimmed = pattern.trim();

    // 1. If it's already a regex
    if (isRegexPattern(trimmed)) {
        let clean = trimmed.replace(/^regex:/, '').trim();

        const slashIdx = clean.indexOf('/');
        if (slashIdx !== -1) {
            let hostPart = clean.slice(0, slashIdx);
            let filePart = clean.slice(slashIdx);

            if (!hostPart.endsWith('$') && !hostPart.endsWith(')')) hostPart = hostPart + '$';
            if (!filePart.startsWith('^')) filePart = '^' + filePart;

            return {
                enabled: true,
                protocol: 'any',
                host: hostPart,
                port: '.*',
                file: filePart,
            };
        }

        let hostPart = clean;
        if (!hostPart.startsWith('^') && !hostPart.startsWith('(?i)')) hostPart = '^' + hostPart;
        if (!hostPart.endsWith('$')) hostPart = hostPart + '$';

        return {
            enabled: true,
            protocol: 'any',
            host: hostPart,
            port: '.*',
            file: '^/.*$',
        };
    }

    // 2. If it's a wildcard / glob or plain string (e.g. *.google.com, facebook.com, target.com/api/*)
    const cleanPattern = stripProtocol(trimmed);
    const slashIdx = cleanPattern.indexOf('/');
    const hostPart = slashIdx === -1 ? cleanPattern : cleanPattern.slice(0, slashIdx);
    const pathPart = slashIdx === -1 ? null : cleanPattern.slice(slashIdx);

    // Convert host wildcard/glob to regex
    let hostRegex: string;
    if (hostPart === '*' || hostPart === '*:*') {
        hostRegex = '.*';
    } else if (hostPart.startsWith('*.')) {
        const base = hostPart.slice(2).replace(/[.+^${}()|[\]\\]/g, '\\$&');
        hostRegex = `^.*\\.${base}$`;
    } else if (hostPart.startsWith('.')) {
        const base = hostPart.slice(1).replace(/[.+^${}()|[\]\\]/g, '\\$&');
        hostRegex = `^.*\\.${base}$`;
    } else if (hostPart.includes('*')) {
        const escaped = hostPart.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        hostRegex = `^${escaped}$`;
    } else {
        const escaped = hostPart.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        hostRegex = `^${escaped}$`;
    }

    // Convert path wildcard/glob to regex
    let fileRegex: string;
    if (!pathPart || pathPart === '/' || pathPart === '/*') {
        fileRegex = '^/.*$';
    } else {
        const escapedPath = pathPart.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        fileRegex = `^${escapedPath}(?:/.*)?$`;
    }

    return {
        enabled: true,
        protocol: 'any',
        host: hostRegex,
        port: '.*',
        file: fileRegex,
    };
}

/**
 * Exports a Scope object to standard Burp Suite target JSON format in Advanced Mode.
 * Any wildcards/globs are converted to regexes.
 */
export function exportToBurpScope(scope: Scope): BurpExportJson {
    return {
        target: {
            scope: {
                advanced_mode: true,
                include: scope.allow.map((rule) => patternToBurpAdvancedRule(rule.pattern)),
                exclude: scope.deny.map((rule) => patternToBurpAdvancedRule(rule.pattern)),
            },
        },
    };
}
