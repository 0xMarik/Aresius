import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

// ---------------------------------------------------------------------------
// Body tokenizers
// ---------------------------------------------------------------------------

/** Minimal JSON tokenizer. Assumes well-formed JSON (doesn't recover from
 *  syntax errors gracefully, but that's fine for highlighting purposes). */
function tokenizeJson(stream: any, state: any) {
    if (stream.eatSpace()) return null;

    // Continuing a string that started on a previous token call within the line.
    if (state.json.inString) {
        let escaped = false;
        while (!stream.eol()) {
            const ch = stream.next();
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                state.json.inString = false;
                break;
            }
        }
        return state.json.stringIsKey ? 'property' : 'string';
    }

    // Full string on one token call: decide key vs value by lookahead for ':'.
    if (stream.match(/^"(?:[^"\\]|\\.)*"(?=\s*:)/)) {
        return 'property';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
        return 'string';
    }

    // Unterminated string (rare mid-stream case, e.g. very long value) -- fall
    // into the multi-call inString path above on subsequent token() calls.
    if (stream.peek() === '"') {
        const rest = stream.string.slice(stream.pos + 1);
        const isKey = /^(?:[^"\\]|\\.)*"\s*:/.test(rest);
        stream.next();
        state.json.inString = true;
        state.json.stringIsKey = isKey;
        return isKey ? 'property' : 'string';
    }

    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) {
        return 'number';
    }
    if (stream.match(/^(true|false|null)\b/)) {
        return 'atom';
    }
    if (stream.match(/^[{}[\]]/)) {
        return 'bracket';
    }
    if (stream.match(/^[:,]/)) {
        return 'operator';
    }

    stream.next();
    return null;
}

/** Shared tokenizer for HTML and XML bodies -- tags, attributes, comments. */
function tokenizeMarkup(stream: any, state: any) {
    if (stream.eatSpace()) return null;

    if (state.html.inComment) {
        if (stream.match(/^[\s\S]*?-->/)) {
            state.html.inComment = false;
        } else {
            stream.skipToEnd();
        }
        return 'comment';
    }

    if (stream.match(/^<!--/)) {
        // Comment might close on the same line.
        if (!stream.match(/^[\s\S]*?-->/)) {
            state.html.inComment = true;
        }
        return 'comment';
    }

    if (state.html.inTag) {
        if (stream.match(/^\/?>/)) {
            state.html.inTag = false;
            return 'bracket';
        }
        if (stream.match(/^[a-zA-Z_:][a-zA-Z0-9_:.-]*(?=\s*=)/)) {
            return 'attribute';
        }
        if (stream.match(/^=/)) {
            return 'operator';
        }
        if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) {
            return 'string';
        }
        // Boolean attributes (e.g. `disabled`) with no value.
        if (stream.match(/^[a-zA-Z_:][a-zA-Z0-9_:.-]*/)) {
            return 'attribute';
        }
        stream.next();
        return null;
    }

    if (stream.match(/^<\/[a-zA-Z_:][a-zA-Z0-9_:.-]*\s*>/)) {
        return 'tag';
    }

    if (stream.match(/^<\?[a-zA-Z][a-zA-Z0-9_:.-]*/)) {
        // XML declaration / processing instruction, e.g. <?xml version="1.0"?>
        state.html.inTag = true;
        return 'tag';
    }

    if (stream.match(/^<[a-zA-Z_:][a-zA-Z0-9_:.-]*/)) {
        state.html.inTag = true;
        return 'tag';
    }

    // Plain text node content -- consume up to the next '<' or '-->'.
    if (stream.match(/^[^<]+/)) {
        return null;
    }

    stream.next();
    return null;
}

function tokenizeBody(stream: any, state: any) {
    switch (state.contentType) {
        case 'json':
            return tokenizeJson(stream, state);
        case 'html':
        case 'xml':
            return tokenizeMarkup(stream, state);
        default:
            stream.skipToEnd();
            return null;
    }
}

// ---------------------------------------------------------------------------
// HTTP mode
// ---------------------------------------------------------------------------

