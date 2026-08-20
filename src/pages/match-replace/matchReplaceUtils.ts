import { MatchReplaceRule } from './types';

/**
 * Applies a single match & replace rule to a raw HTTP request string.
 */
export function applyRuleToHttpRequest(rawRequest: string, rule: MatchReplaceRule): string {
    if (!rule.match || !rawRequest) return rawRequest;

    const normalized = rawRequest.replace(/\r\n/g, '\n');
    const headerBodySplitIndex = normalized.indexOf('\n\n');

    let headerSection = headerBodySplitIndex !== -1 ? normalized.slice(0, headerBodySplitIndex) : normalized;
    let bodySection = headerBodySplitIndex !== -1 ? normalized.slice(headerBodySplitIndex + 2) : '';

    const lines = headerSection.split('\n');
    let firstLine = lines[0] || '';
    let headerLines = lines.slice(1);

    const performReplace = (input: string): string => {
        try {
            if (rule.isRegex) {
                const flags = rule.isCaseSensitive ? 'g' : 'gi';
                const regex = new RegExp(rule.match, flags);
                return input.replace(regex, rule.replace);
            } else {
                if (rule.isCaseSensitive) {
                    return input.split(rule.match).join(rule.replace);
                } else {
                    const regex = new RegExp(escapeRegExp(rule.match), 'gi');
                    return input.replace(regex, rule.replace);
                }
            }
        } catch {
            return input;
        }
    };

    switch (rule.type) {
        case 'request_first_line':
            firstLine = performReplace(firstLine);
            break;

        case 'request_header':
            headerLines = headerLines.map(line => performReplace(line)).filter(Boolean);
            break;

        case 'request_body':
            bodySection = performReplace(bodySection);
            break;

        case 'request_param_name':
        case 'request_param_value': {
            // Check if match pattern is present in the first line URL query string or body
            firstLine = performReplace(firstLine);
            break;
        }

        case 'response_header':
            // For live request preview tester, also apply to headers if user is testing
            headerLines = headerLines.map(line => performReplace(line)).filter(Boolean);
            break;

        case 'response_body':
            bodySection = performReplace(bodySection);
            break;

        default:
            break;
    }

    const newHeaderSection = [firstLine, ...headerLines].join('\r\n');
    return headerBodySplitIndex !== -1 ? `${newHeaderSection}\r\n\r\n${bodySection}` : newHeaderSection;
}

/**
 * Applies a list of enabled rules to a raw HTTP request.
 */
export function applyRulesToHttpRequest(rawRequest: string, rules: MatchReplaceRule[]): string {
    let result = rawRequest;
    for (const rule of rules) {
        if (rule.enabled) {
            result = applyRuleToHttpRequest(result, rule);
        }
    }
    return result;
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
