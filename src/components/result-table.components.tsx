// // import { FuzzerRequest } from "@/types/fuzzer.type";
// // import { useState } from "react";


// // const ResultsTable: React.FC<{
// //     results: FuzzerRequest[];
// //     isLoading: boolean;
// // }> = ({ results, isLoading }) => {
// //     const [selectedRequest, setSelectedRequest] = useState<FuzzerRequest | null>(null);

// //     const getStatusColor = (status: string): string => {
// //         switch (status) {
// //             case 'completed': return 'text-green-600';
// //             case 'error': return 'text-red-600';
// //             case 'pending': return 'text-yellow-600';
// //             default: return 'text-gray-600';
// //         }
// //     };

// //     const getStatusIcon = (status: string): string => {
// //         switch (status) {
// //             case 'completed': return '✓';
// //             case 'error': return '✗';
// //             case 'pending': return '⏳';
// //             default: return '?';
// //         }
// //     };

// //     return (
// //         <div className="flex flex-col h-full">
// //             <div className="flex items-center justify-between mb-4">
// //                 <h3 className="text-lg font-bold">Request Results ({results.length})</h3>
// //                 <div className="flex gap-2">
// //                     {isLoading && (
// //                         <div className="flex items-center text-sm text-gray-600">
// //                             <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
// //                             Processing...
// //                         </div>
// //                     )}
// //                 </div>
// //             </div>

// //             <div className="flex-1 overflow-hidden">
// //                 {results.length === 0 ? (
// //                     <div className="text-center text-gray-500 py-8">
// //                         No requests sent yet. Configure your request and click "Run" to begin.
// //                     </div>
// //                 ) : (
// //                     <div className="h-full border border-gray-300 rounded overflow-hidden">
// //                         <div className="overflow-auto h-full">
// //                             <table className="w-full">
// //                                 <thead className="bg-gray-50 sticky top-0">
// //                                     <tr>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
// //                                             #
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
// //                                             Status
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
// //                                             Time
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
// //                                             URL
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
// //                                             Request Preview
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
// //                                             Response Preview
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
// //                                             Response Time
// //                                         </th>
// //                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
// //                                             Actions
// //                                         </th>
// //                                     </tr>
// //                                 </thead>
// //                                 <tbody className="bg-white divide-y divide-gray-200">
// //                                     {results.map((result, index) => (
// //                                         <tr key={`${result.targetUrl}-${index}`} className="hover:bg-gray-50">
// //                                             <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
// //                                                 {index + 1}
// //                                             </td>
// //                                             <td className="px-4 py-2 whitespace-nowrap text-sm">
// //                                                 <span className={`${getStatusColor(result.status)} font-medium`}>
// //                                                     {getStatusIcon(result.status)} {result.status}
// //                                                 </span>
// //                                             </td>
// //                                             <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
// //                                                 {new Date(result.requestDate).toLocaleTimeString()}
// //                                             </td>
// //                                             <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
// //                                                 <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
// //                                                     {result.targetUrl}
// //                                                 </div>
// //                                             </td>
// //                                             <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
// //                                                 <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
// //                                                     {result.request.split('\n')[0]}
// //                                                 </div>
// //                                             </td>
// //                                             <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
// //                                                 <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
// //                                                     {result.response?.response?.substring(0, 100) || 'No response'}...
// //                                                 </div>
// //                                             </td>
// //                                             <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
// //                                                 {result.response?.responseTime ? `${result.response.responseTime}ms` : '-'}
// //                                             </td>
// //                                             <td className="px-4 py-2 whitespace-nowrap text-sm">
// //                                                 <button
// //                                                     onClick={() => setSelectedRequest(result)}
// //                                                     className="text-blue-600 hover:text-blue-900 text-xs"
// //                                                 >
// //                                                     View
// //                                                 </button>
// //                                             </td>
// //                                         </tr>
// //                                     ))}
// //                                 </tbody>
// //                             </table>
// //                         </div>
// //                     </div>
// //                 )}
// //             </div>

