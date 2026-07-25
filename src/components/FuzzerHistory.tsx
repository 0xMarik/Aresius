import { useAppSelector } from '@/hooks/redux';
import { CodeMirrorEditor } from './result-table.components';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import Table, { isRowSelected, FacetFilter, BaseRow } from '@/components/Table';
import { FuzzerRequest, FuzzerParameter, FuzzConfig } from '@/types/fuzzer.type';
import { useMemo, useState } from 'react';
import { parseRequest, parseResponse } from './utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { renderFuzzerHistoryTableContextMenu } from './FuzzerHistoryTableContextMenu';

/**
 * Each row corresponds to a single FuzzerRequest (one fuzzed HTTP call),
 * not a whole FuzzingHistory entry. The template/parameters used to
 * reconstruct payload values always come from the fuzzConfigSnapshot
 * captured on the history entry at run time -- never from the live
 * session.fuzzConfig, which may have since changed.
 */
export type FuzzerRow = FuzzerRequest & BaseRow;

export type EnrichedFuzzerRow = FuzzerRow & {
    parsedRequest: ReturnType<typeof parseRequest>;
    parsedResponse: ReturnType<typeof parseResponse> | null;
    contentLength: number;
    statusCode: number | undefined;
    targetUrl: string;
    // One entry per fuzzed parameter, in the order they appear in the request.
    payloadValues: { id: string; value: string }[];
    payloadPreview: string;
};

export function adaptFuzzerRequests(requests: FuzzerRequest[]): FuzzerRow[] {
    return requests.map((r, idx) => ({ ...r, id: idx }));
}

/**
 * Reconstructs the actual value(s) injected into a fuzzed request by
 * diffing the literal (non-highlighted) segments of the raw template
 * against the sent request. This works regardless of fuzzing attack type
 * (rotator/echo/zipped/combinatorial) since it doesn't rely on replaying
 * the iteration logic -- it just reads back what was actually sent.
 */
function extractPayloadValues(
    rawRequest: string,
    actualRequest: string,
    parameters: FuzzerParameter[],
): { id: string; value: string }[] {
    if (!parameters.length || !rawRequest) return [];

    const sorted = [...parameters].sort((a, b) => a.highlightRange.byteFrom - b.highlightRange.byteFrom);

    // Literal text between/around highlight ranges -- guaranteed unchanged by fuzzing.
    const segments: string[] = [];
    segments.push(rawRequest.slice(0, sorted[0].highlightRange.byteFrom));
    for (let i = 0; i < sorted.length - 1; i++) {
        segments.push(rawRequest.slice(sorted[i].highlightRange.byteTo, sorted[i + 1].highlightRange.byteFrom));
    }
    segments.push(rawRequest.slice(sorted[sorted.length - 1].highlightRange.byteTo));

    if (!actualRequest.startsWith(segments[0])) {
        // Template drifted from what was actually sent (e.g. request was hand-edited
        // after the fuzz config was built) -- can't safely diff, bail out.
        return sorted.map((p) => ({ id: p.highlightRange.id, value: '(unavailable)' }));
    }

    const values: { id: string; value: string }[] = [];
    let cursor = segments[0].length;

    for (let i = 0; i < sorted.length; i++) {
        const nextSeg = segments[i + 1];
        let endIdx: number;
        if (nextSeg.length > 0) {
            endIdx = actualRequest.indexOf(nextSeg, cursor);
            if (endIdx === -1) endIdx = actualRequest.length;
        } else {
            endIdx = actualRequest.length;
        }
        values.push({ id: sorted[i].highlightRange.id, value: actualRequest.slice(cursor, endIdx) });
        cursor = endIdx + nextSeg.length;
    }

    return values;
}

