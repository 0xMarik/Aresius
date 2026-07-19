import { useAppSelector } from '@/hooks/redux';
import ResultsTable, { CodeMirrorEditor } from './result-table.components';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';

import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import Table, { isRowSelected, FacetFilter, BaseRow } from '@/components/Table';
import { FuzzerRequest } from '@/types/fuzzer.type';
import { useMemo, useState } from 'react';
import { parseRequest, parseResponse } from './utils';
// import { FuzzerRequest } from './types'; // adjust to wherever FuzzerRequest/FuzzerResponse live

export type FuzzerRow = FuzzerRequest & BaseRow;

export function adaptFuzzerRequests(requests: FuzzerRequest[]): FuzzerRow[] {
    return requests.map((r, idx) => ({ ...r, id: idx }));
}

function statusBadgeColor(status: FuzzerRequest['status'], selected: boolean) {
    if (selected) return 'bg-white/15 text-white';
    const colors: Record<FuzzerRequest['status'], string> = {
        pending: 'bg-[#F6EEDD] text-[#8A6A2E]',
        completed: 'bg-[#E7EFEA] text-[#3C7A5A]',
        error: 'bg-[#F4E4DE] text-[#C0392B]',
    };
    return colors[status];
}

function codeColor(code: number | undefined, selected: boolean) {
    if (selected) return 'text-white';
    if (code === undefined) return 'text-[#9A9A90]';
    if (code < 300) return 'text-[#3C7A5A]';
    if (code < 400) return 'text-[#8A6A2E]';
    if (code < 500) return 'text-[#B23A2E]';
    return 'text-[#C0392B]';
}

const columnHelper = createColumnHelper<FuzzerRow>();

export const fuzzerColumns: ColumnDef<FuzzerRow, any>[] = [
    columnHelper.accessor('id', {
        id: 'id',
        header: 'ID',
        size: 56,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] ${selected ? 'text-white/80' : 'text-[#9A9A90]'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('targetUrl', {
        id: 'targetUrl',
        header: 'Target URL',
        size: 340,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-white' : 'text-[#1B211E]'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('status', {
        id: 'status',
        header: 'Status',
        size: 100,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${statusBadgeColor(info.getValue(), selected)}`}>
                    {info.getValue()}
                </span>
            );
        },
    }),
    columnHelper.accessor((row: any) => row.response?.statusCode, {
        id: 'responseCode',
        header: 'Code',
        size: 64,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold ${codeColor(value, selected)}`}>{value ?? '—'}</span>;
        },
    }),
    columnHelper.accessor((row: any) => row.response?.duration, {
        id: 'duration',
        header: 'Duration',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>{value !== undefined ? `${value}ms` : '—'}</span>;
        },
    }),
    columnHelper.accessor((row: any) => row.response?.length, {
        id: 'length',
        header: 'Length',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>{value !== undefined ? `${value}B` : '—'}</span>;
        },
    }),
    columnHelper.accessor('requestDate', {
        id: 'requestDate',
        header: 'Time',
        size: 96,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>
                    {new Date(info.getValue()).toLocaleTimeString()}
                </span>
            );
        },
    }),
];

export const fuzzerFacetFilters: FacetFilter<FuzzerRow>[] = [
    { id: 'status', label: 'Status', getValue: (r) => r.status },
];

export const fuzzerSearchFn = (row: FuzzerRow, q: string) =>
    row.targetUrl.toLowerCase().includes(q) ||
    row.status.toLowerCase().includes(q) ||
    // String(row.response?.statusCode ?? '').includes(q);
    String("row.response?.statusCode").includes(q);

export type FocusedFuzzerResult = FuzzerRow & {
    parsedRequest: ReturnType<typeof parseRequest>;
    parsedResponse: ReturnType<typeof parseResponse> | null;
    contentLength: number;
};

export function enrichFuzzerRow(row: FuzzerRow): FocusedFuzzerResult {
    return {
        ...row,
        parsedRequest: parseRequest(row.request),
        parsedResponse: row.response ? parseResponse(row.response.response) : null,
        contentLength: row.response?.response?.length ?? 0,
    };
}

