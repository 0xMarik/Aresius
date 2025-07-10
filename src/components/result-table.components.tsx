// import { useState } from "react";

// export interface RequestResult {
//     id: string;
//     request: string;
//     response: string;
//     status: 'pending' | 'completed' | 'error';
//     requestDate: string;
// }

// const ResultsTable: React.FC<{
//     results: RequestResult[];
//     isLoading: boolean;
//     onClearResults: () => void;
// }> = ({ results, isLoading, onClearResults }) => {
//     const [selectedRequest, setSelectedRequest] = useState<RequestResult | null>(null);


//     const getStatusColor = (status: string): string => {
//         switch (status) {
//             case 'completed': return 'text-green-600';
//             case 'error': return 'text-red-600';
//             case 'pending': return 'text-yellow-600';
//             default: return 'text-gray-600';
//         }
//     };

//     const getStatusIcon = (status: string): string => {
//         switch (status) {
//             case 'completed': return '✓';
//             case 'error': return '✗';
//             case 'pending': return '⏳';
//             default: return '?';
//         }
//     };

//     return (
//         <div className="flex flex-col h-full">
//             <div className="flex items-center justify-between mb-4">
//                 <h3 className="text-lg font-bold">Request Results ({results.length})</h3>
//                 <div className="flex gap-2">
//                     {isLoading && (
//                         <div className="flex items-center text-sm text-gray-600">
//                             <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
//                             Processing...
//                         </div>
//                     )}
//                     {results.length > 0 && (
//                         <button
//                             onClick={onClearResults}
//                             className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
//                             disabled={isLoading}
//                         >
//                             Clear Results
//                         </button>
//                     )}
//                 </div>
//             </div>

//             <div className="flex-1 overflow-hidden">
//                 {results.length === 0 ? (
//                     <div className="text-center text-gray-500 py-8">
//                         No requests sent yet. Configure your request and click "Run" to begin.
//                     </div>
//                 ) : (
//                     <div className="h-full border border-gray-300 rounded overflow-hidden">
//                         <div className="overflow-auto h-full">
//                             <table className="w-full">
//                                 <thead className="bg-gray-50 sticky top-0">
//                                     <tr>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
//                                             #
//                                         </th>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
//                                             Status
//                                         </th>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
//                                             Time
//                                         </th>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                                             Request Preview
//                                         </th>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                                             Response Preview
//                                         </th>
//                                         <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
//                                             Actions
//                                         </th>
//                                     </tr>
//                                 </thead>
//                                 <tbody className="bg-white divide-y divide-gray-200">
//                                     {results.map((result, index) => (
//                                         <tr key={result.id} className="hover:bg-gray-50">
//                                             <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
//                                                 {index + 1}
//                                             </td>
//                                             <td className="px-4 py-2 whitespace-nowrap text-sm">
//                                                 <span className={`${getStatusColor(result.status)} font-medium`}>
//                                                     {getStatusIcon(result.status)} {result.status}
//                                                 </span>
//                                             </td>
//                                             <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
//                                                 {new Date(result.requestDate).toLocaleTimeString()}
//                                             </td>
//                                             <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
//                                                 <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
//                                                     {result.request.split('\n')[0]}
//                                                 </div>
//                                             </td>
//                                             <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
//                                                 <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
//                                                     {result.response.substring(0, 100)}...
//                                                 </div>
//                                             </td>
//                                             <td className="px-4 py-2 whitespace-nowrap text-sm">
//                                                 <button
//                                                     onClick={() => setSelectedRequest(result)}
//                                                     className="text-blue-600 hover:text-blue-900 text-xs"
//                                                 >
//                                                     View
//                                                 </button>
//                                             </td>
//                                         </tr>
//                                     ))}
//                                 </tbody>
//                             </table>
//                         </div>
//                     </div>
//                 )}
//             </div>

//             {/* Request/Response Detail Modal */}
//             {selectedRequest && (
//                 <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
//                     <div className="bg-white rounded-lg w-4/5 h-4/5 flex flex-col">
//                         <div className="p-4 border-b border-gray-200 flex items-center justify-between">
//                             <h3 className="text-lg font-bold">
//                                 Request #{results.indexOf(selectedRequest) + 1} Details
//                             </h3>
//                             <button
//                                 onClick={() => setSelectedRequest(null)}
//                                 className="text-gray-500 hover:text-gray-700"
//                             >
//                                 ✕
//                             </button>
//                         </div>

//                         <div className="flex-1 flex overflow-hidden">
//                             <div className="w-1/2 p-4 border-r border-gray-200">
//                                 <h4 className="font-semibold mb-2">Request:</h4>
//                                 <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
//                                     {selectedRequest.request}
//                                 </pre>
//                             </div>
//                             <div className="w-1/2 p-4">
//                                 <h4 className="font-semibold mb-2">Response:</h4>
//                                 <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto h-full font-mono">
//                                     {selectedRequest.response}
//                                 </pre>
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             )}
//         </div>
//     );
// };

// export default ResultsTable;

import { useState } from "react";

interface FuzzerResponse {
    response: string;
    responseTime: number;
}

interface FuzzerRequest {
    url: string;
    request: string;
    response: FuzzerResponse | null;
    requestDate: string;
    status: 'pending' | 'completed' | 'error';
}

const ResultsTable: React.FC<{
    results: FuzzerRequest[];
    isLoading: boolean;
}> = ({ results, isLoading}) => {
    const [selectedRequest, setSelectedRequest] = useState<FuzzerRequest | null>(null);

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
                                            URL
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Request Preview
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Response Preview
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                                            Response Time
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {results.map((result, index) => (
                                        <tr key={`${result.url}-${index}`} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                                                {index + 1}
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                <span className={`${getStatusColor(result.status)} font-medium`}>
                                                    {getStatusIcon(result.status)} {result.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                                {new Date(result.requestDate).toLocaleTimeString()}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                                <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
                                                    {result.url}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                                <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
                                                    {result.request.split('\n')[0]}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                                <div className="truncate font-mono text-xs bg-gray-100 p-1 rounded">
                                                    {result.response?.response?.substring(0, 100) || 'No response'}...
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                                {result.response?.responseTime ? `${result.response.responseTime}ms` : '-'}
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
                            <div>
                                <h3 className="text-lg font-bold">
                                    Request #{results.indexOf(selectedRequest) + 1} Details
                                </h3>
                                <p className="text-sm text-gray-600">
                                    URL: {selectedRequest.url}
                                    {selectedRequest.response?.responseTime && (
                                        <span className="ml-4">Response Time: {selectedRequest.response.responseTime}ms</span>
                                    )}
                                </p>
                            </div>
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
                                    {selectedRequest.response?.response || 'No response available'}
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultsTable;