import { useRef, useEffect, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// Type definitions
interface AsyncResponse {
    request_id: string;
}

interface RequestCompletedPayload {
    request_id: string;
    result?: string;
    error?: string;
}

const SimpleHTTPEditor: React.FC = () => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [content, setContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [result, setResult] = useState<string>('');
    const [requestId, setRequestId] = useState<string | null>(null);
    
    // Store active requests to handle multiple concurrent requests
    const activeRequestsRef = useRef<Set<string>>(new Set());

    // Set up the event listener once when component mounts
    useEffect(() => {
        let unlisten: UnlistenFn | null = null;

        const setupListener = async () => {
            unlisten = await listen<RequestCompletedPayload>('request-completed', (event) => {
                const { request_id, result: requestResult, error } = event.payload;
                
                console.log('Received event for request ID:', request_id);
                console.log('Event payload:', event.payload);

                // Check if this is an active request we're waiting for
                if (activeRequestsRef.current.has(request_id)) {
                    console.log('Processing response for request:', request_id);
                    
                    setIsLoading(false);
                    if (error) {
                        setResult(`Error: ${error}`);
                    } else {
                        setResult(`Success: ${requestResult || 'No result'}`);
                    }
                    setRequestId(null);
                    activeRequestsRef.current.delete(request_id);
                } else {
                    console.log('Ignoring event for unknown request ID:', request_id);
                }
            });
        };

        setupListener();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []); // Empty dependency array - listener is set up only once

    const send_data = async (): Promise<void> => {
        try {
            setIsLoading(true);
            setResult('');

            console.log('Sending request with content:', content);

            // This will return immediately with a request ID
            const response = await invoke<AsyncResponse>("send_data_async", { content });
            
            console.log('Received request ID:', response.request_id);
            
            setRequestId(response.request_id);
            activeRequestsRef.current.add(response.request_id);

        } catch (error) {
            console.error('Error sending request:', error);
            setIsLoading(false);
            setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const cancel_request = async (): Promise<void> => {
        if (requestId) {
            try {
                await invoke<string>("cancel_request", { requestId });
                setIsLoading(false);
                setResult('Request cancelled');
                activeRequestsRef.current.delete(requestId);
                setRequestId(null);
            } catch (error) {
                console.error('Failed to cancel request:', error);
                // Still clean up the UI state even if cancel failed
                setIsLoading(false);
                setResult('Cancel request failed, but cleaning up UI');
                activeRequestsRef.current.delete(requestId!);
                setRequestId(null);
            }
        }
    };

    useEffect(() => {
        if (editorRef.current) {
            const initialContent = `GET / HTTP/1.1
Host: google.com
User-Agent: Rust-TCP-Client/1.0
Accept: */*
Connection: close

`;

            const state = EditorState.create({
                doc: initialContent,
                extensions: [
                    basicSetup,
                    json(),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
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
            setContent(initialContent);

            return () => view.destroy();
        }
    }, []);

    return (
        <div className="p-4">
            <h3 className="mb-2 font-bold">HTTP Request Editor</h3>
            <div ref={editorRef} className="border border-gray-300 rounded mb-4" />

            <div className="flex gap-2 mb-4">
                <button
                    onClick={send_data}
                    disabled={isLoading}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
                >
                    {isLoading ? 'Processing...' : 'Send to Backend'}
                </button>

                {isLoading && (
                    <button
                        onClick={cancel_request}
                        className="px-4 py-2 bg-red-500 text-white rounded"
                    >
                        Cancel
                    </button>
                )}
            </div>

            {isLoading && (
                <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 rounded">
                    <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-2"></div>
                        Request in progress... (Request ID: {requestId})
                    </div>
                </div>
            )}

            {result && (
                <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded">
                    <h4 className="font-semibold mb-2">Result:</h4>
                    <pre className="whitespace-pre-wrap text-sm">{result}</pre>
                </div>
            )}

            {/* Debug info - remove in production */}
            <div className="mt-4 p-2 bg-gray-50 border rounded text-xs">
                <div>Active Requests: {Array.from(activeRequestsRef.current).join(', ') || 'None'}</div>
                <div>Current Request ID: {requestId || 'None'}</div>
                <div>Is Loading: {isLoading.toString()}</div>
            </div>
        </div>
    );
};

export default SimpleHTTPEditor;