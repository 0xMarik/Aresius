

import React, { useRef, useEffect } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { http } from './http-parser.component';
import { getCodeMirrorScrollTheme } from './codemirror-scroll.theme';
import { useTheme } from './theme-provider';

const fullHeightTheme = EditorView.theme({
    '&': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    '.cm-scroller': {
        flex: 1,
        overflow: 'auto',
    },
});

export const CodeMirrorEditor: React.FC<{ value: string }> = ({ value }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    useEffect(() => {
        if (!editorRef.current) return;
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const state = EditorState.create({
            doc: value,
            extensions: [
                basicSetup,
                EditorView.lineWrapping,
                fullHeightTheme,
                getCodeMirrorScrollTheme(isDark),
                http(),
                ...(isDark ? [oneDark] : []),
                EditorState.readOnly.of(true),
            ],
        });

        viewRef.current = new EditorView({
            state,
            parent: editorRef.current,
        });

        return () => {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
    }, [isDark]);

    useEffect(() => {
        if (viewRef.current) {
            const currentValue = viewRef.current.state.doc.toString();
            if (currentValue !== value) {
                viewRef.current.dispatch({
                    changes: {
                        from: 0,
                        to: currentValue.length,
                        insert: value,
                    },
                });
            }
        }
    }, [value]);

    return <div ref={editorRef} className="h-full w-full" />;
};
