// import { useRef, useEffect, useState } from 'react';
// import { EditorView, basicSetup } from 'codemirror';
// import { EditorState } from '@codemirror/state';
// import { json } from '@codemirror/lang-json';
// import { invoke } from "@tauri-apps/api/core";
// import { listen, UnlistenFn } from "@tauri-apps/api/event";

// // Type definitions
// interface AsyncResponse {
//     request_id: string;
// }

// interface RequestCompletedPayload {
//     request_id: string;
//     result?: string;
//     error?: string;
// }

// const SimpleHTTPEditor: React.FC = () => {
//     const editorRef = useRef<HTMLDivElement>(null);
//     const viewRef = useRef<EditorView | null>(null);
//     const [content, setContent] = useState<string>('');
//     const [isLoading, setIsLoading] = useState<boolean>(false);
//     const [result, setResult] = useState<string>('');
//     const [requestId, setRequestId] = useState<string | null>(null);

//     // Store active requests to handle multiple concurrent requests
//     const activeRequestsRef = useRef<Set<string>>(new Set());

//     // Set up the event listener once when component mounts
//     useEffect(() => {
//         let unlisten: UnlistenFn | null = null;

//         const setupListener = async () => {
//             unlisten = await listen<RequestCompletedPayload>('request-completed', (event) => {
//                 const { request_id, result: requestResult, error } = event.payload;

//                 console.log('Received event for request ID:', request_id);
//                 console.log('Event payload:', event.payload);

//                 // Check if this is an active request we're waiting for
//                 if (activeRequestsRef.current.has(request_id)) {
//                     console.log('Processing response for request:', request_id);

//                     setIsLoading(false);
//                     if (error) {
//                         setResult(`Error: ${error}`);
//                     } else {
//                         setResult(`Success: ${requestResult || 'No result'}`);
//                     }
//                     setRequestId(null);
//                     activeRequestsRef.current.delete(request_id);
//                 } else {
//                     console.log('Ignoring event for unknown request ID:', request_id);
//                 }
//             });
//         };

//         setupListener();

//         return () => {
//             if (unlisten) {
//                 unlisten();
//             }
//         };
//     }, []); // Empty dependency array - listener is set up only once

//     const send_data = async (): Promise<void> => {
//         try {
//             setIsLoading(true);
//             setResult('');

//             console.log('Sending request with content:', content);

//             // This will return immediately with a request ID
//             const response = await invoke<AsyncResponse>("send_data_async", { content });

//             console.log('Received request ID:', response.request_id);

//             setRequestId(response.request_id);
//             activeRequestsRef.current.add(response.request_id);

//         } catch (error) {
//             console.error('Error sending request:', error);
//             setIsLoading(false);
//             setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
//         }
//     };

//     const cancel_request = async (): Promise<void> => {
//         if (requestId) {
//             try {
//                 await invoke<string>("cancel_request", { requestId });
//                 setIsLoading(false);
//                 setResult('Request cancelled');
//                 activeRequestsRef.current.delete(requestId);
//                 setRequestId(null);
//             } catch (error) {
//                 console.error('Failed to cancel request:', error);
//                 // Still clean up the UI state even if cancel failed
//                 setIsLoading(false);
//                 setResult('Cancel request failed, but cleaning up UI');
//                 activeRequestsRef.current.delete(requestId!);
//                 setRequestId(null);
//             }
//         }
//     };

//     useEffect(() => {
//         if (editorRef.current) {
//             const initialContent = `GET / HTTP/1.1
// Host: google.com
// User-Agent: Rust-TCP-Client/1.0
// Accept: */*
// Connection: close

// `;

//             const state = EditorState.create({
//                 doc: initialContent,
//                 extensions: [
//                     basicSetup,
//                     json(),
//                     EditorView.updateListener.of((update) => {
//                         if (update.docChanged) {
//                             const docText = update.state.doc.toString();
//                             setContent(docText);
//                         }
//                     })
//                 ]
//             });

