import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { useTheme } from '@/components/theme-provider';
import { useReplayerEditor } from '@/context/ReplayerContext';
import { getCommonEditorExtensions } from './editorUtils';
import { formatHttpMessagePretty } from '@/pages/sitemap/utils';

const ResponseCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const { activeHistoryItem, selectedSessionId, resViewMode } = useReplayerEditor();
    const responseRaw = activeHistoryItem?.responseRaw ?? '';
    const displayResponse = resViewMode === 'pretty' ? formatHttpMessagePretty(responseRaw) : responseRaw;

    useEffect(() => {
        if (!editorRef.current || !selectedSessionId) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const isPretty = resViewMode === 'pretty';

        const state = EditorState.create({
            doc: displayResponse,
            extensions: getCommonEditorExtensions(isDark, isPretty, [EditorState.readOnly.of(true)]),
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
    }, [displayResponse, selectedSessionId, isDark, resViewMode]);

    return <div ref={editorRef} className="h-full w-full" />;
};

export default ResponseCodeEditor;