// //             {/* Request/Response Detail Modal */}
// //             {selectedRequest && (
// //                 <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
// //                     <div className="bg-white rounded-lg w-4/5 h-4/5 flex flex-col">
// //                         <div className="p-4 border-b border-gray-200 flex items-center justify-between">
// //                             <div>
// //                                 <h3 className="text-lg font-bold">
// //                                     Request #{results.indexOf(selectedRequest) + 1} Details
// //                                 </h3>
// //                                 <p className="text-sm text-gray-600">
// //                                     URL: {selectedRequest.targetUrl}
// //                                     {selectedRequest.response?.responseTime && (
// //                                         <span className="ml-4">Response Time: {selectedRequest.response.responseTime}ms</span>
// //                                     )}
// //                                 </p>
// //                             </div>
// //                             <button
// //                                 onClick={() => setSelectedRequest(null)}
// //                                 className="text-gray-500 hover:text-gray-700"
// //                             >
// //                                 ✕
// //                             </button>
// //                         </div>

// //                         <div className="flex-1 flex overflow-hidden">
// //                             <div className="w-1/2 p-4 border-r border-gray-200">
// //                                 <h4 className="font-semibold mb-2">Request:</h4>
// //                                 <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
// //                                     {selectedRequest.request}
// //                                 </pre>
// //                             </div>
// //                             <div className="w-1/2 p-4">
// //                                 <h4 className="font-semibold mb-2">Response:</h4>
// //                                 <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
// //                                     {selectedRequest.response?.response || 'No response available'}
// //                                 </pre>
// //                             </div>
// //                         </div>
// //                     </div>
// //                 </div>
// //             )}
// //         </div>
// //     );
// // };

// // export default ResultsTable;

// import React, { useState, useRef, useEffect, useMemo } from 'react';

// interface FuzzerResponse {
//     response: string;
//     responseTime: number;
// }

// interface FuzzerRequest {
//     targetUrl: string;
//     request: string;
//     response: FuzzerResponse | null;
//     requestDate: string;
//     status: 'pending' | 'completed' | 'error';
// }

// type SortField = 'status' | 'method' | 'url' | 'statusCode' | 'responseTime' | 'contentLength';
// type SortDirection = 'asc' | 'desc';

// interface SortConfig {
//     field: SortField;
//     direction: SortDirection;
// }

// interface ParsedRequest {
//     method: string;
//     path: string;
//     headers: Record<string, string>;
//     body: string;
// }

// interface ParsedResponse {
//     statusCode: number;
//     statusText: string;
//     headers: Record<string, string>;
//     body: string;
// }

// interface ResultsTableProps {
//     results: FuzzerRequest[];
//     isLoading: boolean;
// }

// const parseRequest = (rawRequest: string): ParsedRequest => {
//     const lines = rawRequest.split('\n');
//     const requestLine = lines[0] || '';
//     const [method = 'GET', path = '/'] = requestLine.split(' ');

//     const headers: Record<string, string> = {};
//     let bodyStartIndex = 1;

//     for (let i = 1; i < lines.length; i++) {
//         const line = lines[i].trim();
//         if (line === '') {
//             bodyStartIndex = i + 1;
//             break;
//         }
//         const colonIndex = line.indexOf(':');
//         if (colonIndex > 0) {
//             const key = line.substring(0, colonIndex).trim();
//             const value = line.substring(colonIndex + 1).trim();
//             headers[key] = value;
//         }
//     }

//     const body = lines.slice(bodyStartIndex).join('\n').trim();

//     return { method, path, headers, body };
// };

// const parseResponse = (rawResponse: string): ParsedResponse => {
//     const lines = rawResponse.split('\n');
//     const statusLine = lines[0] || '';
//     const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
//     const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
//     const statusText = statusMatch ? statusMatch[2] : '';

//     const headers: Record<string, string> = {};
//     let bodyStartIndex = 1;

//     for (let i = 1; i < lines.length; i++) {
//         const line = lines[i].trim();
//         if (line === '') {
//             bodyStartIndex = i + 1;
//             break;
//         }
//         const colonIndex = line.indexOf(':');
//         if (colonIndex > 0) {
//             const key = line.substring(0, colonIndex).trim();
//             const value = line.substring(colonIndex + 1).trim();
//             headers[key] = value;
//         }
//     }

//     const body = lines.slice(bodyStartIndex).join('\n').trim();

//     return { statusCode, statusText, headers, body };
// };

// const getContentLength = (headers: Record<string, string>): number => {
//     const contentLength = headers['Content-Length'] || headers['content-length'];
//     return contentLength ? parseInt(contentLength) : 0;
// };

