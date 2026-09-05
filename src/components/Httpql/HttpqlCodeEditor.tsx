import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { EditorView, placeholder, keymap } from '@codemirror/view';
import { EditorState, Prec, Extension } from '@codemirror/state';
import {
    autocompletion,
    CompletionContext,
    CompletionResult,
    CompletionSection,
    completionStatus,
    acceptCompletion,
    closeCompletion,
    startCompletion,
} from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '../theme-provider';
import { getHttpqlSuggestions } from '@/lib/httpql/autocomplete';
import { HTTPQL_FIELDS, HttpqlFieldDef } from '@/lib/httpql/httpql';

export interface HttpqlCodeEditorRef {
    focus: () => void;
}

export interface HttpqlCodeEditorProps {
    value: string;
    onChange: (val: string) => void;
    onSubmit?: (val: string) => void;
    placeholder?: string;
    dynamicPresets?: { alias: string; name: string; description?: string }[];
    recentSearches?: string[];
    className?: string;
}

// -----------------------------------------------------------------------------
// 1. Lightweight HTTPQL Syntax Highlighter (StreamLanguage)
// -----------------------------------------------------------------------------
const httpqlLanguage = StreamLanguage.define({
    token(stream) {
        if (stream.eatSpace()) return null;

        // Strings ("..." or '...')
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
        if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';

        // Numbers
        if (stream.match(/^-?\d+(?:\.\d+)?\b/)) return 'number';

        // Boolean Conjunctions / Keywords
        if (stream.match(/\b(and|or|not|in|true|false)\b/i)) return 'keyword';

        // Namespace fields: req.*, resp.*, row.*, preset
        if (stream.match(/\b(req|resp|row)\.[a-zA-Z0-9_]+(?:\[[^\]]*\])?/)) return 'propertyName';
        if (stream.match(/\bpreset\b/i)) return 'propertyName';

        // Dot modifiers and operators
        if (stream.match(/\.(eq|ne|gt|gte|lt|lte|cont|ncont|like|nlike|regex|nregex|sw|nsw|ew|new):/)) return 'operator';
        if (stream.match(/^(==|!=|>=|<=|>|<|~=|!~|:)/)) return 'operator';

        // Punctuation
        if (stream.match(/^[()\[\],]/)) return 'punctuation';

        stream.next();
        return null;
    },
});

// -----------------------------------------------------------------------------
// 2. Map Category to CodeMirror Autocomplete Icon Type
// -----------------------------------------------------------------------------
function mapCategoryToType(category: string): string {
    switch (category) {
        case 'Field':
            return 'property';
        case 'Operator':
            return 'keyword';
        case 'Value':
            return 'constant';
        case 'Header':
            return 'class';
        case 'Keyword':
            return 'keyword';
        case 'Recent':
            return 'text';
        case 'Root':
        default:
            return 'variable';
    }
}

// -----------------------------------------------------------------------------
// 2B. Completion Sections (Groupings)
// -----------------------------------------------------------------------------
function renderSectionHeader(title: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'httpql-section-header';
    li.textContent = title;
    return li;
}

const sectionDefinitions: Record<string, CompletionSection> = {
    'Recent Searches': {
        name: 'Recent Searches',
        rank: 1,
        header: (s) => renderSectionHeader(s.name),
    },
    'Presets': {
        name: 'Presets',
        rank: 2,
        header: (s) => renderSectionHeader(s.name),
    },
    'Namespaces': {
        name: 'Namespaces',
        rank: 3,
        header: (s) => renderSectionHeader(s.name),
    },
    'Fields': {
        name: 'Fields',
        rank: 1,
        header: (s) => renderSectionHeader(s.name),
    },
    'Operators': {
        name: 'Operators',
        rank: 1,
        header: (s) => renderSectionHeader(s.name),
    },
    'Values': {
        name: 'Values',
        rank: 1,
        header: (s) => renderSectionHeader(s.name),
    },
    'Keywords': {
        name: 'Keywords',
        rank: 4,
        header: (s) => renderSectionHeader(s.name),
    },
};