//             const view = new EditorView({
//                 state,
//                 parent: editorRef.current
//             });

//             viewRef.current = view;
//             setContent(initialContent);

//             return () => view.destroy();
//         }
//     }, []);

//     return (
//         <div className="p-4">
//             <h3 className="mb-2 font-bold">HTTP Request Editor</h3>
//             <div ref={editorRef} className="border border-gray-300 rounded mb-4" />

//             <div className="flex gap-2 mb-4">
//                 <button
//                     onClick={send_data}
//                     disabled={isLoading}
//                     className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
//                 >
//                     {isLoading ? 'Processing...' : 'Send to Backend'}
//                 </button>

//                 {isLoading && (
//                     <button
//                         onClick={cancel_request}
//                         className="px-4 py-2 bg-red-500 text-white rounded"
//                     >
//                         Cancel
//                     </button>
//                 )}
//             </div>

//             {isLoading && (
//                 <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 rounded">
//                     <div className="flex items-center">
//                         <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-2"></div>
//                         Request in progress... (Request ID: {requestId})
//                     </div>
//                 </div>
//             )}

//             {result && (
//                 <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded">
//                     <h4 className="font-semibold mb-2">Result:</h4>
//                     <pre className="whitespace-pre-wrap text-sm">{result}</pre>
//                 </div>
//             )}

//             {/* Debug info - remove in production */}
//             <div className="mt-4 p-2 bg-gray-50 border rounded text-xs">
//                 <div>Active Requests: {Array.from(activeRequestsRef.current).join(', ') || 'None'}</div>
//                 <div>Current Request ID: {requestId || 'None'}</div>
//                 <div>Is Loading: {isLoading.toString()}</div>
//             </div>
//         </div>
//     );
// };

// export default SimpleHTTPEditor;

import { useRef, useEffect, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, SelectionRange } from '@codemirror/state';
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

interface FuzzParameter {
    id: string;
    placeholder: string;
    values: string[];
    currentIndex: number;
}