// const ResultsTable: React.FC<ResultsTableProps> = ({ results, isLoading }) => {
//     const [focusedIndex, setFocusedIndex] = useState(0);
//     const [sortConfigs, setSortConfigs] = useState<SortConfig[]>([]);
//     const containerRef = useRef<HTMLDivElement>(null);
//     const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

//     const enrichedResults = useMemo(() => {
//         return results.map(result => {
//             const parsedRequest = parseRequest(result.request);
//             const parsedResponse = result.response ? parseResponse(result.response.response) : null;
//             const contentLength = parsedResponse ? getContentLength(parsedResponse.headers) : 0;

//             return {
//                 ...result,
//                 parsedRequest,
//                 parsedResponse,
//                 contentLength
//             };
//         });
//     }, [results]);

//     const sortedResults = useMemo(() => {
//         if (sortConfigs.length === 0) return enrichedResults;

//         return [...enrichedResults].sort((a, b) => {
//             for (const config of sortConfigs) {
//                 let comparison = 0;

//                 switch (config.field) {
//                     case 'status':
//                         comparison = a.status.localeCompare(b.status);
//                         break;
//                     case 'method':
//                         comparison = a.parsedRequest.method.localeCompare(b.parsedRequest.method);
//                         break;
//                     case 'url':
//                         comparison = a.parsedRequest.path.localeCompare(b.parsedRequest.path);
//                         break;
//                     case 'statusCode':
//                         const aCode = a.parsedResponse?.statusCode ?? 0;
//                         const bCode = b.parsedResponse?.statusCode ?? 0;
//                         comparison = aCode - bCode;
//                         break;
//                     case 'responseTime':
//                         const aTime = a.response?.responseTime ?? -1;
//                         const bTime = b.response?.responseTime ?? -1;
//                         comparison = aTime - bTime;
//                         break;
//                     case 'contentLength':
//                         comparison = a.contentLength - b.contentLength;
//                         break;
//                 }

//                 if (comparison !== 0) {
//                     return config.direction === 'asc' ? comparison : -comparison;
//                 }
//             }
//             return 0;
//         });
//     }, [enrichedResults, sortConfigs]);

//     const focusedResult = sortedResults[focusedIndex];

//     const handleSort = (field: SortField, isShiftKey: boolean) => {
//         setSortConfigs((prev) => {
//             const existingIndex = prev.findIndex(c => c.field === field);

//             if (!isShiftKey) {
//                 if (existingIndex !== -1) {
//                     const existing = prev[existingIndex];
//                     if (existing.direction === 'desc') {
//                         return [];
//                     }
//                     return [{ field, direction: 'desc' }];
//                 }
//                 return [{ field, direction: 'asc' }];
//             } else {
//                 if (existingIndex !== -1) {
//                     const existing = prev[existingIndex];
//                     if (existing.direction === 'desc') {
//                         return prev.filter((_, i) => i !== existingIndex);
//                     }
//                     return prev.map((c, i) =>
//                         i === existingIndex ? { field, direction: 'desc' } : c
//                     );
//                 }
//                 return [...prev, { field, direction: 'asc' }];
//             }
//         });
//     };

//     const getSortIndicator = (field: SortField) => {
//         const index = sortConfigs.findIndex(c => c.field === field);
//         if (index === -1) return null;

//         const config = sortConfigs[index];
//         const arrow = config.direction === 'asc' ? '↑' : '↓';
//         const number = sortConfigs.length > 1 ? ` ${index + 1}` : '';

//         return (
//             <span className="ml-1 text-blue-400 font-bold">
//                 {arrow}{number}
//             </span>
//         );
//     };

//     useEffect(() => {
//         containerRef.current?.focus();
//     }, []);

//     const handleKeyDown = (e: React.KeyboardEvent) => {
//         switch (e.key) {
//             case 'ArrowDown':
//                 e.preventDefault();
//                 setFocusedIndex((prev) => Math.min(prev + 1, sortedResults.length - 1));
//                 break;
//             case 'ArrowUp':
//                 e.preventDefault();
//                 setFocusedIndex((prev) => Math.max(prev - 1, 0));
//                 break;
//         }
//     };