export function getStatusCodeColor(code: number | undefined) {
    if (code === undefined) return 'text-gray-500';
    if (code < 300) return 'text-green-400';
    if (code < 400) return 'text-yellow-400';
    if (code < 500) return 'text-orange-400';
    return 'text-red-400';
}
interface ParamsType {
    isLoading: boolean
}

const FuzzerHistoryCompo = ({ isLoading }: ParamsType) => {
    const { fuzzerSessions, activeSessionIndex } = useAppSelector((state) => state.fuzzerstate);
    const [focusedId, setFocusedId] = useState<number | null>(null);

    if (activeSessionIndex === null) {
        return <div>No active session selected</div>;
    }

    const session = fuzzerSessions[activeSessionIndex];

    if (!session) {
        return <div>Session not found</div>;
    }

    const { selectedHistoryIndex } = session;

    if (selectedHistoryIndex === null) {
        return <div>No history entry selected</div>;
    }

    const historyEntry = session.fuzzingHistory[selectedHistoryIndex];

    if (!historyEntry) {
        return <div>History entry not found</div>;
    }

    return (
        <FuzzerHistoryBody
            requests={historyEntry.requests}
            isLoading={isLoading}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
        />
    );
};

/** Split into its own component so hooks below aren't called conditionally
 *  relative to the early returns above. */
function FuzzerHistoryBody({
    requests,
    isLoading,
    focusedId,
    setFocusedId,
}: {
    requests: FuzzerRow[] extends never ? never : Parameters<typeof adaptFuzzerRequests>[0];
    isLoading: boolean;
    focusedId: number | null;
    setFocusedId: (id: number | null) => void;
}) {
    const rows = useMemo(() => adaptFuzzerRequests(requests), [requests]);

    const focusedResult = useMemo(() => {
        if (focusedId === null) return null;
        const raw = rows.find((r) => r.id === focusedId);
        return raw ? enrichFuzzerRow(raw) : null;
    }, [focusedId, rows]);

    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
            <ReactSplit
                direction={SplitDirection.Vertical}
                initialSizes={focusedResult ? [40, 45] : [100]}
                minHeights={focusedResult ? [100, 100] : [100]}
                gutterClassName="bg-gray-800 hover:bg-gray-700"
            >
                <Table
                    data={rows}
                    columns={fuzzerColumns}
                    facetFilters={fuzzerFacetFilters}
                    searchFn={fuzzerSearchFn}
                    searchPlaceholder="Search target URL, status, code…"
                    emptyLabel={isLoading ? 'Running fuzzer…' : 'No fuzzing results yet'}
                    emptyHint={isLoading ? undefined : 'Run the fuzzer to see results here'}
                    setSelectedRequest={setFocusedId}
                />

                {focusedResult && (
                    <ReactSplit
                        direction={SplitDirection.Horizontal}
                        initialSizes={[50, 50]}
                        minWidths={[200, 200]}
                        gutterClassName="bg-gray-800 hover:bg-gray-700"
                    >
                        {/* Request Panel */}
                        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 p-2">
                                <h3 className="text-xs font-semibold text-white">Request</h3>
                                <span className="font-mono text-xs text-gray-500">{focusedResult.parsedRequest.method}</span>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <CodeMirrorEditor value={focusedResult.request} />
                            </div>
                        </div>

                        {/* Response Panel */}
                        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 p-2">
                                <h3 className="text-xs font-semibold text-white">Response</h3>
                                <div className="flex items-center gap-2">
                                    {focusedResult.parsedResponse && (
                                        <span className={`font-mono text-xs font-semibold ${getStatusCodeColor(focusedResult.parsedResponse.statusCode)}`}>
                                            {focusedResult.parsedResponse.statusCode}
                                        </span>
                                    )}
                                    {focusedResult.response?.responseTime !== undefined && (
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
}

export default FuzzerHistoryCompo;