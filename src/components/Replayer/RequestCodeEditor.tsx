import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { setReaplayerContent } from "@/store/slices/replayerSlice";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { EditorState, } from '@codemirror/state';
import { http } from "../http-parser.component";
import { oneDark } from "@codemirror/theme-one-dark";
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
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { selectedSessionIndex } = collections[selectedCollectionIndex];
    const session = selectedSessionIndex !== null
        ? collections[selectedCollectionIndex].sessions[selectedSessionIndex]
        : null;
    const requestTmp = session?.requestTmp ?? "";
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;
        if (selectedSessionIndex === null) return; // nothing to edit yet

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                // line break to specify \r\n that are in the origin request
                const code = update.state.doc.sliceString(0, update.state.doc.length, state.lineBreak)
                dispatch(setReaplayerContent({ rawRequest: code }));
            }
        });

        const state = EditorState.create({
            doc: requestTmp,
            extensions: [
                EditorState.lineSeparator.of("\r\n"),
                basicSetup,
                http(),
                oneDark,
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
    }, [selectedHistoryIndex, selectedCollectionIndex, selectedSessionIndex]);


    return (
        <div className="bg-background w-full h-full">
            <CoreContextMenu renderContextMenu={() => <RequestContextMenu viewRef={viewRef} />}>
                <div ref={editorRef} className="h-full w-full ">
                </div>
            </CoreContextMenu>
        </div>
    )
}

export default RequestCodeEditor;