//     useEffect(() => {
//         itemRefs.current[focusedIndex]?.scrollIntoView({
//             block: 'nearest',
//             behavior: 'smooth'
//         });
//     }, [focusedIndex]);

//     const getStatusColor = (status: string) => {
//         switch (status) {
//             case 'completed': return 'text-green-400';
//             case 'error': return 'text-red-400';
//             case 'pending': return 'text-yellow-400';
//             default: return 'text-gray-400';
//         }
//     };

//     const getStatusCodeColor = (code: number) => {
//         if (code >= 200 && code < 300) return 'text-green-400';
//         if (code >= 300 && code < 400) return 'text-blue-400';
//         if (code >= 400 && code < 500) return 'text-yellow-400';
//         return 'text-red-400';
//     };

//     const getStatusIcon = (status: string) => {
//         switch (status) {
//             case 'completed': return '✓';
//             case 'error': return '✗';
//             case 'pending': return '⏳';
//             default: return '?';
//         }
//     };

//     if (results.length === 0) {
//         return (
//             <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex items-center justify-center">
//                 <div className="text-center text-gray-500 py-8">
//                     {isLoading ? (
//                         <div className="flex items-center gap-2">
//                             <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
//                             <span>Processing requests...</span>
//                         </div>
//                     ) : (
//                         <div>
//                             <p className="text-lg mb-2">No requests sent yet</p>
//                             <p className="text-sm text-gray-600">Configure your request and click "Run" to begin</p>
//                         </div>
//                     )}
//                 </div>
//             </div>
//         );
//     }

//     return (
//         <div className="flex-1 flex flex-col gap-4 overflow-hidden">
//             {/* Results List */}
//             <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex flex-col min-h-0">


//                 {/* Table Header */}
//                 <div className="px-2 py-3 border-b border-gray-800 bg-gray-950 flex-shrink-0">
//                     <div className="grid grid-cols-12 gap-2 px-3 text-xs font-semibold text-gray-400 uppercase">
//                         <button
//                             onClick={(e) => handleSort('statusCode', e.shiftKey)}
//                             className="col-span-1 text-left hover:text-white transition-colors"
//                         >
//                             Status{getSortIndicator('statusCode')}
//                         </button>
//                         <button
//                             onClick={(e) => handleSort('method', e.shiftKey)}
//                             className="col-span-1 text-left hover:text-white transition-colors"
//                         >
//                             Method{getSortIndicator('method')}
//                         </button>
//                         <button
//                             onClick={(e) => handleSort('url', e.shiftKey)}
//                             className="col-span-4 text-left hover:text-white transition-colors"
//                         >
//                             URL{getSortIndicator('url')}
//                         </button>
//                         <div className="col-span-3">Payload</div>
//                         <button
//                             onClick={(e) => handleSort('responseTime', e.shiftKey)}
//                             className="col-span-2 text-left hover:text-white transition-colors"
//                         >
//                             Time{getSortIndicator('responseTime')}
//                         </button>
//                         <button
//                             onClick={(e) => handleSort('contentLength', e.shiftKey)}
//                             className="col-span-1 text-right hover:text-white transition-colors"
//                         >
//                             Size{getSortIndicator('contentLength')}
//                         </button>
//                     </div>
//                 </div>

//                 <div
//                     ref={containerRef}
//                     tabIndex={0}
//                     onKeyDown={handleKeyDown}
//                     className="flex-1 overflow-y-auto p-2 focus:outline-none min-h-0 max-h-56"
//                 >
//                     <div className="space-y-1">
//                         {sortedResults.map((result, index) => {
//                             const isFocused = focusedIndex === index;

//                             return (
//                                 <div
//                                     key={`${result.targetUrl}-${index}`}
//                                     ref={(el) => (itemRefs.current[index] = el)}
//                                     onClick={() => setFocusedIndex(index)}
//                                     className={`
//                                         p-3 rounded-md cursor-pointer transition-all duration-150
//                                         ${isFocused
//                                             ? 'bg-blue-600 border-blue-500'
//                                             : 'bg-gray-900 border-gray-800'
//                                         }
//                                         border
//                                     `}
//                                 >
//                                     <div className="grid grid-cols-12 gap-2 items-center text-sm">
//                                         <div className="col-span-1">
//                                             <span className={`font-mono font-semibold ${isFocused ? 'text-white' : result.parsedResponse ? getStatusCodeColor(result.parsedResponse.statusCode) : 'text-gray-400'}`}>
//                                                 {result.parsedResponse?.statusCode || '-'}
//                                             </span>
//                                         </div>

//                                         <div className="col-span-1">
//                                             <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-400'}`}>
//                                                 {result.parsedRequest.method}
//                                             </span>
//                                         </div>

//                                         <div className="col-span-4">
//                                             <span className={`font-mono text-xs truncate block ${isFocused ? 'text-white' : 'text-gray-300'}`}>
//                                                 {result.parsedRequest.path}
//                                             </span>
//                                         </div>

//                                         <div className="col-span-3">
//                                             <span className={`font-mono text-xs truncate block ${isFocused ? 'text-blue-100' : 'text-gray-400'}`}>
//                                                 {result.parsedRequest.body.substring(0, 50) || '-'}
//                                             </span>
//                                         </div>

//                                         <div className="col-span-2">
//                                             <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-500'}`}>
//                                                 {result.response?.responseTime ? `${result.response.responseTime}ms` : '-'}
//                                             </span>
//                                         </div>

//                                         <div className="col-span-1 text-right">
//                                             <span className={`font-mono text-xs ${isFocused ? 'text-blue-100' : 'text-gray-500'}`}>
//                                                 {result.contentLength || '-'}
//                                             </span>
//                                         </div>
//                                     </div>
//                                 </div>
//                             );
//                         })}
//                     </div>
//                 </div>

//                 <div className="p-2 border-t border-gray-800 text-xs text-gray-600 text-center flex-shrink-0">
//                     Use ↑↓ arrows to navigate • Click headers to sort • Hold Shift to sort by multiple columns
//                 </div>
//             </div>

//             {/* Request/Response Viewer - Bottom */}
//             {focusedResult && (
//                 <div className="h-80 flex gap-4 flex-shrink-0">
//                     {/* Request Panel */}
//                     <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex flex-col min-w-0">
//                         <div className="p-3 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
//                             <h3 className="text-sm font-semibold text-white">Request</h3>
//                             <span className="text-xs text-gray-500 font-mono">{focusedResult.parsedRequest.method}</span>
//                         </div>
//                         <div className="flex-1 overflow-auto p-4 min-h-0">
//                             <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
//                                 {focusedResult.request}
//                             </pre>
//                         </div>
//                     </div>

//                     {/* Response Panel */}
//                     <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex flex-col min-w-0">
//                         <div className="p-3 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
//                             <h3 className="text-sm font-semibold text-white">Response</h3>
//                             <div className="flex items-center gap-3">
//                                 {focusedResult.parsedResponse && (
//                                     <span className={`text-xs font-mono font-semibold ${getStatusCodeColor(focusedResult.parsedResponse.statusCode)}`}>
//                                         {focusedResult.parsedResponse.statusCode}
//                                     </span>
//                                 )}
//                                 {focusedResult.response?.responseTime && (
//                                     <span className="text-xs text-gray-500">{focusedResult.response.responseTime}ms</span>
//                                 )}
//                                 {focusedResult.contentLength > 0 && (
//                                     <span className="text-xs text-gray-500">{focusedResult.contentLength} bytes</span>
//                                 )}
//                             </div>
//                         </div>
//                         <div className="flex-1 overflow-auto p-4 min-h-0">
//                             <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
//                                 {focusedResult.response?.response || 'No response available'}
//                             </pre>
//                         </div>
//                     </div>
//                 </div>
//             )}
//         </div>
//     );
// };

// export default ResultsTable;

import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
// import { http } from '@codemirror/legacy-modes/mode/http';
import { oneDark } from '@codemirror/theme-one-dark';
import { http } from './http-parser.component';


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

const CodeMirrorEditor: React.FC<{ value: string }> = ({ value }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (editorRef.current && !viewRef.current) {
            const state = EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    // StreamLanguage.define(http),
                    //         extensions: [
                    //     basicSetup,
                    //     http(),
                    //     javascript(),
                    //     fullHeightTheme,
                    //     updateListener,
                    //     fuzzerHighlighter,
                    //     readOnlyTransactionFilter,
                    // ],
                    EditorView.lineWrapping,
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