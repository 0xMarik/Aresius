import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { selectFuzzerState } from '@/store/slices/fuzzerSlice';
import { CodeMirrorEditor } from '../result-table.components';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import Table, { isRowSelected, BaseRow } from '@/components/Table';
import { FuzzerRequest, FuzzerParameter, FuzzConfig } from '@/types/fuzzer.type';
import { useMemo, useState } from 'react';
import { parseRequest, parseResponse } from '../utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import { renderFuzzerHistoryTableContextMenu } from './FuzzerHistoryTableContextMenu';
import { FuzzerRunToolbar, resendSingleFuzzRequest } from './FuzzerRunToolbar';
import { initialFuzzRunState } from '@/types/fuzzer.type';
import { Button } from '../ui/button';
import { RotateCcw } from 'lucide-react';

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
    if (selected) return 'bg-primary-foreground/15 text-primary-foreground';
    const colors: Record<FuzzerRequest['status'], string> = {
        pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        error: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
        cancelled: 'bg-muted text-muted-foreground',
    };
    return colors[status];
}

function codeColor(code: number | undefined, selected: boolean) {
    if (selected) return 'text-primary-foreground';
    if (code === undefined) return 'text-muted-foreground';
    if (code < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (code < 400) return 'text-amber-600 dark:text-amber-400';
    if (code < 500) return 'text-rose-600 dark:text-rose-400';
    return 'text-red-600 dark:text-red-400';
}

export function getStatusCodeColor(code: number | undefined) {
    if (code === undefined) return 'text-muted-foreground';
    if (code < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (code < 400) return 'text-amber-600 dark:text-amber-400';
    if (code < 500) return 'text-rose-600 dark:text-rose-400';
    return 'text-red-600 dark:text-red-400';
}

const columnHelper = createColumnHelper<EnrichedFuzzerRow>();

export const fuzzerColumns: ColumnDef<EnrichedFuzzerRow, any>[] = [
    columnHelper.accessor('id', {
        id: 'id',
        header: 'ID',
        size: 56,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('targetUrl', {
        id: 'targetUrl',
        header: 'Target URL',
        size: 220,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{info.getValue()}</span>;
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
                <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/90' : 'text-foreground'}`} title={value}>
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
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{value !== undefined ? `${value}ms` : '—'}</span>;
        },
    }),
    columnHelper.accessor('contentLength', {
        id: 'length',
        header: 'Length',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{value > 0 ? `${value}B` : '—'}</span>;
        },
    }),
    columnHelper.accessor('requestDate', {
        id: 'requestDate',
        header: 'Time',
        size: 96,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                    {new Date(info.getValue()).toLocaleTimeString()}
                </span>
            );
        },
    }),
];



export const fuzzerSearchFn = (row: EnrichedFuzzerRow, q: string) =>
    row.targetUrl.toLowerCase().includes(q) ||
    row.status.toLowerCase().includes(q) ||
    row.payloadPreview.toLowerCase().includes(q) ||
    String(row.statusCode ?? '').includes(q);

interface ParamsType {
    isLoading: boolean;
    sessionIndex: number;
    historyIndex: number;
}