const SimpleHTTPEditor: React.FC = () => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [content, setContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [result, setResult] = useState<string>('');
    const [requestId, setRequestId] = useState<string | null>(null);
    const [selectedText, setSelectedText] = useState<string>('');
    const [showFuzzModal, setShowFuzzModal] = useState<boolean>(false);
    const [fuzzValues, setFuzzValues] = useState<string>('');
    const [fuzzParameters, setFuzzParameters] = useState<FuzzParameter[]>([]);
    const [isFuzzMode, setIsFuzzMode] = useState<boolean>(false);
    const [fuzzResults, setFuzzResults] = useState<string[]>([]);

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

                    const resultText = error ? `Error: ${error}` : `Success: ${requestResult || 'No result'}`;

                    if (isFuzzMode) {
                        setFuzzResults(prev => [...prev, resultText]);
                    } else {
                        setResult(resultText);
                        setIsLoading(false);
                    }

                    activeRequestsRef.current.delete(request_id);

                    // If no more active requests, stop loading
                    if (activeRequestsRef.current.size === 0) {
                        setIsLoading(false);
                        setRequestId(null);
                    }
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
    }, [isFuzzMode]);

    const getSelectedText = (): string => {
        if (!viewRef.current) return '';

        const view = viewRef.current;
        const selection = view.state.selection.main;

        if (selection.empty) return '';

        return view.state.doc.sliceString(selection.from, selection.to);
    };

    const replaceSelectedText = (newText: string): void => {
        if (!viewRef.current) return;

        const view = viewRef.current;
        const selection = view.state.selection.main;

        if (selection.empty) return;

        const transaction = view.state.update({
            changes: {
                from: selection.from,
                to: selection.to,
                insert: newText
            }
        });

        view.dispatch(transaction);
    };

    const handleTextSelection = (): void => {
        const selected = getSelectedText();
        setSelectedText(selected);
    };

    const openFuzzModal = (): void => {
        const selected = getSelectedText();
        if (!selected) {
            alert('Please select text to fuzz');
            return;
        }
        setSelectedText(selected);
        setFuzzValues('');
        setShowFuzzModal(true);
    };

    const addFuzzParameter = (): void => {
        if (!selectedText || !fuzzValues.trim()) return;

        const values = fuzzValues.split('\n').map(v => v.trim()).filter(v => v);
        if (values.length === 0) return;

        const placeholder = `{{FUZZ_${fuzzParameters.length + 1}}}`;
        const newParam: FuzzParameter = {
            id: Date.now().toString(),
            placeholder,
            values,
            currentIndex: 0
        };

        // Replace selected text with placeholder
        replaceSelectedText(placeholder);

        setFuzzParameters(prev => [...prev, newParam]);
        setShowFuzzModal(false);
        setSelectedText('');
        setFuzzValues('');
    };

    const removeFuzzParameter = (id: string): void => {
        const param = fuzzParameters.find(p => p.id === id);
        if (param) {
            // Replace placeholder back with first value
            const currentContent = viewRef.current?.state.doc.toString() || '';
            const newContent = currentContent.replace(param.placeholder, param.values[0]);

            // Update editor content
            if (viewRef.current) {
                const transaction = viewRef.current.state.update({
                    changes: {
                        from: 0,
                        to: viewRef.current.state.doc.length,
                        insert: newContent
                    }
                });
                viewRef.current.dispatch(transaction);
            }
        }

        setFuzzParameters(prev => prev.filter(p => p.id !== id));
    };

    const generateFuzzRequests = (): string[] => {
        if (fuzzParameters.length === 0) return [content];

        const requests: string[] = [];

        // Generate all combinations
        const generateCombinations = (paramIndex: number, currentRequest: string): void => {
            if (paramIndex >= fuzzParameters.length) {
                requests.push(currentRequest);
                return;
            }

            const param = fuzzParameters[paramIndex];
            param.values.forEach(value => {
                const newRequest = currentRequest.replace(param.placeholder, value);
                generateCombinations(paramIndex + 1, newRequest);
            });
        };

        generateCombinations(0, content);
        return requests;
    };

    const send_data = async (): Promise<void> => {
        try {
            setIsLoading(true);
            setResult('');
            setFuzzResults([]);

            const requests = generateFuzzRequests();
            console.log(`Sending ${requests.length} fuzz requests`);

            setIsFuzzMode(requests.length > 1);

            // Send all requests
            for (const request of requests) {
                console.log('Sending request with content:', request);
                const response = await invoke<AsyncResponse>("send_data_async", { content: request });
                console.log('Received request ID:', response.request_id);
                activeRequestsRef.current.add(response.request_id);
            }

            if (requests.length === 1) {
                setRequestId(Array.from(activeRequestsRef.current)[0]);
            }

        } catch (error) {
            console.error('Error sending request:', error);
            setIsLoading(false);
            setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const cancel_request = async (): Promise<void> => {
        try {
            // Cancel all active requests
            for (const reqId of activeRequestsRef.current) {
                await invoke<string>("cancel_request", { requestId: reqId });
            }
            setIsLoading(false);
            setResult('Requests cancelled');
            setFuzzResults([]);
            activeRequestsRef.current.clear();
            setRequestId(null);
            setIsFuzzMode(false);
        } catch (error) {
            console.error('Failed to cancel requests:', error);
            setIsLoading(false);
            setResult('Cancel request failed, but cleaning up UI');
            activeRequestsRef.current.clear();
            setRequestId(null);
            setIsFuzzMode(false);
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
                        if (update.selectionSet) {
                            handleTextSelection();
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
            <h3 className="mb-2 font-bold">HTTP Request Fuzzer Editor</h3>

            <div className="mb-4">
                <button
                    onClick={openFuzzModal}
                    disabled={isLoading}
                    className="px-3 py-1 bg-purple-500 text-white rounded text-sm mr-2 disabled:bg-gray-400"
                >
                    Add Fuzz Parameter
                </button>
                {selectedText && (
                    <span className="text-sm text-gray-600">
                        Selected: "{selectedText}"
                    </span>
                )}
            </div>

            {fuzzParameters.length > 0 && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                    <h4 className="font-semibold mb-2">Fuzz Parameters:</h4>
                    {fuzzParameters.map(param => (
                        <div key={param.id} className="flex items-center justify-between mb-2 p-2 bg-white border rounded">
                            <div className="flex-1">
                                <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                    {param.placeholder}
                                </span>
                                <span className="ml-2 text-sm text-gray-600">
                                    ({param.values.length} values: {param.values.slice(0, 3).join(', ')}
                                    {param.values.length > 3 && '...'})
                                </span>
                            </div>
                            <button
                                onClick={() => removeFuzzParameter(param.id)}
                                className="px-2 py-1 bg-red-500 text-white rounded text-sm"
                                disabled={isLoading}
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                    <div className="text-sm text-gray-600 mt-2">
                        Total requests: {generateFuzzRequests().length}
                    </div>
                </div>
            )}

            <div ref={editorRef} className="border border-gray-300 rounded mb-4" />

            <div className="flex gap-2 mb-4">
                <button
                    onClick={send_data}
                    disabled={isLoading}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
                >
                    {isLoading ? 'Processing...' : 'Send Request(s)'}
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
                        {isFuzzMode ?
                            `Fuzzing in progress... (${fuzzResults.length} completed, ${activeRequestsRef.current.size} pending)` :
                            `Request in progress... (Request ID: ${requestId})`
                        }
                    </div>
                </div>
            )}

            {isFuzzMode && fuzzResults.length > 0 && (
                <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded">
                    <h4 className="font-semibold mb-2">Fuzz Results ({fuzzResults.length}):</h4>
                    <div className="max-h-60 overflow-y-auto">
                        {fuzzResults.map((result, index) => (
                            <div key={index} className="mb-2 p-2 bg-white border rounded">
                                <div className="text-sm font-mono text-gray-600 mb-1">Request {index + 1}:</div>
                                <pre className="whitespace-pre-wrap text-sm">{result}</pre>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isFuzzMode && result && (
                <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded">
                    <h4 className="font-semibold mb-2">Result:</h4>
                    <pre className="whitespace-pre-wrap text-sm">{result}</pre>
                </div>
            )}

            {/* Fuzz Modal */}
            {showFuzzModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg w-96">
                        <h3 className="text-lg font-bold mb-4">Add Fuzz Parameter</h3>
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">
                                Selected Text: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{selectedText}</span>
                            </label>
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">
                                Fuzz Values (one per line):
                            </label>
                            <textarea
                                value={fuzzValues}
                                onChange={(e) => setFuzzValues(e.target.value)}
                                placeholder="value1&#10;value2&#10;value3"
                                className="w-full h-32 p-2 border border-gray-300 rounded"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={addFuzzParameter}
                                className="px-4 py-2 bg-blue-500 text-white rounded"
                            >
                                Add Parameter
                            </button>
                            <button
                                onClick={() => setShowFuzzModal(false)}
                                className="px-4 py-2 bg-gray-500 text-white rounded"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Debug info - remove in production */}
            <div className="mt-4 p-2 bg-gray-50 border rounded text-xs">
                <div>Active Requests: {Array.from(activeRequestsRef.current).join(', ') || 'None'}</div>
                <div>Current Request ID: {requestId || 'None'}</div>
                <div>Is Loading: {isLoading.toString()}</div>
                <div>Fuzz Mode: {isFuzzMode.toString()}</div>
                <div>Fuzz Parameters: {fuzzParameters.length}</div>
            </div>
        </div>
    );
};

export default SimpleHTTPEditor;