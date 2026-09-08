import React, { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "@/components/theme-provider";
import { getCodeMirrorScrollTheme } from "@/components/codemirror-scroll.theme";

interface PayloadCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    height?: string;
    readOnly?: boolean;
}

const createEditorTheme = (isDark: boolean) => [
    EditorView.theme({
        "&": {
            height: "100%",
            display: "flex",
            flexDirection: "column",
            fontSize: "12px",
            backgroundColor: "transparent !important",
        },
        "&.cm-focused": {
            outline: "none !important",
        },
        ".cm-gutters": {
            display: "none !important",
        },
        ".cm-scroller": {
            flex: 1,
            overflow: "auto !important",
            fontFamily: "var(--font-mono, monospace)",
            backgroundColor: "transparent !important",
        },
        ".cm-content": {
            minHeight: "100%",
            padding: "6px 10px",
        },
    }),
    getCodeMirrorScrollTheme(isDark),
];

export const PayloadCodeEditor: React.FC<PayloadCodeEditorProps> = ({
    value,
    onChange,
    height = "200px",
    readOnly = false,
}) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { theme } = useTheme();
    const isDark =
        theme === "dark" ||
        (theme === "system" &&
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (!editorRef.current) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged && !readOnly) {
                const text = update.state.doc.toString();
                if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = setTimeout(() => {
                    onChangeRef.current(text);
                }, 300);
            }
        });

        const state = EditorState.create({
            doc: value,
            extensions: [
                basicSetup,
                ...(isDark ? [oneDark] : []),
                ...createEditorTheme(isDark),
                ...(readOnly ? [EditorState.readOnly.of(true)] : [updateListener]),
                EditorView.lineWrapping,
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
    }, [isDark, readOnly]);

    // Update doc if external value changes (e.g. file upload or selecting a different payload)
    useEffect(() => {
        if (viewRef.current) {
            const currentText = viewRef.current.state.doc.toString();
            if (currentText !== value) {
                viewRef.current.dispatch({
                    changes: { from: 0, to: currentText.length, insert: value },
                });
            }
        }
    }, [value]);

    return (
        <div
            className="w-full rounded-md border border-input bg-card overflow-hidden shadow-sm flex flex-col"
            style={{ height }}
        >
            <div ref={editorRef} className="h-full w-full bg-card" />
        </div>
    );
};
