import { PreprocessingRule, FuzzerSession, FuzzerParameter } from '@/types/fuzzer.type';

/**
 * URL-encode key/reserved characters (anything other than unreserved A-Z, a-z, 0-9, -, _, ., ~).
 */
export function encodeUrlKeyCharacters(input: string): string {
    return Array.from(new TextEncoder().encode(input))
        .map((b) => {
            const ch = String.fromCharCode(b);
            if (/[a-zA-Z0-9\-_.~]/.test(ch)) {
                return ch;
            }
            return '%' + b.toString(16).toUpperCase().padStart(2, '0');
        })
        .join('');
}

/**
 * URL-encode every single character into %XX format.
 */
export function encodeUrlAllCharacters(input: string): string {
    return Array.from(new TextEncoder().encode(input))
        .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
}

/**
 * Safe URL decode.
 */
export function decodeUrl(input: string): string {
    try {
        return decodeURIComponent(input.replace(/\+/g, '%20'));
    } catch {
        // Fallback for partial/malformed % sequences
        return input.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => {
            try {
                return String.fromCharCode(parseInt(hex, 16));
            } catch {
                return '%' + hex;
            }
        });
    }
}

/**
 * Safe Base64 encode for Unicode strings.
 */
export function encodeBase64(input: string): string {
    try {
        const bytes = new TextEncoder().encode(input);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) {
            bin += String.fromCharCode(bytes[i]);
        }
        return btoa(bin);
    } catch (e) {
        return btoa(input);
    }
}

/**
 * Safe Base64 decode for Unicode strings.
 */
export function decodeBase64(input: string): string {
    try {
        const trimmed = input.trim();
        const bin = atob(trimmed);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return input;
    }
}

/**
 * Applies a single preprocessing rule to a payload string.
 */
export function applyPreprocessingRule(input: string, rule: PreprocessingRule): string {
    switch (rule.type) {
        case 'modify_case': {
            if (rule.caseOption === 'lowercase') return input.toLowerCase();
            if (rule.caseOption === 'uppercase') return input.toUpperCase();
            return input;
        }
        case 'encode': {
            if (rule.encodeOption === 'url_key') return encodeUrlKeyCharacters(input);
            if (rule.encodeOption === 'url_all') return encodeUrlAllCharacters(input);
            if (rule.encodeOption === 'base64') return encodeBase64(input);
            return input;
        }
        case 'decode': {
            if (rule.decodeOption === 'url') return decodeUrl(input);
            if (rule.decodeOption === 'base64') return decodeBase64(input);
            return input;
        }
        case 'prefix': {
            return (rule.value ?? '') + input;
        }
        case 'suffix': {
            return input + (rule.value ?? '');
        }
        case 'match_replace': {
            const pattern = rule.pattern ?? '';
            const replacement = rule.replacement ?? '';
            if (!pattern) return input;
            try {
                const regex = new RegExp(pattern, 'g');
                return input.replace(regex, replacement);
            } catch {
                return input.split(pattern).join(replacement);
            }
        }
        default:
            return input;
    }
}

/**
 * Applies a sequence of preprocessing rules sequentially to an input string.
 */
export function applyPipeline(input: string, rules?: PreprocessingRule[]): string {
    if (!rules || rules.length === 0) return input;
    return rules.reduce((acc, rule) => applyPreprocessingRule(acc, rule), input);
}

/**
 * Helper to get active rules for a parameter given the session state.
 */
export function getActiveRulesForParam(session: FuzzerSession, param?: FuzzerParameter | null): PreprocessingRule[] {
    const scope = session.fuzzConfig.pipelineScope ?? 'all';
    if (scope === 'per_parameter') {
        return param?.pipelineRules ?? [];
    }
    return session.fuzzConfig.pipelineRules ?? [];
}