const FuzzerHistoryCompo = ({ isLoading, sessionIndex, historyIndex }: ParamsType) => {
    const projectId = useProjectId();
    const { fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
    const [focusedId, setFocusedId] = useState<number | null>(null);

    const session = fuzzerSessions[sessionIndex];
    if (!session) return <div>Session not found</div>;

    const historyEntry = session.fuzzingHistory[historyIndex];
    if (!historyEntry) return <div>History entry not found</div>;

    return (
        <FuzzerHistoryBody
            sessionIndex={sessionIndex}
            historyIndex={historyIndex}
            requests={historyEntry.requests}
            fuzzConfigSnapshot={historyEntry.fuzzConfigSnapshot}
            runState={historyEntry.runState ?? initialFuzzRunState()}
            isLoading={isLoading}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
        />
    );
};

/** Split into its own component so hooks below aren't called conditionally
 *  relative to the early returns above. */
function FuzzerHistoryBody({
    sessionIndex,
    historyIndex,
    requests,
    fuzzConfigSnapshot,
    runState,
    isLoading,
    focusedId,
    setFocusedId,
}: {
    sessionIndex: number;
    historyIndex: number;
    requests: FuzzerRequest[];
    fuzzConfigSnapshot: FuzzConfig;
    runState: import('@/types/fuzzer.type').FuzzRunState;
    isLoading: boolean;
    focusedId: number | null;
    setFocusedId: (id: number | null) => void;
}) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const rows = useMemo(() => adaptFuzzerRequests(requests), [requests]);

    const enrichedRows = useMemo(
        () => rows.map((r) => enrichFuzzerRow(r, fuzzConfigSnapshot)),
        [rows, fuzzConfigSnapshot],
    );

    const focusedResult = useMemo(() => {
        if (focusedId === null) return null;
        return enrichedRows.find((r) => r.id === focusedId) ?? null;
    }, [focusedId, enrichedRows]);

    const failedCount = useMemo(
        () => requests.filter((r) => r.status === 'error' || r.status === 'cancelled' || r.connectionDropped).length,
        [requests],
    );

    const canResendFocused = focusedResult && (
        focusedResult.status === 'error' ||
        focusedResult.status === 'cancelled' ||
        focusedResult.connectionDropped
    ) && focusedResult.rawRequest;

    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
            <FuzzerRunToolbar
                sessionIndex={sessionIndex}
                historyIndex={historyIndex}
                runState={runState}
                targetUrl={fuzzConfigSnapshot.metadata.targetUrl}
                numThreads={fuzzConfigSnapshot.numThreads}
                delayMs={fuzzConfigSnapshot.delayMs}
                failedCount={failedCount}
            />
            <ResizablePanelGroup direction='vertical' autoSaveId="fuzzing-history-table" >
                <ResizablePanel defaultSize={30} minSize={15}>
                    <Table
                        data={enrichedRows}
                        columns={fuzzerColumns}
                        emptyLabel={isLoading ? 'Running fuzzer…' : 'No fuzzing results yet'}
                        emptyHint={isLoading ? undefined : 'Run the fuzzer to see results here'}
                        setSelectedRequest={setFocusedId}
                        renderRowContextMenu={renderFuzzerHistoryTableContextMenu}
                        fillHeight
                    />
                </ResizablePanel>
                <ResizableHandle withHandle />
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
                                <ResizableHandle withHandle />
                                <ResizablePanel defaultSize={50} minSize={15}>
                                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                                        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 p-2">
                                            <h3 className="text-xs font-semibold text-white">Response</h3>
                                            <div className="flex items-center gap-2">
                                                {canResendFocused && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 gap-1 border-gray-700 bg-gray-800 text-[11px] text-gray-200 hover:bg-gray-700"
                                                        onClick={() => resendSingleFuzzRequest(
                                                            dispatch,
                                                            sessionIndex,
                                                            historyIndex,
                                                            focusedResult!.fuzzRequestId,
                                                            focusedResult!.rawRequest,
                                                            fuzzConfigSnapshot.metadata.targetUrl,
                                                            projectId,
                                                        )}
                                                    >
                                                        <RotateCcw className="size-3" />
                                                        Resend
                                                    </Button>
                                                )}
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
                                            {focusedResult.status === 'error' || focusedResult.connectionDropped ? (
                                                <div className="flex h-full flex-col gap-2 p-3">
                                                    <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3">
                                                        <p className="text-xs font-semibold text-red-400">
                                                            {focusedResult.connectionDropped ? 'Connection dropped' : 'Request failed'}
                                                        </p>
                                                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-red-300/90">
                                                            {focusedResult.errorMessage ?? 'Unknown error'}
                                                        </p>
                                                    </div>
                                                    {canResendFocused && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-fit gap-1 border-gray-700 text-gray-200"
                                                            onClick={() => resendSingleFuzzRequest(
                                                                dispatch,
                                                                sessionIndex,
                                                                historyIndex,
                                                                focusedResult.fuzzRequestId,
                                                                focusedResult.rawRequest,
                                                                fuzzConfigSnapshot.metadata.targetUrl,
                                                                projectId,
                                                            )}
                                                        >
                                                            <RotateCcw className="size-3" />
                                                            Resend request
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <CodeMirrorEditor value={focusedResult.response?.rawResponse || 'No response available'} />
                                            )}
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