import { useEffect, useRef } from 'react';
import { EditorState, Annotation } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { useTheme } from '@/components/theme-provider';
import { useReplayerEditor } from '@/context/ReplayerContext';
import CoreContextMenu from '../ContextMenu/CoreContextMenu';
import RequestContextMenu from './RequestContextMenu';
import { getCommonEditorExtensions } from './editorUtils';
import { formatHttpMessagePretty } from '@/pages/sitemap/utils';

const externalUpdateAnnotation = Annotation.define<boolean>();

const RequestCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const { activeDraft, updateDraftContent, selectedHistoryIndex, reqViewMode } = useReplayerEditor();
    const sessionId = activeDraft?.sessionId;
    const requestTmp = activeDraft?.requestTmp ?? '';

    const updateDraftContentRef = useRef(updateDraftContent);
    useEffect(() => {
        updateDraftContentRef.current = updateDraftContent;
    }, [updateDraftContent]);

    const initialDoc = reqViewMode === 'pretty' ? formatHttpMessagePretty(requestTmp) : requestTmp;

    useEffect(() => {
        if (!editorRef.current || !sessionId) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const isExternal = update.transactions.some(tr => tr.annotation(externalUpdateAnnotation));
                if (!isExternal) {
                    const code = update.state.doc.sliceString(0, update.state.doc.length, '\r\n');
                    updateDraftContentRef.current(code);
                }
            }
        });

        const isPretty = reqViewMode === 'pretty';

        const state = EditorState.create({
            doc: initialDoc,
            extensions: getCommonEditorExtensions(isDark, isPretty, [
                updateListener,
            ]),
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
    }, [sessionId, selectedHistoryIndex, isDark, reqViewMode]);

    useEffect(() => {
        if (!viewRef.current || activeDraft?.requestTmp === undefined) return;
        const view = viewRef.current;
        const currentDoc = view.state.doc.sliceString(0, view.state.doc.length, '\r\n');
        const targetDoc = reqViewMode === 'pretty' ? formatHttpMessagePretty(activeDraft.requestTmp) : activeDraft.requestTmp;

        if (currentDoc !== targetDoc) {
            const currentSelection = view.state.selection;
            const newLen = targetDoc.length;
            const safeAnchor = Math.min(currentSelection.main.anchor, newLen);
            const safeHead = Math.min(currentSelection.main.head, newLen);

            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: targetDoc },
                selection: { anchor: safeAnchor, head: safeHead },
                annotations: externalUpdateAnnotation.of(true),
            });
        }
    }, [activeDraft?.requestTmp, reqViewMode]);

    return (
        <div className="bg-card w-full h-full">
            <CoreContextMenu renderContextMenu={() => <RequestContextMenu viewRef={viewRef} />}>
                <div ref={editorRef} className="h-full w-full" />
            </CoreContextMenu>
        </div>
    );
};

export default RequestCodeEditor;