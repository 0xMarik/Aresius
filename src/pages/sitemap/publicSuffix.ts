import { PSL_RULES } from './pslRules';

/**
 * Public Suffix List, indexed by rule set for O(1) lookups.
 * - exceptionRules: rules prefixed with '!' (e.g. "!www.ck" -> "www.ck")
 * - wildcardRules: rules prefixed with '*.' (e.g. "*.ck" -> "ck")
 * - normalRules: everything else (e.g. "com", "co.uk")
 */
const exceptionRules = new Set<string>();
const wildcardRules = new Set<string>();
const normalRules = new Set<string>();

for (const rule of PSL_RULES) {
    if (rule.startsWith('!')) {
        exceptionRules.add(rule.slice(1));
    } else if (rule.startsWith('*.')) {
        wildcardRules.add(rule.slice(2));
    } else {
        normalRules.add(rule);
    }
}

/**
 * Finds the longest matching public suffix for a lowercase, dot-separated
 * hostname's label list, per the standard PSL algorithm:
 * https://publicsuffix.org/list/
 *
 * Returns the number of trailing labels (from `labels`) that make up the
 * public suffix.
 */
function publicSuffixLabelCount(labels: string[]): number {
    let matchedLabelCount = 1; // default: unknown TLD -> treat last label as the suffix

    for (let i = 0; i < labels.length; i++) {
        const candidate = labels.slice(i).join('.');
        const labelCountFromHere = labels.length - i;

        // Exception rule takes precedence: "!www.ck" means www.ck is NOT
        // a suffix -- the suffix is one label shorter than the match.
        if (exceptionRules.has(candidate)) {
            return labelCountFromHere - 1;
        }

        if (normalRules.has(candidate)) {
            matchedLabelCount = Math.max(matchedLabelCount, labelCountFromHere);
        }

        // Wildcard rule "*.ck" matches any single label + ".ck", e.g. "foo.ck"
        if (i > 0) {
            const withoutFirst = labels.slice(i).join('.');
            if (wildcardRules.has(withoutFirst)) {
                matchedLabelCount = Math.max(matchedLabelCount, labelCountFromHere + 1);
            }
        }
    }

    return matchedLabelCount;
}

/**
 * Returns the registrable domain (eTLD+1) for a hostname, e.g.:
 *   "api.example.com"        -> "example.com"
 *   "example.com"             -> "example.com"
 *   "staging.example.co.uk"   -> "example.co.uk"
 *   "localhost"               -> "localhost"
 *   "127.0.0.1"                -> "127.0.0.1"
 *
 * Falls back gracefully (returns the input) for IPs, single-label hosts,
 * or hosts that are themselves exactly a public suffix.
 */
export function getRegistrableDomain(hostname: string): string {
    const host = hostname.trim().toLowerCase();

    // IPv4 / IPv6 literal or bare "localhost" -> no eTLD+1 concept, return as-is
    if (isIpAddress(host) || host === 'localhost') {
        return host;
    }

    const labels = host.split('.').filter(Boolean);
    if (labels.length <= 1) {
        return host;
    }

    const suffixLabelCount = publicSuffixLabelCount(labels);
    // eTLD+1 = one extra label in front of the public suffix, if available
    const registrableLabelCount = Math.min(labels.length, suffixLabelCount + 1);

    return labels.slice(labels.length - registrableLabelCount).join('.');
}

function isIpAddress(host: string): boolean {
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    // IPv6 (very loose check -- contains a colon and hex/colon chars only)
    if (host.includes(':') && /^[0-9a-f:]+$/i.test(host)) return true;
    return false;
}

/**
 * Produces the sitemap "domain" node label for a hostname, e.g.
 * "api.example.com" -> "*.example.com"
 */
export function getDomainLabel(hostname: string): string {
    const host = hostname.trim().toLowerCase();
    if (isIpAddress(host) || host === 'localhost') {
        return host;
    }
    return `*.${getRegistrableDomain(host)}`;
}