const httpMode = {
    token(stream: any, state: any) {
        // Body takes over completely once we've hit the blank line separator.
        if (state.inBody) {
            return tokenizeBody(stream, state);
        }

        // Defensive net for whitespace-only "blank" lines. Note: a truly
        // EMPTY line never reaches this function at all -- CodeMirror calls
        // blankLine() below instead of token() for those, which is why that
        // transition is handled there, not here.
        if (!state.inBody && /^\s*$/.test(stream.string)) {
            state.inBody = true;
            stream.skipToEnd();
            return null;
        }

        // Skip whitespace (headers section only -- body handles its own).
        if (stream.eatSpace()) return null;

        if (stream.match(/^\{\{.*?\}\}/)) {
            return 'variable';
        }

        // HTTP method on the very first line.
        if (stream.sol() && !state.hasMethod && stream.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\b/)) {
            state.hasMethod = true;
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

        // Header names (before colon) -- check for Content-Type
        if (stream.match(/^Content-Type(?=:)/i)) {
            state.isContentTypeHeader = true;
            return 'property';
        }

        // Other header names
        if (stream.match(/^[A-Za-z-]+(?=:)/)) {
            return 'property';
        }

        // Header separator
        if (stream.match(/^:\s*/)) {
            return 'operator';
        }

        // Content-Type header value -- detect JSON/HTML/XML/text
        if (state.isContentTypeHeader) {
            if (stream.match(/^[^\n\r]*/)) {
                const headerValue = stream.current();

                if (
                    headerValue.includes('application/json') ||
                    headerValue.includes('application/ld+json') ||
                    headerValue.includes('text/json')
                ) {
                    state.contentType = 'json';
                } else if (headerValue.includes('text/html') || headerValue.includes('application/xhtml+xml')) {
                    state.contentType = 'html';
                } else if (headerValue.includes('application/xml') || headerValue.includes('text/xml')) {
                    state.contentType = 'xml';
                } else {
                    state.contentType = 'text';
                }

                state.isContentTypeHeader = false;
                return 'string';
            }
        }

        // Regular header values
        if (stream.match(/^[^\n\r]*/)) {
            return 'string';
        }

        // Everything else
        stream.next();
        return null;
    },

    startState() {
        return {
            hasMethod: false,
            inBody: false,
            isContentTypeHeader: false,
            contentType: 'text', // default
            json: { inString: false, stringIsKey: false },
            html: { inComment: false, inTag: false },
        };
    },

    // CodeMirror calls this instead of token() for genuinely empty lines --
    // it never runs token() against a zero-length line. This is the actual
    // header/body separator transition; the check inside token() is only a
    // fallback for whitespace-only lines (which aren't truly "blank").
    blankLine(state: any) {
        state.inBody = true;
    },

    // CM6 clones state per line for incremental re-highlighting. The default
    // clone is shallow, so without this, state.json/state.html would be
    // shared BY REFERENCE across cloned states -- mutating one during
    // tokenizing would silently corrupt highlighting elsewhere in the doc,
    // especially noticeable while editing or scrolling.
    copyState(state: any) {
        return {
            hasMethod: state.hasMethod,
            inBody: state.inBody,
            isContentTypeHeader: state.isContentTypeHeader,
            contentType: state.contentType,
            json: { ...state.json },
            html: { ...state.html },
        };
    },
};

export const httpStreamLanguage = StreamLanguage.define(httpMode);

// Custom theme for HTTP highlighting with body-specific styles and light/dark theme adaptation
export const httpTheme = EditorView.theme({
    '&': {
        backgroundColor: 'hsl(var(--card)) !important',
        color: 'hsl(var(--card-foreground))',
    },
    '.cm-gutters': {
        backgroundColor: 'hsl(var(--card)) !important',
        color: 'hsl(var(--muted-foreground))',
        borderRight: '1px solid hsl(var(--border))',
    },
    '.cm-activeLine': {
        backgroundColor: 'hsl(var(--accent) / 0.4)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'hsl(var(--accent))',
    },

    // Dark theme token styling
    '.dark & .cm-keyword, & .cm-keyword': { color: '#ff6b6b', fontWeight: 'bold' },
    '.dark & .cm-string, & .cm-string': { color: '#4ecdc4' },
    '.dark & .cm-number, & .cm-number': { color: '#45b7d1' },
    '.dark & .cm-property, & .cm-property': { color: '#96ceb4', fontWeight: 'bold' },
    '.dark & .cm-operator, & .cm-operator': { color: '#74b9ff' },
    '.dark & .cm-bracket, & .cm-bracket': { color: '#fd79a8' },
    '.dark & .cm-atom, & .cm-atom': { color: '#fdcb6e' },
    '.dark & .cm-tag, & .cm-tag': { color: '#ff7675' },
    '.dark & .cm-attribute, & .cm-attribute': { color: '#a29bfe' },
    '.dark & .cm-comment, & .cm-comment': { color: '#9a9a90', fontStyle: 'italic' },
    '.dark & .cm-variable, & .cm-variable': { color: '#e17055', fontWeight: 'bold', backgroundColor: '#3a2e1b' },

    // Light theme token styling
    '.light & .cm-keyword': { color: '#b23a2e', fontWeight: 'bold' },
    '.light & .cm-string': { color: '#0277bd' },
    '.light & .cm-number': { color: '#00838f' },
    '.light & .cm-property': { color: '#2e7d32', fontWeight: 'bold' },
    '.light & .cm-operator': { color: '#3f51b5' },
    '.light & .cm-bracket': { color: '#ad1457' },
    '.light & .cm-atom': { color: '#e65100' },
    '.light & .cm-tag': { color: '#c62828' },
    '.light & .cm-attribute': { color: '#6a1b9a' },
    '.light & .cm-comment': { color: '#5c6360', fontStyle: 'italic' },
    '.light & .cm-variable': { color: '#d84315', fontWeight: 'bold', backgroundColor: '#fff8e1' },
});

// Complete language support
export function http() {
    return new LanguageSupport(httpStreamLanguage, [httpTheme]);
}

// Example usage:
/*
POST /api/users HTTP/1.1
Content-Type: application/json

{
  "name": "John",
  "age": 30,
  "active": true,
  "note": null
}

---

Content-Type: text/html

<html>
  <!-- comment -->
  <body>
    <h1 class="title">Hello World</h1>
  </body>
</html>
*/