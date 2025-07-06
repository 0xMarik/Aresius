// import { useRef, useEffect, useState } from 'react';
// import { EditorView, basicSetup } from 'codemirror';
// import { EditorState } from '@codemirror/state';
// import { json } from '@codemirror/lang-json';
// import { invoke } from "@tauri-apps/api/core";
// import { listen, UnlistenFn } from "@tauri-apps/api/event";
// import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
// import { Button } from '@/components/ui/button';
// import { Minus, Plus } from 'lucide-react';
// import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import { Label } from '@/components/ui/label';
// import { Input } from '@/components/ui/input';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// // Type definitions
// interface AsyncResponse {
//     request_id: string;
// }

// interface RequestCompletedPayload {
//     request_id: string;
//     result?: string;
//     error?: string;
// }

// interface FuzzParameter {
//     id: string;
//     placeholder: string;
//     originalText: string;
//     values: string[];
//     payloadType: 'manual' | 'hosted-file' | 'generator';
//     selectedFile?: string;
// }

// interface RequestResult {
//     id: string;
//     request: string;
//     response: string;
//     status: 'pending' | 'completed' | 'error';
//     timestamp: Date;
// }

// const Fuzzer: React.FC = () => {
//     const editorRef = useRef<HTMLDivElement>(null);
//     const viewRef = useRef<EditorView | null>(null);
//     const [content, setContent] = useState<string>('');
//     const [isLoading, setIsLoading] = useState<boolean>(false);
//     const [result, setResult] = useState<string>('');
//     const [requestId, setRequestId] = useState<string | null>(null);
//     const [selectedText, setSelectedText] = useState<string>('');
//     const [fuzzParameters, setFuzzParameters] = useState<FuzzParameter[]>([]);
//     const [selectedPayloadIndex, setSelectedPayloadIndex] = useState<number>(0);
//     const [isFuzzMode, setIsFuzzMode] = useState<boolean>(false);
//     const [fuzzResults, setFuzzResults] = useState<string[]>([]);
//     const [url, setUrl] = useState<string>('http://google.com');

//     const [results, setResults] = useState<RequestResult[]>([]);

//     // Ready for get initiated cause it get rendred before that
//     const [isSplitReady, setIsSplitReady] = useState(false);
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

//                     const resultText = error ? `Error: ${error}` : `Success: ${requestResult || 'No result'}`;

//                     if (isFuzzMode) {
//                         setFuzzResults(prev => [...prev, resultText]);
//                     } else {
//                         setResult(resultText);
//                         setIsLoading(false);
//                     }

//                     setResults(prev =>
//                         prev.map(r =>
//                             r.id === request_id
//                                 ? { ...r, response: resultText, status: error ? 'error' : 'completed' }
//                                 : r
//                         )
//                     );

//                     activeRequestsRef.current.delete(request_id);

//                     // If no more active requests, stop loading
//                     if (activeRequestsRef.current.size === 0) {
//                         setIsLoading(false);
//                         setRequestId(null);
//                     }
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
//     }, [isFuzzMode]);

//     const getSelectedText = (): string => {
//         if (!viewRef.current) return '';

//         const view = viewRef.current;
//         const selection = view.state.selection.main;

//         if (selection.empty) return '';

//         return view.state.doc.sliceString(selection.from, selection.to);
//     };

//     const replaceSelectedText = (newText: string): void => {
//         if (!viewRef.current) return;

//         const view = viewRef.current;
//         const selection = view.state.selection.main;

//         if (selection.empty) return;

//         const transaction = view.state.update({
//             changes: {
//                 from: selection.from,
//                 to: selection.to,
//                 insert: newText
//             }
//         });

//         view.dispatch(transaction);
//     };

//     const replaceTextInEditor = (oldText: string, newText: string): void => {
//         if (!viewRef.current) return;

//         const view = viewRef.current;
//         const currentContent = view.state.doc.toString();
//         const newContent = currentContent.replace(oldText, newText);

