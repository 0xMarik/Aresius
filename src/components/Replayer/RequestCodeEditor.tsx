import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { setReaplayerContent, selectReplayerState } from "@/store/slices/replayerSlice";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { EditorState } from '@codemirror/state';
import { http } from "../http-parser.component";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "@/components/theme-provider";
import CoreContextMenu from "../ContextMenu/CoreContextMenu";
import RequestContextMenu from "./RequestContextMenu";

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

const RequestCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const projectId = useProjectId();
    const { collections, selectedCollectionIndex } = useAppSelector(selectReplayerState(projectId));
    const collection = collections[selectedCollectionIndex];
    const selectedSessionIndex = collection?.selectedSessionIndex ?? null;
    const session = selectedSessionIndex !== null && collection
        ? collection.sessions[selectedSessionIndex]
        : null;
    const requestTmp = session?.requestTmp ?? "";
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current || !projectId) return;
        if (selectedSessionIndex === null) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.sliceString(0, update.state.doc.length, state.lineBreak);
                dispatch(setReaplayerContent({ rawRequest: code, projectId }));
            }
        });

        const state = EditorState.create({
            doc: requestTmp,
            extensions: [
                EditorState.lineSeparator.of("\r\n"),
                basicSetup,
                http(),
                ...(isDark ? [oneDark] : []),
                fullHeightTheme,
                updateListener,
                EditorView.lineWrapping,
            ],
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
    }, [selectedHistoryIndex, selectedCollectionIndex, selectedSessionIndex, isDark, projectId]);

    return (
        <div className="bg-card w-full h-full">
            <CoreContextMenu renderContextMenu={() => <RequestContextMenu viewRef={viewRef} />}>
                <div ref={editorRef} className="h-full w-full">
                </div>
            </CoreContextMenu>
        </div>
    );
};

export default RequestCodeEditor;