

import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
// import { StreamLanguage } from '@codemirror/language';
// import { http } from '@codemirror/legacy-modes/mode/http';
import { oneDark } from '@codemirror/theme-one-dark';
import { http } from './http-parser.component';
import { fullHeightTheme } from './fuzzer/request-editor/request-editor.component';


interface FuzzerResponse {
    response: string;
    responseTime: number;
}

interface FuzzerRequest {
    targetUrl: string;
    request: string;
    response: FuzzerResponse | null;
    requestDate: string;
    status: 'pending' | 'completed' | 'error';
}

type SortField = 'status' | 'method' | 'url' | 'statusCode' | 'responseTime' | 'contentLength';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
    field: SortField;
    direction: SortDirection;
}

interface ParsedRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
}

interface ParsedResponse {
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}

interface ResultsTableProps {
    results: FuzzerRequest[];
    isLoading: boolean;
}

const parseRequest = (rawRequest: string): ParsedRequest => {
    const lines = rawRequest.split('\n');
    const requestLine = lines[0] || '';
    const [method = 'GET', path = '/'] = requestLine.split(' ');

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            bodyStartIndex = i + 1;
            break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }

    const body = lines.slice(bodyStartIndex).join('\n').trim();

    return { method, path, headers, body };
};

const parseResponse = (rawResponse: string): ParsedResponse => {
    const lines = rawResponse.split('\n');
    const statusLine = lines[0] || '';
    const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
    const statusText = statusMatch ? statusMatch[2] : '';

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            bodyStartIndex = i + 1;
            break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }

    const body = lines.slice(bodyStartIndex).join('\n').trim();

    return { statusCode, statusText, headers, body };
};

const getContentLength = (headers: Record<string, string>): number => {
    const contentLength = headers['Content-Length'] || headers['content-length'];
    return contentLength ? parseInt(contentLength) : 0;
};

export const CodeMirrorEditor: React.FC<{ value: string }> = ({ value }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (editorRef.current && !viewRef.current) {
            const state = EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    EditorView.lineWrapping,
                    fullHeightTheme,
                    http(),
                    oneDark,
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true),
                ],
            });

            viewRef.current = new EditorView({
                state,
                parent: editorRef.current,
            });
        }

        return () => {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (viewRef.current) {
            const currentValue = viewRef.current.state.doc.toString();
            if (currentValue !== value) {
                viewRef.current.dispatch({
                    changes: {
                        from: 0,
                        to: currentValue.length,
                        insert: value,
                    },
                });
            }
        }
    }, [value]);

    return <div ref={editorRef} className="h-full overflow-auto" />;
};

