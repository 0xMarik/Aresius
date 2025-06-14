import { useRef, useEffect, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { invoke } from "@tauri-apps/api/core";

const SimpleHTTPEditor = () => {
    const editorRef = useRef(null);
    const viewRef = useRef<EditorView | null>(null); // save EditorView instance

    const [content, setContent] = useState('');

    const send_data = () => {
        invoke("send_data", { content })
            .then(() => console.log("Data sent"))
            .catch(err => console.error("Error sending data:", err));
    };

    useEffect(() => {
        if (editorRef.current) {
            const state = EditorState.create({
                doc: `GET /api/users HTTP/1.1
Host: api.example.com
Authorization: Bearer abc123
Content-Type: application/json

`,
                extensions: [
                    basicSetup,
                    json(),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) {
                            // When doc changes, update the content state
                            const docText = update.state.doc.toString();
                            setContent(docText);
                        }
                    })
                ]
            });

            const view = new EditorView({
                state,
                parent: editorRef.current
            });

            viewRef.current = view;

            // Set initial content state
            setContent(state.doc.toString());

            return () => view.destroy();
        }
    }, []);

    return (
        <div className="p-4">
            <h3 className="mb-2 font-bold">HTTP Request Editor</h3>
            <div ref={editorRef} className="border border-gray-300 rounded" />
            <div className="mt-4">
                <h4>Current Content:</h4>
                <pre>{content}</pre>
            </div>
            <button onClick={() => { send_data() }}>send to backend</button>
        </div>
    );
};

export default SimpleHTTPEditor;
