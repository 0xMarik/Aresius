/**
 * Helper to prettify raw HTTP request or response strings.
 * Formats JSON bodies, indents structured content, and cleans header formatting.
 */
export function formatHttpMessage(raw: string): string {
    if (!raw) return '';

    // Split headers and body at blank line
    const match = raw.match(/^([\s\S]*?)(?:\r?\n\r?\n)([\s\S]*)$/);
    if (!match) {
        return raw;
    }

    const [, rawHeaders, rawBody] = match;
    let formattedBody = rawBody.trim();

    // Try formatting JSON body
    if (formattedBody) {
        if (
            (formattedBody.startsWith('{') && formattedBody.endsWith('}')) ||
            (formattedBody.startsWith('[') && formattedBody.endsWith(']'))
        ) {
            try {
                const parsed = JSON.parse(formattedBody);
                formattedBody = JSON.stringify(parsed, null, 2);
            } catch {
                // Not valid JSON, keep raw body
            }
        }
    }

    return `${rawHeaders.trim()}\n\n${formattedBody}`;
}
