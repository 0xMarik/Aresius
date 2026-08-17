import { LanguageSupport, StreamLanguage, foldService, foldNodeProp } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { EditorState, Facet } from '@codemirror/state';
import { jsonLanguage } from '@codemirror/lang-json';
import { htmlLanguage } from '@codemirror/lang-html';

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

// ---------------------------------------------------------------------------
// JavaScript Tokenizer (for embedded <script> tags & JS responses)
// ---------------------------------------------------------------------------

const JS_KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'default', 'class', 'extends', 'new',
    'this', 'super', 'import', 'export', 'from', 'as', 'async', 'await', 'try',
    'catch', 'finally', 'throw', 'typeof', 'instanceof', 'void', 'delete', 'yield',
    'debugger', 'in', 'of', 'with'
]);

const JS_ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const JS_BUILTINS = new Set([
    'window', 'document', 'console', 'fetch', 'Promise', 'Array', 'Object', 'String',
    'Number', 'Boolean', 'JSON', 'Math', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'Symbol', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
    'localStorage', 'sessionStorage', 'location', 'history', 'navigator',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'addEventListener',
    'removeEventListener', 'querySelector', 'querySelectorAll', 'getElementById'
]);

function tokenizeJs(stream: any, state: any) {
    if (stream.eatSpace()) return null;

    const ch = stream.peek();

    // Multi-line block comment in JS
    if (state.js?.inBlockComment) {
        if (stream.match(/^[\s\S]*?\*\//)) {
            if (state.js) state.js.inBlockComment = false;
        } else {
            stream.skipToEnd();
        }
        return 'comment';
    }

    // Template literal in JS
    if (state.js?.inTemplateString) {
        let escaped = false;
        while (!stream.eol()) {
            const nextCh = stream.next();
            if (escaped) {
                escaped = false;
                continue;
            }
            if (nextCh === '\\') {
                escaped = true;
                continue;
            }
            if (nextCh === '`') {
                if (state.js) state.js.inTemplateString = false;
                break;
            }
            if (nextCh === '$' && stream.peek() === '{') {
                stream.next();
                return 'operator';
            }
        }
        return 'string';
    }

    // Comments & regexes: fast guard on '/'
    if (ch === '/') {
        if (stream.match(/^\/\*/)) {
            if (!stream.match(/^[\s\S]*?\*\//)) {
                if (!state.js) state.js = {};
                state.js.inBlockComment = true;
            }
            return 'comment';
        }
        if (stream.match(/^\/\/.*/)) {
            return 'comment';
        }
        if (stream.match(/^\/(?![*\/])(?:[^\/\\\n]|\\.)*\/[gimsuy]*/)) {
            return 'string';
        }
    }

    // Strings: fast guard on quotes
    if (ch === '"') {
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
        stream.next();
        return 'string';
    }
    if (ch === "'") {
        if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';
        stream.next();
        return 'string';
    }
    if (ch === '`') {
        if (stream.match(/^`([^`\\]|\\.)*`/)) return 'string';
        if (!state.js) state.js = {};
        state.js.inTemplateString = true;
        stream.next();
        return 'string';
    }

    // Numbers: fast guard on digits or negative digit
    if ((ch >= '0' && ch <= '9') || ch === '-') {
        if (stream.match(/^0x[0-9a-fA-F]+/i) || stream.match(/^0b[01]+/i) || stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) {
            return 'number';
        }
    }

    // Brackets: instant single-character match
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
        stream.next();
        return 'bracket';
    }

    // Punctuation / Semicolon / Comma
    if (ch === ';' || ch === ',' || ch === '.') {
        stream.next();
        return 'operator';
    }

    // Operators and arrows
    if (ch === '=' || ch === '+' || ch === '-' || ch === '*' || ch === '%' || ch === '&' || ch === '|' || ch === '^' || ch === '!' || ch === '~' || ch === '?' || ch === ':' || ch === '<' || ch === '>') {
        if (stream.match(/^(=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.)/)) {
            return 'operator';
        }
        stream.next();
        return 'operator';
    }

    // Identifiers, keywords, function names, properties
    if (stream.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)) {
        const word = stream.current();
        if (JS_KEYWORDS.has(word)) return 'keyword';
        if (JS_ATOMS.has(word)) return 'atom';
        if (JS_BUILTINS.has(word)) return 'variable';
        if (stream.peek() === '(') return 'property'; // function call / method
        return null;
    }

    stream.next();
    return null;
}

// ---------------------------------------------------------------------------
// CSS Tokenizer (for embedded <style> tags & CSS responses)
// ---------------------------------------------------------------------------

function tokenizeCss(stream: any, _state: any) {
    if (stream.eatSpace()) return null;

    const ch = stream.peek();

    if (ch === '/' && stream.match(/^\/\*[\s\S]*?\*\//)) {
        return 'comment';
    }

    if (ch === '"' && stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (ch === "'" && stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';

    // Hex colors
    if (ch === '#' && stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'atom';

    // Numbers with CSS units (px, em, rem, %, vh, vw, s, ms, deg)
    if ((ch >= '0' && ch <= '9') || ch === '-') {
        if (stream.match(/^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch)?/)) {
            return 'number';
        }
    }

    // CSS properties and pseudo classes
    if (ch === ':') {
        if (stream.match(/^:[a-zA-Z-]+/)) return 'property';
        stream.next();
        return 'operator';
    }

    if (ch === '@' && stream.match(/^@[a-zA-Z-]+/)) return 'keyword';

    if (ch === '{' || ch === '}') {
        stream.next();
        return 'bracket';
    }

    if (ch === ';' || ch === ',') {
        stream.next();
        return 'operator';
    }

    if (stream.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*(?=\s*:)/)) {
        return 'property';
    }

    if (stream.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*/)) {
        return 'attribute';
    }

    stream.next();
    return null;
}

/** Shared tokenizer for HTML and XML bodies -- tags, attributes, comments, embedded JS/CSS. */
function tokenizeMarkup(stream: any, state: any) {
    if (stream.eatSpace()) return null;

    // Inside <script> ... </script> block
    if (state.html.inScript) {
        if (stream.match(/^<\/script\s*>/i)) {
            state.html.inScript = false;
            return 'tag';
        }
        return tokenizeJs(stream, state);
    }

    // Inside <style> ... </style> block
    if (state.html.inStyle) {
        if (stream.match(/^<\/style\s*>/i)) {
            state.html.inStyle = false;
            return 'tag';
        }
        return tokenizeCss(stream, state);
    }

    if (state.html.inComment) {
        if (stream.match(/^[\s\S]*?-->/)) {
            state.html.inComment = false;
        } else {
            stream.skipToEnd();
        }
        return 'comment';
    }

    const ch = stream.peek();

    if (ch === '<') {
        if (stream.match(/^<!--/)) {
            if (!stream.match(/^[\s\S]*?-->/)) {
                state.html.inComment = true;
            }
            return 'comment';
        }

        if (stream.match(/^<\/[a-zA-Z_:][a-zA-Z0-9_:.-]*\s*>/)) {
            return 'tag';
        }

        if (stream.match(/^<\?[a-zA-Z][a-zA-Z0-9_:.-]*/)) {
            state.html.inTag = true;
            return 'tag';
        }

        if (stream.match(/^<[a-zA-Z_:][a-zA-Z0-9_:.-]*/)) {
            const tagText = stream.current().slice(1).toLowerCase();
            state.html.lastTag = tagText;
            state.html.inTag = true;
            return 'tag';
        }
    }

    if (state.html.inTag) {
        if (stream.match(/^\/?>/)) {
            const isSelfClosing = stream.current().startsWith('/');
            state.html.inTag = false;
            if (!isSelfClosing) {
                if (state.html.lastTag === 'script') {
                    state.html.inScript = true;
                } else if (state.html.lastTag === 'style') {
                    state.html.inStyle = true;
                }
            }
            return 'bracket';
        }
        if (stream.match(/^[a-zA-Z_:][a-zA-Z0-9_:.-]*(?=\s*=)/)) {
            return 'attribute';
        }
        if (ch === '=') {
            stream.next();
            return 'operator';
        }
        if (ch === '"' || ch === "'") {
            if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) {
                return 'string';
            }
        }
        if (stream.match(/^[a-zA-Z_:][a-zA-Z0-9_:.-]*/)) {
            return 'attribute';
        }
        stream.next();
        return null;
    }

    // Plain text node content -- consume up to the next '<'
    if (stream.match(/^[^<]+/)) {
        return null;
    }

    stream.next();
    return null;
}

// ---------------------------------------------------------------------------
// Additional Content-Type Tokenizers (URL-encoded, Multipart, GraphQL, YAML, Markdown, SSE)
// ---------------------------------------------------------------------------

function tokenizeUrlEncoded(stream: any, _state: any) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();

    if (ch === '&' || ch === '=') {
        stream.next();
        return 'operator';
    }
    // URL-encoded hex entities %20, %3D, etc.
    if (ch === '%' && stream.match(/^%[0-9a-fA-F]{2}/)) {
        return 'atom';
    }
    // Parameter key (before =)
    if (stream.match(/^[^&=%\s]+(?=\s*=)/)) {
        return 'property';
    }
    // Parameter value
    if (stream.match(/^[^&=%\s]+/)) {
        const val = stream.current();
        if (/^-?\d+(\.\d+)?$/.test(val)) return 'number';
        if (val === 'true' || val === 'false' || val === 'null') return 'atom';
        return 'string';
    }
    stream.next();
    return null;
}

function tokenizeMultipart(stream: any, _state: any) {
    if (stream.eatSpace()) return null;

    // Boundary line: --boundary or --boundary--
    if (stream.sol() && stream.match(/^--[^\r\n]+/)) {
        return 'keyword';
    }

    const ch = stream.peek();

    // Sub-headers: Content-Disposition, Content-Type, Content-Transfer-Encoding
    if (stream.match(/^[A-Za-z-]+(?=:)/)) {
        return 'property';
    }
    if (ch === ':' || ch === '=' || ch === ';') {
        stream.next();
        return 'operator';
    }
    if (stream.match(/^(form-data|name|filename|boundary|charset)(?=\s*=)/i)) {
        return 'attribute';
    }
    if (ch === '"' && stream.match(/^"(?:[^"\\]|\\.)*"/)) {
        return 'string';
    }

    stream.next();
    return null;
}

const GRAPHQL_KEYWORDS = new Set([
    'query', 'mutation', 'subscription', 'fragment', 'schema', 'type',
    'input', 'enum', 'interface', 'union', 'scalar', 'directive', 'on',
    'extend', 'implements', 'repeatable'
]);

function tokenizeGraphQL(stream: any, _state: any) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();

    // Comment
    if (ch === '#') {
        stream.skipToEnd();
        return 'comment';
    }

    // Variable: $varName
    if (ch === '$' && stream.match(/^\$[a-zA-Z0-9_]+/)) {
        return 'variable';
    }

    // Directive: @include, @skip
    if (ch === '@' && stream.match(/^@[a-zA-Z0-9_]+/)) {
        return 'keyword';
    }

    // Block strings or regular strings
    if (ch === '"') {
        if (stream.match(/^"""[\s\S]*?"""/)) return 'string';
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
        stream.next();
        return 'string';
    }

    // Numbers
    if ((ch >= '0' && ch <= '9') || ch === '-') {
        if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    }

    // Brackets
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
        stream.next();
        return 'bracket';
    }

    // Operators
    if (ch === ':' || ch === '!' || ch === '=') {
        stream.next();
        return 'operator';
    }

    // Identifiers & keywords
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        const word = stream.current();
        if (GRAPHQL_KEYWORDS.has(word)) return 'keyword';
        if (word === 'true' || word === 'false' || word === 'null') return 'atom';
        return 'property';
    }

    stream.next();
    return null;
}

function tokenizeYaml(stream: any, _state: any) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();

    // Comment
    if (ch === '#') {
        stream.skipToEnd();
        return 'comment';
    }

    // List marker: - item
    if (ch === '-' && stream.match(/^-\s+/)) {
        return 'operator';
    }

    // Strings
    if (ch === '"' && stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (ch === "'" && stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';

    // Numbers
    if ((ch >= '0' && ch <= '9') || ch === '-') {
        if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    }

    // Key (before colon)
    if (stream.match(/^[a-zA-Z0-9_.-]+(?=\s*:)/)) {
        return 'property';
    }

    // Colon separator
    if (ch === ':') {
        stream.next();
        return 'operator';
    }

    // Booleans / null
    if (stream.match(/^(true|false|yes|no|null|on|off)\b/i)) {
        return 'atom';
    }

    // Plain string value
    if (stream.match(/^[^\n\r#]+/)) {
        return 'string';
    }

    stream.next();
    return null;
}

function tokenizeSSE(stream: any, _state: any) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();

    // Comment
    if (ch === ':') {
        stream.skipToEnd();
        return 'comment';
    }

    // SSE fields: event, data, id, retry
    if (stream.match(/^(event|data|id|retry)(?=:)/i)) {
        return 'property';
    }

    if (ch === ':') {
        stream.next();
        return 'operator';
    }

    // Payload data
    if (stream.match(/^[^\n\r]+/)) {
        return 'string';
    }

    stream.next();
    return null;
}

function tokenizeMarkdown(stream: any, _state: any) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();

    // Headings: #, ##, ###
    if (stream.sol() && ch === '#' && stream.match(/^#+\s+/)) {
        return 'keyword';
    }

    // Blockquote
    if (stream.sol() && ch === '>') {
        stream.next();
        return 'operator';
    }

    // Code blocks / inline code
    if (ch === '`') {
        if (stream.match(/^`{3,}[^\n\r]*/)) return 'keyword';
        if (stream.match(/^`[^`]+`/)) return 'string';
        stream.next();
        return 'string';
    }

    // Lists
    if (stream.sol() && stream.match(/^(\*|-|\+|\d+\.)\s+/)) {
        return 'operator';
    }

    // Links: [text](url)
    if (ch === '[') {
        if (stream.match(/^\[[^\]]*\](?=\([^\)]*\))/)) return 'property';
    }
    if (ch === '(' && stream.match(/^\([^\)]+\)/)) {
        return 'string';
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
        case 'javascript':
        case 'js':
            return tokenizeJs(stream, state);
        case 'css':
            return tokenizeCss(stream, state);
        case 'urlencoded':
            return tokenizeUrlEncoded(stream, state);
        case 'multipart':
            return tokenizeMultipart(stream, state);
        case 'graphql':
            return tokenizeGraphQL(stream, state);
        case 'yaml':
            return tokenizeYaml(stream, state);
        case 'sse':
            return tokenizeSSE(stream, state);
        case 'markdown':
            return tokenizeMarkdown(stream, state);
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

        // Defensive net for whitespace-only "blank" lines.
        if (!state.inBody && /^\s*$/.test(stream.string)) {
            state.inBody = true;
            stream.skipToEnd();
            return null;
        }

        // Skip whitespace
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

        // Content-Type header value -- detect all web content types
        if (state.isContentTypeHeader) {
            if (stream.match(/^[^\n\r]*/)) {
                const headerValue = stream.current().toLowerCase();

                if (
                    headerValue.includes('application/json') ||
                    headerValue.includes('application/ld+json') ||
                    headerValue.includes('application/problem+json') ||
                    headerValue.includes('application/manifest+json') ||
                    headerValue.includes('application/schema+json') ||
                    headerValue.includes('application/vnd.api+json') ||
                    headerValue.includes('+json') ||
                    headerValue.includes('text/json')
                ) {
                    state.contentType = 'json';
                } else if (headerValue.includes('text/html') || headerValue.includes('application/xhtml+xml')) {
                    state.contentType = 'html';
                } else if (
                    headerValue.includes('application/xml') ||
                    headerValue.includes('text/xml') ||
                    headerValue.includes('image/svg+xml') ||
                    headerValue.includes('application/soap+xml') ||
                    headerValue.includes('application/rss+xml') ||
                    headerValue.includes('application/atom+xml') ||
                    headerValue.includes('+xml')
                ) {
                    state.contentType = 'xml';
                } else if (
                    headerValue.includes('application/javascript') ||
                    headerValue.includes('text/javascript') ||
                    headerValue.includes('application/x-javascript') ||
                    headerValue.includes('text/ecmascript') ||
                    headerValue.includes('text/typescript')
                ) {
                    state.contentType = 'javascript';
                } else if (headerValue.includes('text/css') || headerValue.includes('text/x-scss') || headerValue.includes('text/x-less')) {
                    state.contentType = 'css';
                } else if (headerValue.includes('application/x-www-form-urlencoded')) {
                    state.contentType = 'urlencoded';
                } else if (headerValue.includes('multipart/form-data') || headerValue.includes('multipart/')) {
                    state.contentType = 'multipart';
                } else if (headerValue.includes('application/graphql') || headerValue.includes('application/graphql+json')) {
                    state.contentType = 'graphql';
                } else if (headerValue.includes('yaml') || headerValue.includes('x-yaml')) {
                    state.contentType = 'yaml';
                } else if (headerValue.includes('text/event-stream')) {
                    state.contentType = 'sse';
                } else if (headerValue.includes('text/markdown') || headerValue.includes('text/x-markdown')) {
                    state.contentType = 'markdown';
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
            contentType: 'text',
            json: { inString: false, stringIsKey: false },
            html: { inComment: false, inTag: false, inScript: false, inStyle: false, lastTag: '' },
            js: { inBlockComment: false, inTemplateString: false },
        };
    },

    blankLine(state: any) {
        state.inBody = true;
    },

    copyState(state: any) {
        return {
            hasMethod: state.hasMethod,
            inBody: state.inBody,
            isContentTypeHeader: state.isContentTypeHeader,
            contentType: state.contentType,
            json: { ...state.json },
            html: { ...state.html },
            js: { ...state.js },
        };
    },
};

export const httpStreamLanguage = StreamLanguage.define(httpMode);

// ---------------------------------------------------------------------------
// High-Performance Cached Folding Service (Headers + Lezer AST + O(log N) lookup)
// ---------------------------------------------------------------------------

interface CachedBodyInfo {
    blankLineNum: number;
    bodyStartOffset: number;
    tree: any | null;
}

// WeakMap caches the parsed Lezer tree per document instance, completely eliminating
// redundant parsing on every visible line query during scrolling.
const docBodyCache = new WeakMap<object, CachedBodyInfo>();

// Safety limit: Don't parse full AST for massive payloads > 300 KB to guarantee 60 FPS
const MAX_LEZER_PARSE_SIZE = 300_000;

function getCachedBodyInfo(doc: any): CachedBodyInfo {
    let cached = docBodyCache.get(doc);
    if (cached) return cached;

    let blankLineNum = -1;
    let bodyStartOffset = 0;
    const linesCount = doc.lines;

    for (let l = 1; l <= linesCount; l++) {
        const line = doc.line(l);
        if (line.text.trim() === '') {
            blankLineNum = l;
            bodyStartOffset = line.to + 1;
            break;
        }
    }

    let tree: any = null;

    if (blankLineNum !== -1 && bodyStartOffset < doc.length) {
        const bodyLength = doc.length - bodyStartOffset;

        if (bodyLength > 0 && bodyLength <= MAX_LEZER_PARSE_SIZE) {
            try {
                const bodyText = doc.sliceString(bodyStartOffset);
                const headersText = doc.sliceString(0, bodyStartOffset);

                const isJson =
                    /content-type:\s*(application\/(?:json|ld\+json)|text\/json)/i.test(headersText) ||
                    /^\s*[\{\[]/.test(bodyText);

                const isHtmlOrXml =
                    /content-type:\s*(text\/(?:html|xml)|application\/(?:xhtml\+xml|xml))/i.test(headersText) ||
                    /^\s*</.test(bodyText);

                if (isJson) {
                    tree = jsonLanguage.parser.parse(bodyText);
                } else if (isHtmlOrXml) {
                    tree = htmlLanguage.parser.parse(bodyText);
                } else if (/^\s*[\{\[]/.test(bodyText)) {
                    tree = jsonLanguage.parser.parse(bodyText);
                } else if (/^\s*</.test(bodyText)) {
                    tree = htmlLanguage.parser.parse(bodyText);
                }
            } catch {
                tree = null;
            }
        }
    }

    cached = { blankLineNum, bodyStartOffset, tree };
    docBodyCache.set(doc, cached);
    return cached;
}

function findHeadersFold(state: EditorState, lineNum: number): { from: number; to: number } | null {
    if (lineNum !== 1) return null;
    const doc = state.doc;
    let blankLineNum = -1;

    for (let l = 1; l <= doc.lines; l++) {
        const line = doc.line(l);
        if (line.text.trim() === '') {
            blankLineNum = l;
            break;
        }
    }

    if (blankLineNum > 2) {
        const firstLine = doc.line(1);
        const lastHeaderLine = doc.line(blankLineNum - 1);
        return { from: firstLine.to, to: lastHeaderLine.to };
    }
    return null;
}

/** Instant O(log N) point lookup in the cached Lezer tree */
function findLezerFoldFromTree(
    tree: any,
    bodyStartOffset: number,
    state: EditorState,
    lineStart: number,
    lineEnd: number
): { from: number; to: number } | null {
    if (!tree) return null;
    const posInBody = lineStart - bodyStartOffset;
    if (posInBody < 0) return null;

    try {
        let cur = tree.resolveInner(posInBody, 1);

        while (cur) {
            const nodeAbsFrom = bodyStartOffset + cur.from;

            // Check if this syntax node starts on the target line
            if (nodeAbsFrom >= lineStart && nodeAbsFrom <= lineEnd) {
                const prop = cur.type.prop(foldNodeProp);
                if (prop) {
                    try {
                        const fold = prop(cur, state);
                        if (fold) {
                            const absFold = {
                                from: bodyStartOffset + fold.from,
                                to: bodyStartOffset + fold.to,
                            };
                            if (absFold.to > lineEnd) {
                                return absFold;
                            }
                        }
                    } catch {
                        // ignore
                    }
                }
            }
            cur = cur.parent;
        }
    } catch {
        return null;
    }

    return null;
}

function findIndentFold(state: EditorState, startLineNum: number): { from: number; to: number } | null {
    const doc = state.doc;
    const line = doc.line(startLineNum);
    const text = line.text;
    if (!text.trim()) return null;

    const baseIndent = text.match(/^\s*/)?.[0].length ?? 0;
    let endLine = startLineNum;

    for (let l = startLineNum + 1; l <= doc.lines; l++) {
        const nextLine = doc.line(l);
        const nextText = nextLine.text;
        if (!nextText.trim()) {
            continue;
        }
        const nextIndent = nextText.match(/^\s*/)?.[0].length ?? 0;
        if (nextIndent > baseIndent) {
            endLine = l;
        } else {
            break;
        }
    }

    if (endLine > startLineNum) {
        return { from: line.to, to: doc.line(endLine).to };
    }
    return null;
}

export const foldingEnabledFacet = Facet.define<boolean, boolean>({
    combine: (values) => (values.length ? values[values.length - 1] : true),
});

export const hideFoldGutterTheme = EditorView.theme({
    '.cm-foldGutter': {
        display: 'none !important',
    },
});

export const httpFoldService = foldService.of((state: EditorState, lineStart: number) => {
    const isFoldingEnabled = state.facet(foldingEnabledFacet);
    if (!isFoldingEnabled) return null;

    const line = state.doc.lineAt(lineStart);
    const lineNum = line.number;
    const lineEnd = line.to;
    const doc = state.doc;

    // 1. Headers folding (at line 1)
    if (lineNum === 1) {
        const headerFold = findHeadersFold(state, lineNum);
        if (headerFold) return headerFold;
    }

    // 2. Query cached body parse info (O(1) retrieval)
    const { blankLineNum, bodyStartOffset, tree } = getCachedBodyInfo(doc);

    // If inside the body and have a cached Lezer tree, use O(log N) lookup
    if (blankLineNum !== -1 && lineNum > blankLineNum && tree) {
        const fold = findLezerFoldFromTree(tree, bodyStartOffset, state, lineStart, lineEnd);
        if (fold) return fold;
    }

    // 3. Fallback: Fast indentation fold
    return findIndentFold(state, lineNum);
});

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

    // Fold gutter & placeholder styling
    '.cm-foldGutter .cm-gutterElement': {
        cursor: 'pointer',
        color: 'hsl(var(--muted-foreground))',
        opacity: '0.7',
        transition: 'opacity 0.15s ease, color 0.15s ease',
        '&:hover': {
            opacity: '1',
            color: 'hsl(var(--foreground))',
        },
    },
    '.cm-foldPlaceholder': {
        backgroundColor: 'hsl(var(--muted) / 0.8)',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--muted-foreground))',
        borderRadius: '3px',
        padding: '0 5px',
        margin: '0 3px',
        fontSize: '10px',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        cursor: 'pointer',
        '&:hover': {
            backgroundColor: 'hsl(var(--muted))',
            color: 'hsl(var(--foreground))',
        },
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

// Complete language support with optional folding
export function http(options?: { enableFolding?: boolean }) {
    const enableFolding = options?.enableFolding ?? true;
    return new LanguageSupport(httpStreamLanguage, [
        httpTheme,
        foldingEnabledFacet.of(enableFolding),
        ...(enableFolding ? [httpFoldService] : [hideFoldGutterTheme]),
    ]);
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