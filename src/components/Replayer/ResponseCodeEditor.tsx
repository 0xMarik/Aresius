import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { useTheme } from '@/components/theme-provider';
import { useReplayerEditor } from '@/context/ReplayerContext';
import { getCommonEditorExtensions } from './editorUtils';

const ResponseCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const { activeHistoryItem, selectedSessionId } = useReplayerEditor();
    const responseRaw = activeHistoryItem?.responseRaw ?? '';

    useEffect(() => {
        if (!editorRef.current || !selectedSessionId) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const state = EditorState.create({
            doc: responseRaw,
            extensions: getCommonEditorExtensions(isDark, [EditorState.readOnly.of(true)]),
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [responseRaw, selectedSessionId, isDark]);

    return <div ref={editorRef} className="h-full w-full" />;
};

export default ResponseCodeEditor;
