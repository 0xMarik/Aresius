import { HTTPQL_FIELDS, HttpqlFieldDef, OPERATOR_LABELS } from './httpql';

export type HttpqlSection =
    | 'Recent Searches'
    | 'Presets'
    | 'Namespaces'
    | 'Fields'
    | 'Operators'
    | 'Values'
    | 'Keywords';

export interface AutocompleteSuggestion {
    id: string;
    text: string;
    displayText?: string;
    replacement: string;
    category: 'Root' | 'Field' | 'Operator' | 'Value' | 'Keyword' | 'Header' | 'Recent';
    section: HttpqlSection;
    description: string;
    /** If true, after applying this suggestion, the autocomplete should immediately open the next layer */
    hasMoreLayers?: boolean;
}

export function getHttpqlSuggestions(
    input: string,
    cursorPos: number,
    dynamicPresets?: { alias: string; name: string; description?: string }[],
    recentSearches?: string[]
): { suggestions: AutocompleteSuggestion[]; startPos: number; endPos: number } {
    const textBefore = input.slice(0, cursorPos);

    // Find the current token boundary around cursor
    let tokenStart = cursorPos;
    while (tokenStart > 0 && !/\s|\(|\)/.test(input[tokenStart - 1])) {
        tokenStart--;
    }

    let tokenEnd = cursorPos;
    while (tokenEnd < input.length && !/\s|\(|\)/.test(input[tokenEnd])) {
        tokenEnd++;
    }

    const currentToken = input.slice(tokenStart, cursorPos);

    // -------------------------------------------------------------------------
    // LAYER 4: Header bracket completion e.g. req.header["auth or req.header[
    // -------------------------------------------------------------------------
    const headerBracketMatch = currentToken.match(/^(req\.header|resp\.header)\[["']?([^\]"']*)$/i);
    if (headerBracketMatch) {
        const fieldPrefix = headerBracketMatch[1];
        const partialHeader = headerBracketMatch[2].toLowerCase();
        const fieldDef = HTTPQL_FIELDS.find((f) => f.name.toLowerCase() === fieldPrefix.toLowerCase());
        const headers = fieldDef?.presetValues || [];

        const filtered = headers
            .filter((h) => h.toLowerCase().includes(partialHeader))
            .map((h) => ({
                id: `header-${h}`,
                text: `${fieldPrefix}["${h}"]`,
                displayText: h,
                replacement: `${fieldPrefix}["${h}"].`,
                category: 'Header' as const,
                section: 'Fields' as const,
                description: `Header: ${h}`,
                hasMoreLayers: true,
            }));

        return { suggestions: filtered, startPos: tokenStart, endPos: tokenEnd };
    }

    // -------------------------------------------------------------------------
    // LAYER 4: Value completion e.g. `preset:` or `source:` or `req.method.eq:"G`
    // -------------------------------------------------------------------------
    const valueMatch = currentToken.match(/^([a-zA-Z0-9_.\[\]"'-]+)(:|\.eq:|\.ne:|\.gt:|\.gte:|\.lt:|\.lte:|\.cont:|\.ncont:|\.sw:|\.nsw:|\.ew:|\.new:|\.like:|\.nlike:|\.regex:|\.nregex:)(["']?)([^"']*)$/i);
    if (valueMatch) {
        const fieldWithMod = valueMatch[1];
        const op = valueMatch[2];
        const partialVal = valueMatch[4].toLowerCase().trimStart();

        // Extract base field
        const baseFieldStr = fieldWithMod.replace(/\[.*?\]/, '').split('.')[0] +
            (fieldWithMod.includes('.') && !fieldWithMod.startsWith('row') ? '.' + fieldWithMod.replace(/\[.*?\]/, '').split('.')[1] : '');

        if (baseFieldStr === 'preset') {
            const presetsList = dynamicPresets && dynamicPresets.length > 0
                ? dynamicPresets.map(p => ({ alias: p.alias, label: p.name, desc: p.description || `Preset: ${p.name}` }))
                : [
                    { alias: 'hide-static', label: 'Hide Static', desc: 'Hide static assets (images, CSS, JS, fonts, maps)' },
                    { alias: 'errors-only', label: '4xx / 5xx Errors', desc: 'Filter for client and server error responses' },
                    { alias: 'success-only', label: '2xx Success', desc: 'Filter for successful responses (200-299)' },
                    { alias: 'mutating-methods', label: 'POST / PUT / DELETE', desc: 'Filter for mutating HTTP request methods' },
                    { alias: 'json-only', label: 'JSON Traffic', desc: 'Filter for JSON requests or responses' },
                    { alias: 'slow-requests', label: 'Slow (>1s)', desc: 'Requests taking longer than 1,000ms' },
                    { alias: 'has-params', label: 'With Query Params', desc: 'Requests containing URL query parameters' },
                ];

            const filtered = presetsList
                .filter(p => p.alias.toLowerCase().includes(partialVal) || p.label.toLowerCase().includes(partialVal))
                .map(p => ({
                    id: `val-preset-${p.alias}`,
                    text: p.alias,
                    displayText: `${p.alias} (${p.label})`,
                    replacement: `${fieldWithMod}${op}"${p.alias}" `,
                    category: 'Value' as const,
                    section: 'Presets' as const,
                    description: p.desc,
                    hasMoreLayers: false,
                }));

            if (filtered.length > 0) {
                return { suggestions: filtered, startPos: tokenStart, endPos: tokenEnd };
            }
        }

        const fieldDef = findFieldDef(baseFieldStr);

        if (fieldDef && fieldDef.presetValues && fieldDef.presetValues.length > 0) {
            const filtered = fieldDef.presetValues
                .filter((v) => v.replace(/^"|"$/g, '').toLowerCase().includes(partialVal))
                .map((v) => {
                    const cleanV = v.replace(/^"|"$/g, '');
                    let repl: string;
                    if (fieldDef.type === 'integer' || fieldDef.type === 'boolean') {
                        repl = `${fieldWithMod}${op}${cleanV} `;
                    } else if (v.startsWith('"') && v.endsWith('"')) {
                        repl = `${fieldWithMod}${op}${v} `;
                    } else {
                        repl = `${fieldWithMod}${op}"${cleanV}" `;
                    }

                    const display = formatValueDisplay(fieldDef.name, cleanV);

                    return {
                        id: `val-${cleanV}`,
                        text: cleanV,
                        displayText: display,
                        replacement: repl,
                        category: 'Value' as const,
                        section: 'Values' as const,
                        description: `Value for ${fieldDef.name}`,
                        hasMoreLayers: false,
                    };
                });

            if (filtered.length > 0) {
                return { suggestions: filtered, startPos: tokenStart, endPos: tokenEnd };
            }
        }
    }

    // -------------------------------------------------------------------------
    // LAYER 3: Operator / Modifier completion e.g. `req.ext.` or `resp.code.`
    // -------------------------------------------------------------------------
    const operatorMatch = currentToken.match(/^([a-zA-Z0-9_.\[\]"'-]+)\.([a-z]*)$/i);
    if (operatorMatch) {
        const fieldStr = operatorMatch[1];
        const partialOp = operatorMatch[2].toLowerCase();

        const baseFieldStr = fieldStr.replace(/\[.*?\]/, '').split('.')[0] +
            (fieldStr.includes('.') && !fieldStr.startsWith('row') ? '.' + fieldStr.replace(/\[.*?\]/, '').split('.')[1] : '');

        const fieldDef = findFieldDef(baseFieldStr);

        if (fieldDef) {
            const allowed = fieldDef.allowedOperators.filter((op) => op.startsWith('.'));
            const filtered = allowed
                .filter((op) => op.replace(/^\./, '').replace(/:$/, '').includes(partialOp))
                .map((op) => {
                    const info = OPERATOR_LABELS[op] || { label: op, desc: 'Operator' };
                    const hasValues = fieldDef.presetValues && fieldDef.presetValues.length > 0;
                    return {
                        id: `op-${op}`,
                        text: `${fieldStr}${op}`,
                        displayText: op,
                        replacement: `${fieldStr}${op}`,
                        category: 'Operator' as const,
                        section: 'Operators' as const,
                        description: info.desc,
                        hasMoreLayers: Boolean(hasValues),
                    };
                });

            if (filtered.length > 0) {
                return { suggestions: filtered, startPos: tokenStart, endPos: tokenEnd };
            }
        }
    }

    // -------------------------------------------------------------------------
    // LAYER 2: Namespace Sub-Fields (req, resp, row)
    // -------------------------------------------------------------------------
    const lowerToken = currentToken.toLowerCase();

    // 2A. If user typed "req." or "req" + dot
    if (lowerToken.startsWith('req.') || (lowerToken.startsWith('req') && lowerToken.length > 3)) {
        const subPart = lowerToken.startsWith('req.') ? lowerToken.slice(4) : lowerToken.slice(3);
        const reqFields = HTTPQL_FIELDS.filter((f) => f.name.startsWith('req.'));

        const suggestions: AutocompleteSuggestion[] = reqFields
            .filter((f) => {
                const subName = f.name.slice(4);
                return subName.toLowerCase().includes(subPart);
            })
            .map((f) => {
                const subName = f.name.slice(4);
                const repl = f.name === 'req.header' ? 'req.header["' : `${f.name}.`;

                return {
                    id: `req-field-${subName}`,
                    text: subName,
                    displayText: subName,
                    replacement: repl,
                    category: 'Field' as const,
                    section: 'Fields' as const,
                    description: f.description,
                    hasMoreLayers: true,
                };
            });

        return {
            suggestions,
            startPos: tokenStart,
            endPos: tokenEnd,
        };
    }

    // 2B. If user typed "resp." or "resp" + dot
    if (lowerToken.startsWith('resp.') || (lowerToken.startsWith('resp') && lowerToken.length > 4)) {
        const subPart = lowerToken.startsWith('resp.') ? lowerToken.slice(5) : lowerToken.slice(4);
        const respFields = HTTPQL_FIELDS.filter((f) => f.name.startsWith('resp.'));

        const suggestions: AutocompleteSuggestion[] = respFields
            .filter((f) => {
                const subName = f.name.slice(5);
                return subName.toLowerCase().includes(subPart);
            })
            .map((f) => {
                const subName = f.name.slice(5);
                const repl = f.name === 'resp.header' ? 'resp.header["' : `${f.name}.`;

                return {
                    id: `resp-field-${subName}`,
                    text: subName,
                    displayText: subName,
                    replacement: repl,
                    category: 'Field' as const,
                    section: 'Fields' as const,
                    description: f.description,
                    hasMoreLayers: true,
                };
            });

        return {
            suggestions,
            startPos: tokenStart,
            endPos: tokenEnd,
        };
    }

    // 2C. If user typed "row." or "row" + dot
    if (lowerToken.startsWith('row.') || (lowerToken.startsWith('row') && lowerToken.length > 3)) {
        const subPart = lowerToken.startsWith('row.') ? lowerToken.slice(4) : lowerToken.slice(3);
        const rowFields = [
            {
                name: 'row.id',
                subName: 'id',
                desc: 'Numerical identifier of a traffic table row',
                repl: 'row.id.',
                hasMoreLayers: true,
            },
        ];

        const suggestions: AutocompleteSuggestion[] = rowFields
            .filter((f) => f.subName.toLowerCase().includes(subPart))
            .map((f) => ({
                id: `row-field-${f.subName}`,
                text: f.subName,
                displayText: f.subName,
                replacement: f.repl,
                category: 'Field' as const,
                section: 'Fields' as const,
                description: f.desc,
                hasMoreLayers: f.hasMoreLayers,
            }));

        return {
            suggestions,
            startPos: tokenStart,
            endPos: tokenEnd,
        };
    }

    // -------------------------------------------------------------------------
    // LAYER 1: Root Suggestions
    // Order: 1. Primary Items (Namespaces, Fields, Keywords)
    //        2. Presets (before history)
    //        3. History Commands / Recent Searches (last)
    // -------------------------------------------------------------------------
    const rootSuggestions: AutocompleteSuggestion[] = [];

    // 1A. Primary Namespaces (req, resp, row)
    const namespaces = [
        {
            name: 'req',
            display: 'req',
            replacement: 'req.',
            desc: 'Request namespace (method, path, host, headers, len, etc.)',
        },
        {
            name: 'resp',
            display: 'resp',
            replacement: 'resp.',
            desc: 'Response namespace (code, roundtrip, headers, len, etc.)',
        },
        {
            name: 'row',
            display: 'row',
            replacement: 'row.',
            desc: 'Row identifier namespace (id)',
        },
    ];

    for (const ns of namespaces) {
        if (!lowerToken || ns.name.toLowerCase().startsWith(lowerToken)) {
            rootSuggestions.push({
                id: `ns-${ns.name}`,
                text: ns.name,
                displayText: ns.display,
                replacement: ns.replacement,
                category: 'Root',
                section: 'Namespaces',
                description: ns.desc,
                hasMoreLayers: true,
            });
        }
    }

    // 1B. Primary Fields & Aliases matching token (e.g. "method", "status", "host", "port", "len")
    if (lowerToken.length > 0 && !['req', 'resp', 'row'].includes(lowerToken)) {
        const matchedFields = HTTPQL_FIELDS.filter((f) => {
            const nameMatch = f.name.toLowerCase().includes(lowerToken);
            const aliasMatch = f.aliases?.some((a) => a.toLowerCase().includes(lowerToken));
            return nameMatch || aliasMatch;
        }).slice(0, 8);

        for (const f of matchedFields) {
            const repl = f.name.endsWith('.header') ? `${f.name}["` : `${f.name}.`;
            rootSuggestions.push({
                id: `root-field-${f.name}`,
                text: f.name,
                displayText: f.name,
                replacement: repl,
                category: 'Field',
                section: 'Fields',
                description: f.description,
                hasMoreLayers: true,
            });
        }
    }

    // 1C. Primary Logical keywords (AND, OR, NOT)
    if (textBefore.trim().length > 0 && (lowerToken === '' || 'and'.startsWith(lowerToken) || 'or'.startsWith(lowerToken) || 'not'.startsWith(lowerToken))) {
        const keywords = [
            { text: 'and', desc: 'Both clauses must be true (higher precedence)' },
            { text: 'or', desc: 'Either clause must be true (lower precedence)' },
            { text: 'not', desc: 'Negate following clause' },
        ];

        for (const kw of keywords) {
            if (lowerToken === '' || kw.text.startsWith(lowerToken)) {
                rootSuggestions.push({
                    id: `kw-${kw.text}`,
                    text: kw.text,
                    displayText: kw.text.toUpperCase(),
                    replacement: `${kw.text.toUpperCase()} `,
                    category: 'Keyword',
                    section: 'Keywords',
                    description: kw.desc,
                    hasMoreLayers: true,
                });
            }
        }
    }

    // 2. Presets (predefined / dynamic presets) - before history
    const presetsList = dynamicPresets && dynamicPresets.length > 0
        ? dynamicPresets.map((p) => ({ alias: p.alias, label: p.name, desc: p.description || `Preset: ${p.name}` }))
        : [
            { alias: 'hide-static', label: 'Hide Static', desc: 'Hide static assets (images, CSS, JS, fonts, maps)' },
            { alias: 'errors-only', label: '4xx / 5xx Errors', desc: 'Filter for client and server error responses' },
            { alias: 'success-only', label: '2xx Success', desc: 'Filter for successful responses (200-299)' },
            { alias: 'mutating-methods', label: 'POST / PUT / DELETE', desc: 'Filter for mutating HTTP request methods' },
            { alias: 'json-only', label: 'JSON Traffic', desc: 'Filter for JSON requests or responses' },
            { alias: 'slow-requests', label: 'Slow (>1s)', desc: 'Requests taking longer than 1,000ms' },
            { alias: 'has-params', label: 'With Query Params', desc: 'Requests containing URL query parameters' },
        ];

    const matchingPresets = presetsList
        .filter((p) => !lowerToken || p.alias.toLowerCase().includes(lowerToken) || p.label.toLowerCase().includes(lowerToken) || 'preset'.startsWith(lowerToken))
        .slice(0, 7);

    for (const p of matchingPresets) {
        rootSuggestions.push({
            id: `preset-item-${p.alias}`,
            text: `preset:"${p.alias}"`,
            displayText: `preset:"${p.alias}"`,
            replacement: `preset:"${p.alias}" `,
            category: 'Value',
            section: 'Presets',
            description: `${p.label} - ${p.desc}`,
            hasMoreLayers: false,
        });
    }

    // 3. History Commands / Recent Searches (last)
    if (recentSearches && recentSearches.length > 0) {
        const matchingRecent = recentSearches
            .filter((q) => !lowerToken || q.toLowerCase().includes(lowerToken))
            .slice(0, 5);

        for (const q of matchingRecent) {
            rootSuggestions.push({
                id: `recent-${q}`,
                text: q,
                displayText: q,
                replacement: `${q} `,
                category: 'Recent',
                section: 'Recent Searches',
                description: 'Recent query',
                hasMoreLayers: false,
            });
        }
    }

    return {
        suggestions: rootSuggestions,
        startPos: tokenStart,
        endPos: tokenEnd,
    };
}

function findFieldDef(fieldStr: string): HttpqlFieldDef | undefined {
    const lower = fieldStr.toLowerCase();
    return HTTPQL_FIELDS.find(
        (f) => f.name.toLowerCase() === lower || f.aliases?.some((a) => a.toLowerCase() === lower)
    );
}

function formatValueDisplay(fieldName: string, val: string): string {
    if (fieldName === 'resp.code') {
        const statusMap: Record<string, string> = {
            '200': '200 (OK)',
            '201': '201 (Created)',
            '204': '204 (No Content)',
            '301': '301 (Moved Permanently)',
            '302': '302 (Found)',
            '304': '304 (Not Modified)',
            '400': '400 (Bad Request)',
            '401': '401 (Unauthorized)',
            '403': '403 (Forbidden)',
            '404': '404 (Not Found)',
            '405': '405 (Method Not Allowed)',
            '500': '500 (Internal Server Error)',
            '502': '502 (Bad Gateway)',
            '503': '503 (Service Unavailable)',
        };
        return statusMap[val] || val;
    }
    if (fieldName === 'req.tls') {
        return val === 'true' ? 'true (HTTPS)' : 'false (HTTP)';
    }
    return val;
}
