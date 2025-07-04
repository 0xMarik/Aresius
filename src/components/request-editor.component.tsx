import { useRef, useEffect } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';


interface FuzzParameter {
    id: string;
    placeholder: string;
    values: string[];
    currentIndex: number;
}



// HTTP Editor Component
const RequestEditor: React.FC<{
    content: string;
    onContentChange: (content: string) => void;
    onTextSelect: (text: string) => void;
    fuzzParameters: FuzzParameter[];
    onAddFuzzParameter: () => void;
    onRemoveFuzzParameter: (id: string) => void;
    selectedText: string;
    isLoading: boolean;
}> = ({
    content,
    onContentChange,
    onTextSelect,
    fuzzParameters,
    onAddFuzzParameter,
    onRemoveFuzzParameter,
    selectedText,
    isLoading
}) => {
        const editorRef = useRef<HTMLDivElement>(null);
        const viewRef = useRef<EditorView | null>(null);

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
            onTextSelect(selected);
        };

        const handleAddFuzzParameter = (): void => {
            const selected = getSelectedText();
            if (!selected) {
                alert('Please select text to fuzz');
                return;
            }
            onAddFuzzParameter();
        };

        const handleRemoveFuzzParameter = (id: string): void => {
            const param = fuzzParameters.find(p => p.id === id);
            if (param && viewRef.current) {
                // Replace placeholder back with first value
                const currentContent = viewRef.current.state.doc.toString();
                const newContent = currentContent.replace(param.placeholder, param.values[0]);

                const transaction = viewRef.current.state.update({
                    changes: {
                        from: 0,
                        to: viewRef.current.state.doc.length,
                        insert: newContent
                    }
                });
                viewRef.current.dispatch(transaction);
            }
            onRemoveFuzzParameter(id);
        };

        // Expose replaceSelectedText to parent
        useEffect(() => {
            if (viewRef.current) {
                (viewRef.current as any).replaceSelectedText = replaceSelectedText;
            }
        }, []);

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
                                onContentChange(docText);
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
                onContentChange(initialContent);

                return () => view.destroy();
            }
        }, []);

        const generateFuzzRequests = (): string[] => {
            if (fuzzParameters.length === 0) return [content];

            const requests: string[] = [];

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

        return (
            <div className="flex flex-col h-full">
                <div>

                    {/* <div className="mb-4">
                        <button
                            onClick={handleAddFuzzParameter}
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
                    </div> */}

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
                                        onClick={() => handleRemoveFuzzParameter(param.id)}
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
                </div>

                <div ref={editorRef} className="border border-gray-300 rounded flex-1 min-h-64" />
            </div>
        );
    };

export default RequestEditor