//         const transaction = view.state.update({
//             changes: {
//                 from: 0,
//                 to: view.state.doc.length,
//                 insert: newContent
//             }
//         });

//         view.dispatch(transaction);
//     };

//     const handleTextSelection = (): void => {
//         const selected = getSelectedText();
//         setSelectedText(selected);
//     };

//     const addFuzzParameter = (): void => {
//         const selected = getSelectedText();
//         if (!selected) {
//             alert('Please select text to fuzz');
//             return;
//         }

//         const placeholder = `{{FUZZ_${fuzzParameters.length + 1}}}`;
//         const newParam: FuzzParameter = {
//             id: Date.now().toString(),
//             placeholder,
//             originalText: selected,
//             values: [],
//             payloadType: 'manual'
//         };

//         // Replace selected text with placeholder
//         replaceSelectedText(placeholder);

//         setFuzzParameters(prev => [...prev, newParam]);
//         setSelectedPayloadIndex(fuzzParameters.length); // Select the new parameter
//         setSelectedText('');
//     };

//     const removeFuzzParameter = (): void => {
//         const selected = getSelectedText();
//         if (!selected) return;

//         // Check if selected text is a fuzz placeholder
//         const fuzzPlaceholderRegex = /^\{\{FUZZ_(\d+)\}\}$/;
//         const match = selected.match(fuzzPlaceholderRegex);

//         if (!match) return;

//         // const fuzzNumber = parseInt(match[1]);
//         const paramToRemove = fuzzParameters.find(p => p.placeholder === selected);

//         if (paramToRemove) {
//             // Replace placeholder back with original text
//             replaceSelectedText(paramToRemove.originalText);

//             // Remove the parameter and update remaining placeholders
//             const updatedParams = fuzzParameters.filter(p => p.id !== paramToRemove.id);

//             // Update placeholders in editor for remaining parameters
//             updatedParams.forEach((param, index) => {
//                 const newPlaceholder = `{{FUZZ_${index + 1}}}`;
//                 if (param.placeholder !== newPlaceholder) {
//                     replaceTextInEditor(param.placeholder, newPlaceholder);
//                     param.placeholder = newPlaceholder;
//                 }
//             });

//             setFuzzParameters(updatedParams);

//             // Adjust selected payload index
//             if (selectedPayloadIndex >= updatedParams.length) {
//                 setSelectedPayloadIndex(Math.max(0, updatedParams.length - 1));
//             }
//         }
//     };

//     const clearFuzzes = (): void => {
//         if (!viewRef.current) return;

//         // Replace all fuzz placeholders with their original text
//         fuzzParameters.forEach(param => {
//             replaceTextInEditor(param.placeholder, param.originalText);
//         });

//         setFuzzParameters([]);
//         setSelectedPayloadIndex(0);
//     };

//     const isValidFuzzSelection = (): boolean => {
//         const selected = getSelectedText();
//         const fuzzPlaceholderRegex = /^\{\{FUZZ_(\d+)\}\}$/;
//         return fuzzPlaceholderRegex.test(selected);
//     };

//     const updatePayloadValues = (values: string): void => {
//         if (fuzzParameters.length === 0) return;

//         const valueList = values.split('\n');

//         setFuzzParameters(prev => prev.map((param, index) =>
//             index === selectedPayloadIndex
//                 ? { ...param, values: valueList }
//                 : param
//         ));
//     };

//     const updatePayloadType = (type: 'manual' | 'hosted-file' | 'generator'): void => {
//         if (fuzzParameters.length === 0) return;

//         setFuzzParameters(prev => prev.map((param, index) =>
//             index === selectedPayloadIndex
//                 ? { ...param, payloadType: type }
//                 : param
//         ));
//     };

//     const updateSelectedFile = (file: string): void => {
//         if (fuzzParameters.length === 0) return;

//         setFuzzParameters(prev => prev.map((param, index) =>
//             index === selectedPayloadIndex
//                 ? { ...param, selectedFile: file }
//                 : param
//         ));
//     };

//     const generateFuzzRequests = (): string[] => {
//         if (fuzzParameters.length === 0) return [content];