// -----------------------------------------------------------------------------
// 3. Side Documentation Flyout DOM Generator
// -----------------------------------------------------------------------------
function createDocFlyout(
    label: string,
    description: string,
    category: string,
    replacement: string
): HTMLElement {
    const root = document.createElement('div');
    root.className = 'httpql-cm-doc-panel flex flex-col gap-1.5 p-2 text-xs max-w-xs leading-normal';

    // Top row: Token name + Category badge
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-2 border-b border-border/40 pb-1';

    const title = document.createElement('span');
    title.className = 'font-mono font-semibold text-primary text-[11.5px]';
    title.textContent = label;

    const badge = document.createElement('span');
    badge.className = 'text-[9.5px] px-1 py-0.2 rounded bg-muted text-muted-foreground uppercase tracking-wider font-mono';
    badge.textContent = category;

    header.appendChild(title);
    header.appendChild(badge);
    root.appendChild(header);

    // Description text
    if (description) {
        const desc = document.createElement('div');
        desc.className = 'text-muted-foreground text-[11px]';
        desc.textContent = description;
        root.appendChild(desc);
    }

    // Lookup corresponding HTTPQL field definition for extra context
    const cleanField = label.replace(/\[.*?\]/, '').trim();
    const fieldDef = HTTPQL_FIELDS.find(
        (f: HttpqlFieldDef) => f.name.toLowerCase() === cleanField.toLowerCase() || f.name.toLowerCase() === replacement.replace(/[:.].*$/, '').toLowerCase()
    );

    if (fieldDef) {
        // Type info
        const typeRow = document.createElement('div');
        typeRow.className = 'flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80';
        typeRow.innerHTML = `<span class="font-medium text-foreground">Type:</span> <span class="font-mono text-primary/90">${fieldDef.type}</span>`;
        root.appendChild(typeRow);

        // Allowed operators
        if (fieldDef.allowedOperators && fieldDef.allowedOperators.length > 0) {
            const opsRow = document.createElement('div');
            opsRow.className = 'flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground/80 pt-0.5';
            const opsList = fieldDef.allowedOperators.map((o: string) => o.replace(/:$/, '')).slice(0, 6).join(', ');
            opsRow.innerHTML = `<span class="font-medium text-foreground">Ops:</span> <span class="font-mono">${opsList}</span>`;
            root.appendChild(opsRow);
        }

        // Example query
        if (fieldDef.example) {
            const exRow = document.createElement('div');
            exRow.className = 'pt-1 border-t border-border/30 text-[10.5px] font-mono text-muted-foreground break-all';
            exRow.innerHTML = `<span class="text-emerald-500/90 dark:text-emerald-400/90">${fieldDef.example}</span>`;
            root.appendChild(exRow);
        }
    }

    return root;
}

