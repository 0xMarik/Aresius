import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { EditorState } from '@codemirror/state';
import { http } from "./http-parser.component";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from '@codemirror/lang-javascript';
import { Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";



const fullHeightTheme = EditorView.theme({
    '&': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    '.cm-scroller': {
        flex: 1,
        overflow: 'auto',
        // paddingBottom: '100px', // Add extra space at the bottom
    },
});

interface RequestEditorProps {
    rawRequest: string;
    activeSessionIndex: number;
}

const RequestEditor: React.FC<RequestEditorProps> = ({ rawRequest, activeSessionIndex }) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (!editorRef.current) return;

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                console.log('Code changed:', code);
                // TODO: Emit or use the code
            }
        });

        //         const initialContent = `GET / HTTP/1.1
        // Host: google.com
        // User-Agent: Rust-TCP-Client/1.0
        // Accept: */*
        // Connection: close

        // `;

        const state = EditorState.create({
            doc: rawRequest,
            extensions: [
                basicSetup,
                http(),
                javascript(),
                // oneDark,
                fullHeightTheme,
                updateListener,
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
        };
    }, []);

    return (
        <>
            <div className="h-full flex flex-col gap-1 ">
                <div className="flex items-center h-12 border rounded ">
                    <Badge variant="secondary" className="text-xs">
                        Session {activeSessionIndex + 1}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        HTTP
                    </Badge>
                    <Button className="h-[2rem]">
                        Clear Fuzzes
                    </Button>
                    <Button
                        size="icon"
                        className="size-8"
                        title="Select a {{FUZZ_X}} placeholder to remove"
                    >
                        <Minus />
                    </Button>
                    <Button
                        size="icon"
                        className="size-8"
                        title="Select text to add as fuzz parameter"
                    //    onClick={handleAddParameter}
                    >
                        <Plus />
                    </Button>
                </div>
                <div
                    ref={editorRef}
                    className="h-full max-h-full border rounded overflow-auto" />
            </div>
        </>
    );
};

export default RequestEditor;