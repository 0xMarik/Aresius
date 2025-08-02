
import { useRef, useEffect, useState } from 'react';
import { EditorView, } from 'codemirror';

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
// import ResultsTable from '@/components/result-table.components';
import { addFuzzingHistory, setTargerUrl } from '@/store/slices/fuzzerSlice';
import FuzzSession from '@/components/fuzz-session.component';
import { FuzzerHistory, FuzzerPayload, FuzzerRequest } from '@/types/fuzzer.type';
import { Link, Route, Routes } from 'react-router-dom';
import FuzzerHistoryCompo from '@/components/history.component';
import FuzzRequestPayload from '@/components/fuzz-request-payloads.component';

// Type definitions
interface AsyncResponse {
    request_id: string;
}

interface RequestCompletedPayload {
    request_id: string;
    result?: string;
    error?: string;
    response_time?: number;
}

interface FuzzParameter {
    id: string;
    placeholder: string;
    originalText: string;
    values: string[];
    payloadType: 'manual' | 'hosted-file' | 'generator';
    selectedFile?: string;
}

interface PendingRequest {
    requestId: string;
    sessionId: string;
    index: number;
}

const Fuzzer: React.FC = () => {
    const [isLoading, setIsLoading] = useState<boolean>(false);

    // Current session results - reset for each new fuzz session
    const [currentSessionResults, setCurrentSessionResults] = useState<FuzzerRequest[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string>('');

    // Store active requests for current session only
    const activeRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
    const dispatch = useAppDispatch()


    const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate)


    // Save current session results to history when completed
    useEffect(() => {
        if (activeSessionIndex === null) return;
        if (activeRequestsRef.current.size !== 0) return; // if there are still pending requests
        if (currentSessionResults.length === 0) return; // don't add empty history
        if (!currentSessionId) return; // don't add without session ID
        if (isLoading) return;

        const historyTmp: FuzzerHistory = {
            date: Date.now(),
            requests: currentSessionResults.map(request => ({
                request: request.request,
                requestDate: request.requestDate,
                status: request.status,
                targetUrl: request.targetUrl,
                response: request.response || {
                    response: '',
                    responseTime: 0
                },
            })),
        }

        dispatch(addFuzzingHistory({ sessionIndex: activeSessionIndex, history: historyTmp }))
    }, [currentSessionResults, dispatch, activeSessionIndex, currentSessionId])

    const triggerFuzzing = async () => {
        if (activeSessionIndex === null) return;
        if (!fuzzerSessions[activeSessionIndex]) return;

        const { payload } = fuzzerSessions[activeSessionIndex]

        // const payload: FuzzerPayload = {
        //     metadata: {
        //         targetUrl: "http://google.com"
        //     },
        //     parameters: [{
        //         name: "FUZZ",
        //         payloadSource: 'manual',
        //         replacedValue: "/",
        //         values: ["/page", "/"]
        //     }],
        //     rawRequest: "GET / HTTP/1.1\n\n",
        // }

        invoke<any>("greet", { content: payload, sessionIndex: activeSessionIndex });
        console.log({ payload })
    }

    return (
        <div className="py-1 pr-1 h-full">
            <ReactSplit
                direction={SplitDirection.Horizontal}
                gutterClassName="custom-gutter-horizontal"
                draggerClassName="custom-dragger-horizontal"
                initialSizes={[20, 80]}
            >
                <FuzzSession />
                <div className='flex flex-col gap-1 h-full'>
                    <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
                        {
                            activeSessionIndex !== null && fuzzerSessions[activeSessionIndex]?.fuzzingHistory.map((history, index) => (
                                <Link key={index} to={`/fuzzer/history/${index}`} className='text-sm'>
                                    {new Date(history.date).toISOString()}
                                    <Button className='size-4 text-sm'>X</Button>
                                </Link>))
                        }
                    </div>
                    {/* todo abstract this so it can ferify active session */}
                    <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
                        <Input
                            onChange={(e) => dispatch(setTargerUrl({ targetUrl: e.target.value }))}
                            value={fuzzerSessions[activeSessionIndex || 0].payload.metadata.targetUrl}
                            placeholder="http://example.com"
                        />
                        <Button
                            onClick={triggerFuzzing}
                            disabled={isLoading}
                            className="p-4  text-white rounded disabled:bg-gray-400"
                        >
                            {isLoading ? "..." : "Run"}
                        </Button>
                    </div>
                    <Routes>
                        <Route path="history/:historyId" element={<FuzzerHistoryCompo
                            isLoading={isLoading}
                        />} />
                        <Route path="session/:sessionIndex" element={

                            <FuzzRequestPayload
                            />
                        } />
                        <Route path="*" element={<h1>Choose a session</h1>} />
                    </Routes>
                </div>
            </ReactSplit>

            {/* <div className='bg-muted/50 aspect-video rounded-lg p-1 w-full h-90'>
                Uncomment and pass currentSessionResults when you want to use the ResultsTable component */}
            {/* <ResultsTable
                    isLoading={isLoading}
                    results={currentSessionResults}
                /> 
            </div>*/}
            {/* 
            <div className="flex gap-2 mb-4 mt-4">
                {isLoading && (
                    <button
                        onClick={cancel_request}
                        className="px-4 py-2 bg-red-500 text-white rounded"
                    >
                        Cancel
                    </button>
                )}
                {currentSessionResults.length > 0 && (
                    <button
                        onClick={clearResults}
                        className="px-4 py-2 bg-gray-500 text-white rounded"
                        disabled={isLoading}
                    >
                        Clear Current Results
                    </button>
                )}
            </div> */}

            {/* {isLoading && (
                <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 rounded">
                    <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-2"></div>
                        {isFuzzMode ?
                            `Fuzzing in progress... (${fuzzResults.length} completed, ${activeRequestsRef.current.size} pending)` :
                            `Request in progress... (Session: ${currentSessionId})`
                        }
                    </div>
                </div>
            )} */}

            {/* {isFuzzMode && fuzzResults.length > 0 && (
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
            )} */}

            {/* {!isFuzzMode && result && (
                <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded">
                    <h4 className="font-semibold mb-2">Result:</h4>
                    <pre className="whitespace-pre-wrap text-sm">{result}</pre>
                </div>
            )} */}
        </div>
    );
};

export default Fuzzer;