const ResultsTable: React.FC<ResultsTableProps> = ({ results, isLoading }) => {
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [sortConfigs, setSortConfigs] = useState<SortConfig[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    const enrichedResults = useMemo(() => {
        return results.map(result => {
            const parsedRequest = parseRequest(result.request);
            const parsedResponse = result.response ? parseResponse(result.response.response) : null;
            const contentLength = parsedResponse ? getContentLength(parsedResponse.headers) : 0;

            return {
                ...result,
                parsedRequest,
                parsedResponse,
                contentLength
            };
        });
    }, [results]);

    const sortedResults = useMemo(() => {
        if (sortConfigs.length === 0) return enrichedResults;

        return [...enrichedResults].sort((a, b) => {
            for (const config of sortConfigs) {
                let comparison = 0;

                switch (config.field) {
                    case 'status':
                        comparison = a.status.localeCompare(b.status);
                        break;
                    case 'method':
                        comparison = a.parsedRequest.method.localeCompare(b.parsedRequest.method);
                        break;
                    case 'url':
                        comparison = a.parsedRequest.path.localeCompare(b.parsedRequest.path);
                        break;
                    case 'statusCode':
                        const aCode = a.parsedResponse?.statusCode ?? 0;
                        const bCode = b.parsedResponse?.statusCode ?? 0;
                        comparison = aCode - bCode;
                        break;
                    case 'responseTime':
                        const aTime = a.response?.responseTime ?? -1;
                        const bTime = b.response?.responseTime ?? -1;
                        comparison = aTime - bTime;
                        break;
                    case 'contentLength':
                        comparison = a.contentLength - b.contentLength;
                        break;
                }

                if (comparison !== 0) {
                    return config.direction === 'asc' ? comparison : -comparison;
                }
            }
            return 0;
        });
    }, [enrichedResults, sortConfigs]);

    const focusedResult = sortedResults[focusedIndex];

    const handleSort = (field: SortField, isShiftKey: boolean) => {
        setSortConfigs((prev) => {
            const existingIndex = prev.findIndex(c => c.field === field);

            if (!isShiftKey) {
                if (existingIndex !== -1) {
                    const existing = prev[existingIndex];
                    if (existing.direction === 'desc') {
                        return [];
                    }
                    return [{ field, direction: 'desc' }];
                }
                return [{ field, direction: 'asc' }];
            } else {
                if (existingIndex !== -1) {
                    const existing = prev[existingIndex];
                    if (existing.direction === 'desc') {
                        return prev.filter((_, i) => i !== existingIndex);
                    }
                    return prev.map((c, i) =>
                        i === existingIndex ? { field, direction: 'desc' } : c
                    );
                }
                return [...prev, { field, direction: 'asc' }];
            }
        });
    };

    const getSortIndicator = (field: SortField) => {
        const index = sortConfigs.findIndex(c => c.field === field);
        if (index === -1) return null;

        const config = sortConfigs[index];
        const arrow = config.direction === 'asc' ? '↑' : '↓';
        const number = sortConfigs.length > 1 ? ` ${index + 1}` : '';

        return (
            <span className="ml-1 text-blue-400 font-bold">
                {arrow}{number}
            </span>
        );
    };

    useEffect(() => {
        containerRef.current?.focus();
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex((prev) => Math.min(prev + 1, sortedResults.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex((prev) => Math.max(prev - 1, 0));
                break;
        }
    };

    useEffect(() => {
        itemRefs.current[focusedIndex]?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
    }, [focusedIndex]);

    const getStatusCodeColor = (code: number) => {
        if (code >= 200 && code < 300) return 'text-green-400';
        if (code >= 300 && code < 400) return 'text-blue-400';
        if (code >= 400 && code < 500) return 'text-yellow-400';
        return 'text-red-400';
    };

    if (results.length === 0) {
        return (
            <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex items-center justify-center">
                <div className="text-center text-gray-500 py-8">
                    {isLoading ? (
                        <div className="flex items-center gap-2">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                            <span>Processing requests...</span>
                        </div>
                    ) : (
                        <div>
                            <p className="text-lg mb-2">No requests sent yet</p>
                            <p className="text-sm text-gray-600">Configure your request and click "Run" to begin</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden h-full">
            <ReactSplit
                direction={SplitDirection.Vertical}
                initialSizes={[40, 45]}
                minHeights={[100, 100]}
                gutterClassName="bg-gray-800 hover:bg-gray-700"
            >
                {/* Results List */}
                <div className="bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden h-full">


                    {/* Table Header */}
                    <div className="px-2 py-2 border-b border-gray-800 bg-gray-950 flex-shrink-0">
                        <div className="grid grid-cols-12 gap-2 px-2 text-xs font-semibold text-gray-400 uppercase">
                            <button
                                onClick={(e) => handleSort('statusCode', e.shiftKey)}
                                className="col-span-1 text-left hover:text-white transition-colors"
                            >
                                Status{getSortIndicator('statusCode')}
                            </button>
                            <button
                                onClick={(e) => handleSort('method', e.shiftKey)}
                                className="col-span-1 text-left hover:text-white transition-colors"
                            >
                                Method{getSortIndicator('method')}
                            </button>
                            <button
                                onClick={(e) => handleSort('url', e.shiftKey)}
                                className="col-span-4 text-left hover:text-white transition-colors"
                            >
                                URL{getSortIndicator('url')}
                            </button>
                            <div className="col-span-3">Payload</div>
                            <button
                                onClick={(e) => handleSort('responseTime', e.shiftKey)}
                                className="col-span-2 text-left hover:text-white transition-colors"
                            >
                                Time{getSortIndicator('responseTime')}
                            </button>
                            <button
                                onClick={(e) => handleSort('contentLength', e.shiftKey)}
                                className="col-span-1 text-right hover:text-white transition-colors"
                            >
                                Size{getSortIndicator('contentLength')}
                            </button>
                        </div>
                    </div>

                    <div
                        ref={containerRef}
                        tabIndex={0}
                        onKeyDown={handleKeyDown}
                        className="flex-1 overflow-y-auto p-2 focus:outline-none"
                    >
                        <div className="space-y-1">
                            {sortedResults.map((result, index) => {
                                const isFocused = focusedIndex === index;

                                return (
                                    <div
                                        key={`${result.targetUrl}-${index}`}
                                        ref={(el) => (itemRefs.current[index] = el)}
                                        onClick={() => setFocusedIndex(index)}
                                        className={`
                                            p-2 rounded-md cursor-pointer transition-all duration-150
                                            ${isFocused
                                                ? 'bg-blue-600 border-blue-500'
                                                : 'bg-gray-900 border-gray-800'
                                            }
                                            border
                                        `}
                                    >
                                        <div className="grid grid-cols-12 gap-2 items-center text-xs">
                                            <div className="col-span-1">
                                                <span className={`font-mono font-semibold ${isFocused ? 'text-white' : result.parsedResponse ? getStatusCodeColor(result.parsedResponse.statusCode) : 'text-gray-400'}`}>
                                                    {result.parsedResponse?.statusCode || '-'}
                                                </span>
                                            </div>

                                            <div className="col-span-1">
                                                <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-400'}`}>
                                                    {result.parsedRequest.method}
                                                </span>
                                            </div>

                                            <div className="col-span-4">
                                                <span className={`font-mono text-xs truncate block ${isFocused ? 'text-white' : 'text-gray-300'}`}>
                                                    {result.parsedRequest.path}
                                                </span>
                                            </div>

                                            <div className="col-span-3">
                                                <span className={`font-mono text-xs truncate block ${isFocused ? 'text-blue-100' : 'text-gray-400'}`}>
                                                    {result.parsedRequest.body.substring(0, 50) || '-'}
                                                </span>
                                            </div>

                                            <div className="col-span-2">
                                                <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-500'}`}>
                                                    {result.response?.responseTime ? `${result.response.responseTime}ms` : '-'}
                                                </span>
                                            </div>

                                            <div className="col-span-1 text-right">
                                                <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-500'}`}>
                                                    {result.contentLength || '-'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-1.5 border-t border-gray-800 text-xs text-gray-600 text-center flex-shrink-0">
                        Use ↑↓ arrows • Click to sort • Shift+Click for multi-sort
                    </div>
                </div>

                {/* Request/Response Split */}
                {focusedResult && (
                    <ReactSplit
                        direction={SplitDirection.Horizontal}
                        initialSizes={[50, 50]}
                        minWidths={[200, 200]}
                        gutterClassName="bg-gray-800 hover:bg-gray-700"
                    >
                        {/* Request Panel */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden h-full">
                            <div className="p-2 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
                                <h3 className="text-xs font-semibold text-white">Request</h3>
                                <span className="text-xs text-gray-500 font-mono">{focusedResult.parsedRequest.method}</span>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <CodeMirrorEditor value={focusedResult.request} />
                            </div>
                        </div>

                        {/* Response Panel */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden h-full">
                            <div className="p-2 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
                                <h3 className="text-xs font-semibold text-white">Response</h3>
                                <div className="flex items-center gap-2">
                                    {focusedResult.parsedResponse && (
                                        <span className={`text-xs font-mono font-semibold ${getStatusCodeColor(focusedResult.parsedResponse.statusCode)}`}>
                                            {focusedResult.parsedResponse.statusCode}
                                        </span>
                                    )}
                                    {focusedResult.response?.responseTime && (
                                        <span className="text-xs text-gray-500">{focusedResult.response.responseTime}ms</span>
                                    )}
                                    {focusedResult.contentLength > 0 && (
                                        <span className="text-xs text-gray-500">{focusedResult.contentLength} bytes</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <CodeMirrorEditor value={focusedResult.response?.response || 'No response available'} />
                            </div>
                        </div>
                    </ReactSplit>
                )}
            </ReactSplit>
        </div>
    );
};

export default ResultsTable;

