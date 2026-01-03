import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { basicSetup, EditorView } from "codemirror";
import './replayer.style.css'
import { EditorState, } from '@codemirror/state';
import { useEffect, useRef } from 'react'
import { http } from '@/components/http-parser.component';
import { oneDark } from '@codemirror/theme-one-dark';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { addReplayerHistory, setReaplayerContent, setReaplayerURL } from '@/store/slices/replayerSlice';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { invoke } from '@tauri-apps/api/core';
import { ReplayerHistoryItem } from '@/types/replayer.type';
import React from 'react';

// type TaskResult = {
//     id: string;
//     message: string;
// };

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
    // const [content, setContent] = useState<string>("");
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { requestTmp } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;

        // Clean up existing editor
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                // Update Redux state with new content
                // setContent(code);
                console.log({ code })
                dispatch(setReaplayerContent({ rawRequest: code }));
            }
        });

        const state = EditorState.create({
            doc: requestTmp,
            extensions: [
                basicSetup,
                http(),
                // javascript(),
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

        // Initialize global state after editor creation
        // globalRanges = [...currentFuzzerSession.payload.parameters];
        // selectedRangeId = currentFuzzerSession.selectedHighlightId;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, []);

    return (
        <div ref={editorRef} className="h-full w-full border rounded-lg">
        </div>
    )
}

const ResponseCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // const [content, setContent] = useState<string>("");
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { history } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    // const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;

        // Clean up existing editor
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        // const updateListener = EditorView.updateListener.of((update) => {
        //     if (update.docChanged) {
        //         const code = update.state.doc.toString();
        //         // Update Redux state with new content
        //         // setContent(code);
        //         console.log({ code })
        //         dispatch(setReaplayerContent({ rawRequest: code }));
        //     }
        // });

        const state = EditorState.create({
            doc: history.length > 0 ? history[history.length - 1].responseRaw : "",
            extensions: [
                basicSetup,
                http(),
                // javascript(),
                oneDark,
                fullHeightTheme,
                EditorView.lineWrapping,
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        // Initialize global state after editor creation
        // globalRanges = [...currentFuzzerSession.payload.parameters];
        // selectedRangeId = currentFuzzerSession.selectedHighlightId;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [history]);

    return (
        <div ref={editorRef} className="h-full w-full border rounded-lg">
        </div>
    )
}



function Replayer() {
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { url, requestTmp } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    const [responseLoading, setResponseLoading] = React.useState<boolean>(false);

    const dispatch = useAppDispatch();

    const triggerRequest = async () => {
        console.log("Triggering request with:", { requestTmp, url });
        setResponseLoading(true)
        const response = await invoke<ReplayerHistoryItem>('replay_request', { requestTmp: requestTmp, url: url });
        setResponseLoading(false)
        dispatch(addReplayerHistory({ historyItem: response }));
        // console.log({ response });
    }

    return (
        <ReactSplit
            direction={SplitDirection.Horizontal}
            initialSizes={[25, 75]} // 👈 Initial widths: 40% left, 60% right
            // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
            gutterClassName="custom-gutter-horizontal"
            draggerClassName="custom-dragger-horizontal"
            classes={["py-1", "py-1"]}
        >
            <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                Title Left
            </div>
            <div className='h-full flex flex-col gap-1'>
                <div className=' flex  justify-center items-center h-16 bg-muted/50 aspect-video rounded-lg p-1'>
                    <Input placeholder='Enter URL to replay...' className='w-full h-full bg-transparent border-0 focus:ring-0'
                        value={url}
                        onChange={(event) => dispatch(setReaplayerURL({ url: event.target.value }))}
                    />
                    <Button
                        onClick={triggerRequest}
                        // disabled={isLoading}
                        className="p-4  text-white rounded disabled:bg-gray-400"
                    >
                        RUN
                    </Button>
                </div>
                <ReactSplit
                    gutterClassName="custom-gutter-horizontal"
                    draggerClassName="custom-dragger-horizontal"
                    direction={SplitDirection.Horizontal}>
                    <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                        <RequestCodeEditor />
                    </div>
                    <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                        {responseLoading ? "Response is loading..." : <ResponseCodeEditor />}

                    </div>
                </ReactSplit>
            </div>

        </ReactSplit>
    )
}


export default Replayer