export function enrichFuzzerRow(
    row: FuzzerRow,
    fuzzConfigSnapshot: FuzzConfig,
): EnrichedFuzzerRow {
    const parsedRequest = parseRequest(row.rawRequest);
    const parsedResponse = row.response ? parseResponse(row.response.rawResponse) : null;

    const payloadValues = extractPayloadValues(
        fuzzConfigSnapshot.rawRequest,
        row.rawRequest,
        fuzzConfigSnapshot.parameters,
    );

    return {
        ...row,
        parsedRequest,
        parsedResponse,
        contentLength: row.response?.rawResponse?.length ?? 0,
        statusCode: parsedResponse?.statusCode,
        targetUrl: fuzzConfigSnapshot.metadata.targetUrl,
        payloadValues,
        payloadPreview:
            payloadValues.length <= 1
                ? (payloadValues[0]?.value ?? '')
                : payloadValues.map((p) => p.value).join(',  '),
    };
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

export function getStatusCodeColor(code: number | undefined) {
    if (code === undefined) return 'text-gray-500';
    if (code < 300) return 'text-green-400';
    if (code < 400) return 'text-yellow-400';
    if (code < 500) return 'text-orange-400';
    return 'text-red-400';
}

const columnHelper = createColumnHelper<EnrichedFuzzerRow>();

export const fuzzerColumns: ColumnDef<EnrichedFuzzerRow, any>[] = [
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
        size: 220,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-white' : 'text-[#1B211E]'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('payloadPreview', {
        id: 'payload',
        header: 'Payload',
        size: 240,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`truncate font-mono text-[12px] ${selected ? 'text-white/90' : 'text-[#1B211E]'}`} title={value}>
                    {value || '—'}
                </span>
            );
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
    columnHelper.accessor('statusCode', {
        id: 'responseCode',
        header: 'Code',
        size: 64,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold ${codeColor(value, selected)}`}>{value ?? '—'}</span>;
        },
    }),
    columnHelper.accessor((row) => row.response?.responseTime, {
        id: 'duration',
        header: 'Duration',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>{value !== undefined ? `${value}ms` : '—'}</span>;
        },
    }),
    columnHelper.accessor('contentLength', {
        id: 'length',
        header: 'Length',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>{value > 0 ? `${value}B` : '—'}</span>;
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

export const fuzzerFacetFilters: FacetFilter<EnrichedFuzzerRow>[] = [
    { id: 'status', label: 'Status', getValue: (r) => r.status },
];

export const fuzzerSearchFn = (row: EnrichedFuzzerRow, q: string) =>
    row.targetUrl.toLowerCase().includes(q) ||
    row.status.toLowerCase().includes(q) ||
    row.payloadPreview.toLowerCase().includes(q) ||
    String(row.statusCode ?? '').includes(q);

interface ParamsType {
    isLoading: boolean;
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
            fuzzConfigSnapshot={historyEntry.fuzzConfigSnapshot}
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
    fuzzConfigSnapshot,
    isLoading,
    focusedId,
    setFocusedId,
}: {
    requests: FuzzerRequest[];
    fuzzConfigSnapshot: FuzzConfig;
    isLoading: boolean;
    focusedId: number | null;
    setFocusedId: (id: number | null) => void;
}) {
    const rows = useMemo(() => adaptFuzzerRequests(requests), [requests]);

    const enrichedRows = useMemo(
        () => rows.map((r) => enrichFuzzerRow(r, fuzzConfigSnapshot)),
        [rows, fuzzConfigSnapshot],
    );

    const focusedResult = useMemo(() => {
        if (focusedId === null) return null;
        return enrichedRows.find((r) => r.id === focusedId) ?? null;
    }, [focusedId, enrichedRows]);

    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
            <ResizablePanelGroup direction='vertical' autoSaveId="fuzzing-history-table" >
                <ResizablePanel defaultSize={30} minSize={15}>
                    <Table
                        data={enrichedRows}
                        columns={fuzzerColumns}
                        facetFilters={fuzzerFacetFilters}
                        searchFn={fuzzerSearchFn}
                        searchPlaceholder="Search target URL, payload, status, code…"
                        emptyLabel={isLoading ? 'Running fuzzer…' : 'No fuzzing results yet'}
                        emptyHint={isLoading ? undefined : 'Run the fuzzer to see results here'}
                        setSelectedRequest={setFocusedId}
                        renderRowContextMenu={renderFuzzerHistoryTableContextMenu}
                    />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={70} minSize={15}>
                    <div className='h-full'>

                        {focusedResult && (
                            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-history-req-res" >
                                <ResizablePanel defaultSize={50} minSize={15}>
                                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                                        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 p-2">
                                            <h3 className="text-xs font-semibold text-white">Request</h3>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs text-gray-500">{focusedResult.parsedRequest.method}</span>
                                                {focusedResult.payloadValues.length > 0 && (
                                                    <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] text-gray-300">
                                                        {focusedResult.payloadValues.length === 1
                                                            ? focusedResult.payloadValues[0].value
                                                            : focusedResult.payloadValues.map((p) => p.value).join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <CodeMirrorEditor value={focusedResult.rawRequest} />
                                        </div>
                                    </div>
                                </ResizablePanel>
                                <ResizableHandle />
                                <ResizablePanel defaultSize={50} minSize={15}>
                                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                                        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 p-2">
                                            <h3 className="text-xs font-semibold text-white">Response</h3>
                                            <div className="flex items-center gap-2">
                                                {focusedResult.statusCode !== undefined && (
                                                    <span className={`font-mono text-xs font-semibold ${getStatusCodeColor(focusedResult.statusCode)}`}>
                                                        {focusedResult.statusCode}
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
                                            <CodeMirrorEditor value={focusedResult.response?.rawResponse || 'No response available'} />
                                        </div>
                                    </div>
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        )
                        }

                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div >
    );
}

export default FuzzerHistoryCompo;