//         const requests: string[] = [];

//         // Generate all combinations
//         const generateCombinations = (paramIndex: number, currentRequest: string): void => {
//             if (paramIndex >= fuzzParameters.length) {
//                 requests.push(currentRequest);
//                 return;
//             }

//             const param = fuzzParameters[paramIndex];
//             if (param.values.length === 0) {
//                 // If no values, use original text
//                 const newRequest = currentRequest.replace(param.placeholder, param.originalText);
//                 generateCombinations(paramIndex + 1, newRequest);
//             } else {
//                 param.values.forEach(value => {
//                     const newRequest = currentRequest.replace(param.placeholder, value);
//                     generateCombinations(paramIndex + 1, newRequest);
//                 });
//             }
//         };

//         generateCombinations(0, content);
//         return requests;
//     };

//     const send_data = async (): Promise<void> => {
//         try {
//             setIsLoading(true);
//             setResult('');
//             setFuzzResults([]);

//             const requests = generateFuzzRequests();
//             console.log(`Sending ${requests.length} fuzz requests`);

//             setIsFuzzMode(requests.length > 1);

//             // Send all requests
//             for (const request of requests) {
//                 console.log('Sending request with content:', request);
//                 const response = await invoke<AsyncResponse>("send_data_async", { content: request, url });
//                 console.log('Received request ID:', response.request_id);
//                 activeRequestsRef.current.add(response.request_id);
//             }

//             if (requests.length === 1) {
//                 setRequestId(Array.from(activeRequestsRef.current)[0]);
//             }

//         } catch (error) {
//             console.error('Error sending request:', error);
//             setIsLoading(false);
//             setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
//         }
//     };

//     const cancel_request = async (): Promise<void> => {
//         try {
//             // Cancel all active requests
//             for (const reqId of activeRequestsRef.current) {
//                 await invoke<string>("cancel_request", { requestId: reqId });
//             }
//             setIsLoading(false);
//             setResult('Requests cancelled');
//             setFuzzResults([]);
//             activeRequestsRef.current.clear();
//             setRequestId(null);
//             setIsFuzzMode(false);
//         } catch (error) {
//             console.error('Failed to cancel requests:', error);
//             setIsLoading(false);
//             setResult('Cancel request failed, but cleaning up UI');
//             activeRequestsRef.current.clear();
//             setRequestId(null);
//             setIsFuzzMode(false);
//         }
//     };

//     useEffect(() => {
//         // Use a small timeout to ensure the split pane has calculated dimensions
//         const timer = setTimeout(() => {
//             if (editorRef.current) {
//                 setIsSplitReady(true);
//                 if (viewRef.current) {
//                     // Refresh existing editor
//                     viewRef.current.dispatch({});
//                 }
//             }
//         }, 50);

//         return () => clearTimeout(timer);
//     }, []);

//     useEffect(() => {
//         if (!isSplitReady || !editorRef.current) return;

//         const initialContent = `GET / HTTP/1.1
// Host: google.com
// User-Agent: Rust-TCP-Client/1.0
// Accept: */*
// Connection: close

// `;

//         const state = EditorState.create({
//             doc: initialContent,
//             extensions: [
//                 basicSetup,
//                 json(),
//                 EditorView.updateListener.of((update) => {
//                     if (update.docChanged) {
//                         const docText = update.state.doc.toString();
//                         setContent(docText);
//                     }
//                     if (update.selectionSet) {
//                         handleTextSelection();
//                     }
//                 })
//             ]
//         });

//         const view = new EditorView({
//             state,
//             parent: editorRef.current
//         });

//         viewRef.current = view;
//         setContent(initialContent);
//         setIsSplitReady(true);

//         // const resizeObserver = new ResizeObserver(() => {
//         //     if (viewRef.current) {
//         //         // Force a refresh of the editor layout
//         //         viewRef.current.dispatch({});
//         //     }
//         // });

//         // if (editorRef.current) {
//         //     resizeObserver.observe(editorRef.current);
//         // }