// -----------------------------------------------------------------------------
// 4. CodeMirror Editor Component
// -----------------------------------------------------------------------------
export const HttpqlCodeEditor = forwardRef<HttpqlCodeEditorRef, HttpqlCodeEditorProps>(({
    value,
    onChange,
    onSubmit,
    placeholder: placeholderText = 'Query traffic with HTTPQL (e.g. resp.code:200, resp.len.gt:500)...',
    dynamicPresets,
    recentSearches,
    className = '',
}, ref) => {
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSubmitRef = useRef(onSubmit);
    const dynamicPresetsRef = useRef(dynamicPresets);
    const recentSearchesRef = useRef(recentSearches);

    useImperativeHandle(ref, () => ({
        focus: () => {
            viewRef.current?.focus();
        },
    }), []);

    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    dynamicPresetsRef.current = dynamicPresets;
    recentSearchesRef.current = recentSearches;

    const { theme } = useTheme();
    const isDark =
        theme === 'dark' ||
        (theme === 'system' &&
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);

    useEffect(() => {
        if (!editorContainerRef.current) return;

        // Custom completion source hooked to existing getHttpqlSuggestions engine
        const completionSource = (context: CompletionContext): CompletionResult | null => {
            const doc = context.state.sliceDoc();
            const pos = context.pos;

            const res = getHttpqlSuggestions(doc, pos, dynamicPresetsRef.current, recentSearchesRef.current);
            if (!res || !res.suggestions || res.suggestions.length === 0) {
                return null;
            }

            return {
                from: res.startPos,
                to: res.endPos,
                options: res.suggestions.map((s) => ({
                    label: s.displayText || s.text,
                    displayLabel: s.displayText || s.text,
                    type: mapCategoryToType(s.category),
                    detail: s.category,
                    section: sectionDefinitions[s.section] || {
                        name: s.section,
                        rank: 10,
                        header: () => renderSectionHeader(s.section),
                    },
                    info: () => createDocFlyout(s.displayText || s.text, s.description, s.category, s.replacement),
                    apply: (view: EditorView, _completion: any, from: number, to: number) => {
                        view.dispatch({
                            changes: { from, to, insert: s.replacement },
                            selection: { anchor: from + s.replacement.length },
                        });
                        // Automatically pop up the next layer if the suggestion expects it
                        if (s.hasMoreLayers) {
                            setTimeout(() => {
                                startCompletion(view);
                            }, 50);
                        }
                    },
                })),
                filter: false, // getHttpqlSuggestions already pre-filters accurately
            };
        };

        // Single-line styling theme
        const singleLineTheme = EditorView.theme({
            '&': {
                height: '32px',
                maxHeight: '32px',
                backgroundColor: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
                borderRadius: 'calc(var(--radius) - 2px)',
                border: '1px solid hsl(var(--border) / 0.8)',
                fontSize: '12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                outline: 'none',
                position: 'relative',
                width: '100%',
                boxSizing: 'border-box',
            },
            '&.cm-focused': {
                outline: 'none',
                borderColor: 'hsl(var(--primary))',
                boxShadow: '0 0 0 1px hsl(var(--primary))',
            },
            '.cm-scroller': {
                overflowX: 'auto !important',
                overflowY: 'hidden !important',
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                width: '100%',
                padding: '5px 4rem 5px 5.85rem', // Leaves room for HTTPQL badge on left, status & clear on right
                boxSizing: 'border-box',
            },
            '.cm-content': {
                padding: '0 !important',
                whiteSpace: 'nowrap !important',
                overflow: 'visible',
                caretColor: 'hsl(var(--primary))',
            },
            '.cm-line': {
                padding: '0 !important',
                lineHeight: '18px',
                height: '18px',
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: 'hsl(var(--primary)) !important',
                borderLeftWidth: '1.5px !important',
                height: '16px !important',
            },
            '.cm-placeholder': {
                color: 'hsl(var(--muted-foreground) / 0.6)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontStyle: 'normal',
                lineHeight: '18px',
                pointerEvents: 'none',
            },
            // Autocomplete dropdown container
            '.cm-tooltip-autocomplete': {
                backgroundColor: 'hsl(var(--popover)) !important',
                border: '1px solid hsl(var(--border)) !important',
                borderRadius: 'calc(var(--radius) - 2px) !important',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3) !important',
                backdropFilter: 'blur(8px)',
                fontSize: '11.5px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                color: 'hsl(var(--popover-foreground))',
                zIndex: '100',
            },
            '.cm-tooltip-autocomplete ul': {
                maxHeight: '260px',
                padding: '2px',
            },
            '.cm-tooltip-autocomplete ul li': {
                padding: '4px 8px !important',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
            },
            '.cm-tooltip-autocomplete ul li[aria-selected]': {
                backgroundColor: 'hsl(var(--primary)) !important',
                color: 'hsl(var(--primary-foreground)) !important',
            },
            // Section header styling
            '.cm-tooltip-autocomplete .httpql-section-header': {
                padding: '5px 8px 2px 8px !important',
                fontSize: '9px',
                fontWeight: '700',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: 'hsl(var(--muted-foreground) / 0.75)',
                backgroundColor: 'transparent !important',
                cursor: 'default',
                pointerEvents: 'none',
                userSelect: 'none',
                display: 'list-item',
                listStyle: 'none',
                borderTop: '1px solid hsl(var(--border) / 0.35)',
                marginTop: '3px',
            },
            '.cm-tooltip-autocomplete .httpql-section-header:first-child': {
                borderTop: 'none',
                marginTop: '0',
                paddingTop: '3px !important',
            },
            '.cm-completionDetail': {
                opacity: '0.7',
                fontSize: '10px',
                marginLeft: 'auto',
                paddingLeft: '12px',
                fontStyle: 'normal',
            },
            // Side documentation panel
            '.cm-tooltip.cm-completionInfo': {
                backgroundColor: 'hsl(var(--popover)) !important',
                border: '1px solid hsl(var(--border)) !important',
                borderRadius: 'calc(var(--radius) - 2px) !important',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3) !important',
                color: 'hsl(var(--popover-foreground))',
                zIndex: '101',
            },
        });

        // Single-line transaction filter: prevent multi-line breaks
        const singleLineFilter = EditorState.transactionFilter.of((tr) => {
            if (tr.newDoc.lines > 1) {
                const flattened = tr.newDoc.toString().replace(/[\r\n]+/g, ' ');
                return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: flattened } }];
            }
            return tr;
        });

        // Custom keymap: Enter applies/submits, Esc closes or blurs
        const customKeymap = Prec.highest(
            keymap.of([
                {
                    key: 'Enter',
                    run: (view) => {
                        if (completionStatus(view.state) === 'active') {
                            return acceptCompletion(view);
                        }
                        onSubmitRef.current?.(view.state.doc.toString());
                        return true;
                    },
                },
                {
                    key: 'Escape',
                    run: (view) => {
                        if (completionStatus(view.state) === 'active') {
                            return closeCompletion(view);
                        }
                        view.contentDOM.blur();
                        return true;
                    },
                },
                {
                    key: 'Tab',
                    run: (view) => {
                        if (completionStatus(view.state) === 'active') {
                            return acceptCompletion(view);
                        }
                        return false;
                    },
                },
            ])
        );

        // Update listener for sync with React state
        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const newText = update.state.doc.toString();
                onChangeRef.current?.(newText);
            }
        });

        // Open completion on focus if empty or typing
        const focusHandler = EditorView.domEventHandlers({
            focus: (_event, view) => {
                startCompletion(view);
            },
        });

        const extensions: Extension[] = [
            singleLineTheme,
            singleLineFilter,
            customKeymap,
            updateListener,
            focusHandler,
            httpqlLanguage,
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            placeholder(placeholderText),
            autocompletion({
                override: [completionSource],
                defaultKeymap: true,
                icons: true,
                activateOnTyping: true,
            }),
            ...(isDark ? [oneDark] : []),
        ];

        const state = EditorState.create({
            doc: value,
            extensions,
        });

        const view = new EditorView({
            state,
            parent: editorContainerRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, [isDark]);

    // Synchronize parent value changes (e.g. from preset clicks or clear button) into CodeMirror
    useEffect(() => {
        if (!viewRef.current) return;
        const currentDoc = viewRef.current.state.doc.toString();
        if (value !== currentDoc) {
            viewRef.current.dispatch({
                changes: { from: 0, to: currentDoc.length, insert: value },
            });
        }
    }, [value]);

    return (
        <div
            ref={editorContainerRef}
            className={`httpql-codemirror-wrapper w-full relative ${className}`}
        />
    );
});

HttpqlCodeEditor.displayName = 'HttpqlCodeEditor';

export default HttpqlCodeEditor;
