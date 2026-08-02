

import React, { useRef, useEffect, } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
// import { StreamLanguage } from '@codemirror/language';
// import { http } from '@codemirror/legacy-modes/mode/http';
import { oneDark } from '@codemirror/theme-one-dark';
import { http } from './http-parser.component';
import { fullHeightTheme } from './fuzzer/request-editor/request-editor.component';


export const CodeMirrorEditor: React.FC<{ value: string }> = ({ value }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (editorRef.current && !viewRef.current) {
            const state = EditorState.create({
                doc: value,
                extensions: [
                    EditorState.lineSeparator.of("\r\n"),
                    basicSetup,
                    EditorView.lineWrapping,
                    fullHeightTheme,
                    http(),
                    oneDark,
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true),
                ],
            });

            viewRef.current = new EditorView({
                state,
                parent: editorRef.current,
            });
        }

        return () => {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (viewRef.current) {
            const currentValue = viewRef.current.state.doc.sliceString(0, viewRef.current.state.doc.length, viewRef.current.state.lineBreak)
            // linebreak add \r\n into consideration
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

    return <div ref={editorRef} className="h-full overflow-auto" />;
};
