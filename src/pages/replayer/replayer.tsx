import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { basicSetup, EditorView } from "codemirror";
import './replayer.style.css'
import { EditorState, } from '@codemirror/state';
import { useEffect, useRef } from 'react'
import { http } from '@/components/http-parser.component';
import { oneDark } from '@codemirror/theme-one-dark';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { setReaplayerContent } from '@/store/slices/replayerSlice';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { invoke } from '@tauri-apps/api/core';

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
                // fuzzerHighlighter,
                // readOnlyTransactionFilter,
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



function Replayer() {
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { url, requestTmp } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];

    const triggerRequest = () => {
        const response = invoke('replay_request', { requestTmp: requestTmp, url: url });
        console.log({ response });
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
                        Request response
                    </div>
                </ReactSplit>
            </div>

        </ReactSplit>
    )
}


export default Replayer