//         return () => {
//             // resizeObserver.disconnect();
//             view.destroy();
//         };
//     }, [isSplitReady]);

//     const currentParam = fuzzParameters[selectedPayloadIndex];
import { useRef, useEffect, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    originalText: string;
    values: string[];
    payloadType: 'manual' | 'hosted-file' | 'generator';
    selectedFile?: string;
}

interface RequestResult {
    id: string;
    request: string;
    response: string;
    status: 'pending' | 'completed' | 'error';
    timestamp: Date;
}

// Results Table Component
const ResultsTable: React.FC<{
    results: RequestResult[];
    isLoading: boolean;
    onClearResults: () => void;
}> = ({ results, isLoading, onClearResults }) => {
    const [selectedRequest, setSelectedRequest] = useState<RequestResult | null>(null);

    const getStatusColor = (status: string): string => {
        switch (status) {
            case 'completed': return 'text-green-600';
            case 'error': return 'text-red-600';
            case 'pending': return 'text-yellow-600';
            default: return 'text-gray-600';
        }
    };

    const getStatusIcon = (status: string): string => {
        switch (status) {
            case 'completed': return '✓';
            case 'error': return '✗';
            case 'pending': return '⏳';
            default: return '?';
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Request Results ({results.length})</h3>
                <div className="flex gap-2">
                    {isLoading && (
                        <div className="flex items-center text-sm text-gray-600">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                            Processing...
                        </div>
                    )}
                    {results.length > 0 && (
                        <button
                            onClick={onClearResults}
                            className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
                            disabled={isLoading}
                        >
                            Clear Results
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                {results.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                        No requests sent yet. Configure your request and click "Run" to begin.
                    </div>
                ) : (
                    <div className="h-full border border-gray-300 rounded overflow-hidden">
                        <div className="overflow-auto h-full">
                            <table className="w-full">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                            #
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                                            Status
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                                            Time
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Request Preview
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Response Preview
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {results.map((result, index) => (
                                        <tr key={result.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                                                {index + 1}
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                <span className={`${getStatusColor(result.status)} font-medium`}>
                                                    {getStatusIcon(result.status)} {result.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                                {result.timestamp.toLocaleTimeString()}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                                <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
                                                    {result.request.split('\n')[0]}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                                <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
                                                    {result.response.substring(0, 100)}...
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                <button
                                                    onClick={() => setSelectedRequest(result)}
                                                    className="text-blue-600 hover:text-blue-900 text-xs"
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Request/Response Detail Modal */}
            {selectedRequest && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg w-4/5 h-4/5 flex flex-col">
                        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-lg font-bold">
                                Request #{results.indexOf(selectedRequest) + 1} Details
                            </h3>
                            <button
                                onClick={() => setSelectedRequest(null)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 flex overflow-hidden">
                            <div className="w-1/2 p-4 border-r border-gray-200">
                                <h4 className="font-semibold mb-2">Request:</h4>
                                <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
                                    {selectedRequest.request}
                                </pre>
                            </div>
                            <div className="w-1/2 p-4">
                                <h4 className="font-semibold mb-2">Response:</h4>
                                <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
                                    {selectedRequest.response}
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const Fuzzer: React.FC = () => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [content, setContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [result, setResult] = useState<string>('');
    const [requestId, setRequestId] = useState<string | null>(null);
    const [selectedText, setSelectedText] = useState<string>('');
    const [fuzzParameters, setFuzzParameters] = useState<FuzzParameter[]>([]);
    const [selectedPayloadIndex, setSelectedPayloadIndex] = useState<number>(0);
    const [isFuzzMode, setIsFuzzMode] = useState<boolean>(false);
    const [fuzzResults, setFuzzResults] = useState<string[]>([]);
    const [url, setUrl] = useState<string>('http://google.com');

    const [results, setResults] = useState<RequestResult[]>([]);

    // Ready for get initiated cause it get rendred before that
    const [isSplitReady, setIsSplitReady] = useState(false);
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

                    setResults(prev =>
                        prev.map(r =>
                            r.id === request_id
                                ? { ...r, response: resultText, status: error ? 'error' : 'completed' }
                                : r
                        )
                    );

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

    const clearResults = () => {
        setResults([]);
        setFuzzResults([]);
        setResult('');
    };

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

    const replaceTextInEditor = (oldText: string, newText: string): void => {
        if (!viewRef.current) return;

        const view = viewRef.current;
        const currentContent = view.state.doc.toString();
        const newContent = currentContent.replace(oldText, newText);

        const transaction = view.state.update({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: newContent
            }
        });

        view.dispatch(transaction);
    };

    const handleTextSelection = (): void => {
        const selected = getSelectedText();
        setSelectedText(selected);
    };

    const addFuzzParameter = (): void => {
        const selected = getSelectedText();
        if (!selected) {
            alert('Please select text to fuzz');
            return;
        }

        const placeholder = `{{FUZZ_${fuzzParameters.length + 1}}}`;
        const newParam: FuzzParameter = {
            id: Date.now().toString(),
            placeholder,
            originalText: selected,
            values: [],
            payloadType: 'manual'
        };

        // Replace selected text with placeholder
        replaceSelectedText(placeholder);

        setFuzzParameters(prev => [...prev, newParam]);
        setSelectedPayloadIndex(fuzzParameters.length); // Select the new parameter
        setSelectedText('');
    };

    const removeFuzzParameter = (): void => {
        const selected = getSelectedText();
        if (!selected) return;

        // Check if selected text is a fuzz placeholder
        const fuzzPlaceholderRegex = /^\{\{FUZZ_(\d+)\}\}$/;
        const match = selected.match(fuzzPlaceholderRegex);

        if (!match) return;

        // const fuzzNumber = parseInt(match[1]);
        const paramToRemove = fuzzParameters.find(p => p.placeholder === selected);

        if (paramToRemove) {
            // Replace placeholder back with original text
            replaceSelectedText(paramToRemove.originalText);

            // Remove the parameter and update remaining placeholders
            const updatedParams = fuzzParameters.filter(p => p.id !== paramToRemove.id);

            // Update placeholders in editor for remaining parameters
            updatedParams.forEach((param, index) => {
                const newPlaceholder = `{{FUZZ_${index + 1}}}`;
                if (param.placeholder !== newPlaceholder) {
                    replaceTextInEditor(param.placeholder, newPlaceholder);
                    param.placeholder = newPlaceholder;
                }
            });

            setFuzzParameters(updatedParams);

            // Adjust selected payload index
            if (selectedPayloadIndex >= updatedParams.length) {
                setSelectedPayloadIndex(Math.max(0, updatedParams.length - 1));
            }
        }
    };

    const clearFuzzes = (): void => {
        if (!viewRef.current) return;

        // Replace all fuzz placeholders with their original text
        fuzzParameters.forEach(param => {
            replaceTextInEditor(param.placeholder, param.originalText);
        });

        setFuzzParameters([]);
        setSelectedPayloadIndex(0);
    };

    const isValidFuzzSelection = (): boolean => {
        const selected = getSelectedText();
        const fuzzPlaceholderRegex = /^\{\{FUZZ_(\d+)\}\}$/;
        return fuzzPlaceholderRegex.test(selected);
    };

    const updatePayloadValues = (values: string): void => {
        if (fuzzParameters.length === 0) return;

        const valueList = values.split('\n');

        setFuzzParameters(prev => prev.map((param, index) =>
            index === selectedPayloadIndex
                ? { ...param, values: valueList }
                : param
        ));
    };

    const updatePayloadType = (type: 'manual' | 'hosted-file' | 'generator'): void => {
        if (fuzzParameters.length === 0) return;

        setFuzzParameters(prev => prev.map((param, index) =>
            index === selectedPayloadIndex
                ? { ...param, payloadType: type }
                : param
        ));
    };

    const updateSelectedFile = (file: string): void => {
        if (fuzzParameters.length === 0) return;

        setFuzzParameters(prev => prev.map((param, index) =>
            index === selectedPayloadIndex
                ? { ...param, selectedFile: file }
                : param
        ));
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
            if (param.values.length === 0) {
                // If no values, use original text
                const newRequest = currentRequest.replace(param.placeholder, param.originalText);
                generateCombinations(paramIndex + 1, newRequest);
            } else {
                param.values.forEach(value => {
                    const newRequest = currentRequest.replace(param.placeholder, value);
                    generateCombinations(paramIndex + 1, newRequest);
                });
            }
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

            // Create initial results with pending status
            const initialResults: RequestResult[] = [];

            // Send all requests
            for (const [index, request] of requests.entries()) {
                console.log('Sending request with content:', request);
                const response = await invoke<AsyncResponse>("send_data_async", { content: request, url });
                console.log('Received request ID:', response.request_id);
                activeRequestsRef.current.add(response.request_id);

                // Add to results with pending status
                initialResults.push({
                    id: response.request_id,
                    request: request,
                    response: '',
                    status: 'pending',
                    timestamp: new Date()
                });
            }

            // Add all initial results to state
            setResults(prev => [...prev, ...initialResults]);

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
        // Use a small timeout to ensure the split pane has calculated dimensions
        const timer = setTimeout(() => {
            if (editorRef.current) {
                setIsSplitReady(true);
                if (viewRef.current) {
                    // Refresh existing editor
                    viewRef.current.dispatch({});
                }
            }
        }, 50);

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!isSplitReady || !editorRef.current) return;

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
        setIsSplitReady(true);

        return () => {
            view.destroy();
        };
    }, [isSplitReady]);

    const currentParam = fuzzParameters[selectedPayloadIndex];

    useEffect(() => {
        console.log({ results })
    }, [results]);

    return (
        <div className="p-4 h-full">
            <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
                <Input
                    onChange={(e) => setUrl(e.target.value)}
                    value={url}
                    placeholder='URL' />
                <Button
                    onClick={send_data}
                    disabled={isLoading}
                    className="p-4 bg-blue-500 text-white rounded disabled:bg-gray-400"
                >
                    {isLoading ? '...' : 'Run'}
                </Button>
            </div>
            <ReactSplit
                direction={SplitDirection.Horizontal}
                initialSizes={[50, 50]}
                gutterClassName="custom-gutter-horizontal"
                draggerClassName="custom-dragger-horizontal"
                classes={["py-1", "py-1"]}
            >
                <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                    <div className='flex items-center justify-between bg-muted/50 aspect-video rounded-lg p-1 w-full h-12 mb-4'>
                        <h3 className="mb-2 font-bold">Request</h3>
                        <div className='flex gap-1'>
                            <Button onClick={clearFuzzes} className='h-[2rem]'>Clear Fuzzes</Button>
                            <Button
                                onClick={removeFuzzParameter}
                                disabled={isLoading || !isValidFuzzSelection()}
                                size="icon"
                                className="size-8"
                                title="Select a {{FUZZ_X}} placeholder to remove"
                            >
                                <Minus />
                            </Button>
                            <Button
                                onClick={addFuzzParameter}
                                disabled={isLoading || !selectedText}
                                size="icon"
                                className="size-8"
                                title="Select text to add as fuzz parameter"
                            >
                                <Plus />
                            </Button>
                        </div>
                    </div>
                    <div ref={editorRef} className="border border-gray-300 rounded mb-4 " />
                </div>

                <div className='bg-muted/50 aspect-video rounded-lg p-1 w-full h-full'>
                    <div className="mb-4">
                        {selectedText && (
                            <div className="text-sm">
                                <span className="text-gray-600">Selected: </span>
                                <span className="font-mono bg-gray-100 px-2 py-1 rounded">"{selectedText}"</span>
                                {isValidFuzzSelection() && (
                                    <span className="ml-2 text-green-600">✓ Valid fuzz placeholder</span>
                                )}
                            </div>
                        )}
                    </div>

                    {fuzzParameters.length > 0 ? (
                        <Tabs defaultValue="payload" className="w-full max-w-lg p-4">
                            <TabsList>
                                <TabsTrigger value="payload">Payload</TabsTrigger>
                                <TabsTrigger value="preprocessors">Preprocessors</TabsTrigger>
                                <TabsTrigger value="settings">Settings</TabsTrigger>
                            </TabsList>

                            <TabsContent value="payload" className="space-y-4 mt-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="payloadNumber">Payload #</Label>
                                        <Select
                                            value={String(selectedPayloadIndex + 1)}
                                            onValueChange={(value) => setSelectedPayloadIndex(Number(value) - 1)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {fuzzParameters.map((_, index) => (
                                                    <SelectItem key={index} value={String(index + 1)}>
                                                        {index + 1}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label htmlFor="placeholder">Placeholder</Label>
                                        <Input
                                            id="placeholder"
                                            value={currentParam?.placeholder || ''}
                                            placeholder="(empty)"
                                            readOnly
                                        />
                                    </div>
                                </div>

                                <div>
                                    <Label htmlFor="originalText">Original Text</Label>
                                    <Input
                                        id="originalText"
                                        value={currentParam?.originalText || ''}
                                        placeholder="(empty)"
                                        readOnly
                                    />
                                </div>

                                <div>
                                    <Label>Type</Label>
                                    <Select
                                        value={currentParam?.payloadType || 'manual'}
                                        onValueChange={(value) => updatePayloadType(value as any)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hosted-file">Hosted File</SelectItem>
                                            <SelectItem value="manual">Manual Input</SelectItem>
                                            <SelectItem value="generator">Generator</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {currentParam?.payloadType === "manual" && (
                                    <div>
                                        <Label>Payload Values (one per line)</Label>
                                        <textarea
                                            value={currentParam.values.join('\n')}
                                            onChange={(e) => updatePayloadValues(e.target.value)}
                                            placeholder="value1\nvalue2\nvalue3"
                                            className="w-full h-32 p-2 border border-gray-300 rounded resize-none"
                                        // style={{ whiteSpace: 'pre-wrap' }}
                                        />
                                        <div className="text-xs text-gray-500 mt-1">
                                            Values count: {currentParam.values.length}
                                        </div>
                                    </div>
                                )}

                                {currentParam?.payloadType === "hosted-file" && (
                                    <div>
                                        <Label>Selected File</Label>
                                        <Select
                                            value={currentParam.selectedFile || ''}
                                            onValueChange={updateSelectedFile}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Choose file" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="wordlist1.txt">wordlist1.txt</SelectItem>
                                                <SelectItem value="users.txt">users.txt</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="preprocessors">
                                <p>Preprocessor config goes here</p>
                            </TabsContent>

                            <TabsContent value="settings">
                                <p>Settings config goes here</p>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="p-4 text-center text-gray-500">
                            Select text in the request editor and click the + button to add fuzz parameters
                        </div>
                    )}

                    {fuzzParameters.length > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                            <h4 className="font-semibold mb-2">Fuzz Parameters Summary:</h4>
                            {fuzzParameters.map((param,) => (
                                <div key={param.id} className="mb-2 p-2 bg-white border rounded">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                                {param.placeholder}
                                            </span>
                                            <span className="ml-2 text-sm text-gray-600">
                                                → "{param.originalText}"
                                            </span>
                                        </div>
                                        <span className="text-sm text-blue-600">
                                            {param.values.length} values
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div className="text-sm text-gray-600 mt-2">
                                Total requests: {generateFuzzRequests().length}
                            </div>
                        </div>
                    )}
                </div>


            </ReactSplit>
            <div className='bg-muted/50 aspect-video rounded-lg p-1 w-full h-90'>
                <ResultsTable
                    isLoading={isLoading}
                    onClearResults={clearResults}
                    results={results}

                />
            </div>
            <div className="flex gap-2 mb-4 mt-4">


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
        </div>
    );
};

export default Fuzzer;