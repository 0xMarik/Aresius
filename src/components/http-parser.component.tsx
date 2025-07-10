import { StreamLanguage } from '@codemirror/language';

const httpMode = {
    token(stream: any, state: any) {
        // Skip whitespace
        if (stream.eatSpace()) return null;

        // Start of line
        if (stream.sol()) {
            state.lineStart = true;
            // Check if we've hit a blank line (entering body)
            if (stream.eol()) {
                state.inBody = true;
                state.lineStart = false;
                return null;
            }
        }

        // HTTP Methods at start of first line
        if (state.lineStart && !state.hasMethod && stream.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\b/)) {
            state.hasMethod = true;
            state.lineStart = false;
            return 'keyword';
        }

        // URLs
        if (stream.match(/^https?:\/\/[^\s]+/) || stream.match(/^\/[^\s]*/)) {
            return 'string';
        }

        // HTTP Version
        if (stream.match(/^HTTP\/[12](\.[0-9])?/)) {
            return 'number';
        }

        // Header names (before colon) - check for Content-Type
        if (!state.inBody && stream.match(/^Content-Type(?=:)/i)) {
            state.isContentTypeHeader = true;
            return 'property';
        }

        // Other header names
        if (!state.inBody && stream.match(/^[A-Za-z-]+(?=:)/)) {
            return 'property';
        }

        // Header separator
        if (stream.match(/^:\s*/)) {
            return 'operator';
        }

        // Content-Type header value - detect JSON or HTML
        if (state.isContentTypeHeader && !state.inBody) {
            if (stream.match(/^[^\n\r]*/)) {
                const headerValue = stream.current();

                // Check for JSON content types
                if (headerValue.includes('application/json') ||
                    headerValue.includes('application/ld+json') ||
                    headerValue.includes('text/json')) {
                    state.contentType = 'json';
                }
                // Check for HTML content types
                else if (headerValue.includes('text/html') ||
                    headerValue.includes('application/xhtml+xml')) {
                    state.contentType = 'html';
                }
                // Check for XML content types
                else if (headerValue.includes('application/xml') ||
                    headerValue.includes('text/xml')) {
                    state.contentType = 'xml';
                }
                // Default to plain text
                else {
                    state.contentType = 'text';
                }

                state.isContentTypeHeader = false;
                return 'string';
            }
        }

        // Regular header values
        if (!state.inBody && stream.match(/^[^\n\r]*/)) {
            return 'string';
        }

        // Body parsing based on content type
        if (state.inBody) {
            return parseBody(stream, state);
        }

        // Everything else
        stream.next();
        return null;
    },

    startState() {
        return {
            lineStart: true,
            hasMethod: false,
            inBody: false,
            isContentTypeHeader: false,
            contentType: 'text' // default
        };
    }
};

function parseBody(stream: any, state: any) {
    switch (state.contentType) {
        case 'json':
            return parseJsonBody(stream, state);
        case 'html':
        case 'xml':
            return parseHtmlBody(stream, state);
        default:
            return parseTextBody(stream, state);
    }
}

function parseJsonBody(stream: any, state: any) {
    // JSON brackets
    if (stream.match(/^[{}\[\]]/)) {
        return 'bracket';
    }

    // JSON strings
    if (stream.match(/^"([^"\\]|\\.)*"/)) {
        return 'string';
    }

    // JSON numbers
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) {
        return 'number';
    }

    // JSON booleans/null
    if (stream.match(/^(true|false|null)\b/)) {
        return 'atom';
    }

    // JSON operators
    if (stream.match(/^[,:]/)) {
        return 'operator';
    }

    // JSON property names (keys)
    if (stream.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*:)/)) {
        return 'property';
    }

    // Skip other characters
    stream.next();
    return null;
}

function parseHtmlBody(stream: any, state: any) {
    // HTML comments
    if (stream.match(/^<!--[\s\S]*?-->/)) {
        return 'comment';
    }

    // HTML tags
    if (stream.match(/^<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>/) ||
        stream.match(/^<[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>/)) {
        return 'tag';
    }

    // HTML attributes
    if (stream.match(/^[a-zA-Z-]+(?==)/)) {
        return 'attribute';
    }

    // HTML attribute values
    if (stream.match(/^"[^"]*"/) || stream.match(/^'[^']*'/)) {
        return 'string';
    }

    // HTML entities
    if (stream.match(/^&[a-zA-Z0-9]+;/)) {
        return 'atom';
    }

    // Skip other characters
    stream.next();
    return null;
}

function parseTextBody(stream: any, state: any) {
    // For plain text, just consume characters without special highlighting
    stream.next();
    return null;
}

export const httpStreamLanguage = StreamLanguage.define(httpMode);

// Custom theme for HTTP highlighting with body-specific styles
// export const httpTheme = EditorView.theme({
//     '.cm-keyword': { color: '#ff6b6b', fontWeight: 'bold' }, // HTTP methods
//     '.cm-string': { color: '#4ecdc4' }, // URLs and strings
//     '.cm-number': { color: '#45b7d1' }, // HTTP version and numbers
//     '.cm-property': { color: '#96ceb4', fontWeight: 'bold' }, // Header names and JSON keys
//     '.cm-operator': { color: '#74b9ff' }, // Colons and JSON operators
//     '.cm-bracket': { color: '#fd79a8' }, // JSON brackets
//     '.cm-atom': { color: '#fdcb6e' }, // JSON booleans/null and HTML entities
//     '.cm-tag': { color: '#ff7675' }, // HTML tags
//     '.cm-attribute': { color: '#a29bfe' }, // HTML attributes
//     '.cm-comment': { color: '#636e72', fontStyle: 'italic' } // HTML comments
// });

// Complete language support
// export function http() {
//     return new LanguageSupport(httpStreamLanguage, [
//         // Add additional extensions here if needed
//     ]);
// }

// Example usage:
/*
Content-Type: application/json
{
  "name": "John",
  "age": 30
}

Content-Type: text/html
<html>
  <body>
    <h1>Hello World</h1>
  </body>
</html>
*/