import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { selectFuzzerState } from '@/store/slices/fuzzerSlice';
import { CodeMirrorEditor } from '../result-table.components';
import { createColumnHelper, ColumnDef, SortingState } from '@tanstack/react-table';
import Table, { isRowSelected, BaseRow } from '@/components/Table';
import { FuzzerRequest, FuzzerParameter, FuzzConfig, initialFuzzRunState } from '@/types/fuzzer.type';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseRequest, parseResponse } from '../utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import { renderFuzzerHistoryTableContextMenu } from './FuzzerHistoryTableContextMenu';
import { FuzzerRunToolbar, resendSingleFuzzRequest } from './FuzzerRunToolbar';
import { Button } from '../ui/button';
import MethodBadge from '@/components/MethodBadge';
import { EmptyState } from '../ui/empty-state';
import { AlertTriangle, Clipboard, RotateCcw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { HttpStatusBadge } from '@/components/HttpStatusBadge';

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

export function adaptFuzzerRequests(requests: FuzzerRequest[], offset = 0): FuzzerRow[] {
    return requests.map((r, idx) => ({
        ...r,
        id: r.id !== undefined ? r.id : (offset + idx),
    }));
}

/**
 * Reconstructs the actual value(s) injected into a fuzzed request by
 * diffing the literal (non-highlighted) segments of the raw template
 * against the sent request. This works regardless of fuzzing attack type
 * (rotator/echo/zipped/combinatorial) since it doesn't rely on replaying
 * the iteration logic -- it just reads back what was actually sent.
 */
function getRangeFrom(p: FuzzerParameter): number {
    return p.highlightRange.byteFrom !== undefined && p.highlightRange.byteFrom !== null
        ? p.highlightRange.byteFrom
        : p.highlightRange.from;
}

function getRangeTo(p: FuzzerParameter): number {
    return p.highlightRange.byteTo !== undefined && p.highlightRange.byteTo !== null
        ? p.highlightRange.byteTo
        : p.highlightRange.to;
}

function extractPayloadValues(
    rawRequest: string,
    actualRequest: string,
    parameters: FuzzerParameter[],
): { id: string; value: string }[] {
    if (!parameters.length || !rawRequest || !actualRequest) return [];

    const sorted = [...parameters].sort((a, b) => getRangeFrom(a) - getRangeFrom(b));

    // Literal text between/around highlight ranges -- guaranteed unchanged by fuzzing.
    const segments: string[] = [];
    segments.push(rawRequest.slice(0, getRangeFrom(sorted[0])));
    for (let i = 0; i < sorted.length - 1; i++) {
        segments.push(rawRequest.slice(getRangeTo(sorted[i]), getRangeFrom(sorted[i + 1])));
    }
    segments.push(rawRequest.slice(getRangeTo(sorted[sorted.length - 1])));

    if (!actualRequest.startsWith(segments[0])) {
        // Fallback: try checking if any known parameter values match
        const fallbackValues = sorted.map((p) => {
            const matchedValue = p.values?.find((v) => v && actualRequest.includes(v));
            return {
                id: p.highlightRange.id,
                value: matchedValue ?? p.highlightRange.originalText ?? '(unavailable)',
            };
        });
        return fallbackValues;
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

export function formatPayloadDisplay(payload: string | null | undefined): string {
    if (!payload) return '';
    try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed)) {
            return parsed.join(',  ');
        }
    } catch {
        // Not a JSON array
    }
    return payload;
}

export function enrichFuzzerRow(
    row: FuzzerRow,
    fuzzConfigSnapshot: FuzzConfig,
): EnrichedFuzzerRow {
    const rawReqStr = row.rawRequest ?? '';
    const rawRespStr = row.response?.rawResponse ?? (row.response as any)?.response ?? '';
    const respTime = row.responseTimeMs ?? row.response?.responseTime ?? (row.response as any)?.responseTime ?? (row.response as any)?.response_time;

    const normalizedResponse = (row.response || rawRespStr || respTime !== undefined) ? {
        rawResponse: rawRespStr,
        responseTime: respTime !== undefined ? Number(respTime) : 0,
    } : null;

    const parsedRequest = parseRequest(rawReqStr || fuzzConfigSnapshot?.rawRequest || '');
    const parsedResponse = normalizedResponse && rawRespStr ? parseResponse(rawRespStr) : null;

    const payloadValues = rawReqStr
        ? extractPayloadValues(
            fuzzConfigSnapshot?.rawRequest ?? '',
            rawReqStr,
            fuzzConfigSnapshot?.parameters ?? [],
        )
        : [];

    const payloadPreview =
        formatPayloadDisplay(row.payload) ||
        (payloadValues.length <= 1
            ? (payloadValues[0]?.value ?? '')
            : payloadValues.map((p) => p.value).join(',  '));

    const statusCode = row.statusCode ?? parsedResponse?.statusCode;
    const contentLength = row.responseLength ?? rawRespStr.length;

    return {
        ...row,
        response: normalizedResponse,
        parsedRequest,
        parsedResponse,
        contentLength,
        statusCode,
        targetUrl: fuzzConfigSnapshot?.metadata?.targetUrl ?? '',
        payloadValues,
        payloadPreview,
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
    columnHelper.accessor((row) => row.responseTimeMs ?? row.response?.responseTime, {
        id: 'duration',
        header: 'Duration',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`font-mono text-[11px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{value !== undefined && value !== null ? `${value}ms` : '—'}</span>;
        },
    }),
    columnHelper.accessor((row) => row.responseLength ?? row.contentLength, {
        id: 'length',
        header: 'Length',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`font-mono text-[11px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{value !== undefined && value > 0 ? `${value}B` : '—'}</span>;
        },
    }),
    columnHelper.accessor('requestDate', {
        id: 'requestDate',
        header: 'Time',
        size: 96,
        cell: (info) => {
            const selected = isRowSelected(info);
            const val = info.getValue();
            let dateObj: Date;
            if (typeof val === 'number') {
                dateObj = new Date(val);
            } else if (val && !isNaN(Number(val))) {
                dateObj = new Date(Number(val));
            } else {
                dateObj = new Date(val);
            }
            const timeStr = !isNaN(dateObj.getTime()) ? dateObj.toLocaleTimeString() : '—';
            return (
                <span className={`font-mono text-[11px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                    {timeStr}
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
    fuzzConfigSnapshot,
    runState,
    isLoading,
    focusedId,
    setFocusedId,
}: {
    sessionIndex: number;
    historyIndex: number;
    fuzzConfigSnapshot: FuzzConfig;
    runState: import('@/types/fuzzer.type').FuzzRunState;
    isLoading: boolean;
    focusedId: number | null;
    setFocusedId: (id: number | null) => void;
}) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const BUFFER = 100;
    const THRESHOLD = 30;

    const [windowState, setWindowState] = useState<{
        offset: number;
        limit: number;
        items: FuzzerRequest[];
        totalFromBackend: number;
    }>({ offset: 0, limit: 250, items: [], totalFromBackend: 0 });

    const [sorting, setSorting] = useState<SortingState>([]);
    const [fetchedFocusedResult, setFetchedFocusedResult] = useState<EnrichedFuzzerRow | null>(null);

    const handleSortingChange = useCallback((updater: any) => {
        setSorting(updater);
        setWindowState((prev) => ({ ...prev, offset: 0 }));
    }, []);

    const handleScrollWindowChange = useCallback((startIdx: number, count: number) => {
        setWindowState((prev) => {
            const currentOffset = prev.offset;
            const currentLimit = prev.limit;
            const currentEnd = currentOffset + currentLimit;
            const visibleEnd = startIdx + count;

            const distFromTop = startIdx - currentOffset;
            const distFromBottom = currentEnd - visibleEnd;

            if (prev.items.length > 0 && distFromTop >= THRESHOLD && distFromBottom >= THRESHOLD) {
                return prev;
            }

            const newOffset = Math.max(0, startIdx - BUFFER);
            const newTargetEnd = startIdx + count + BUFFER;
            const newLimit = newTargetEnd - newOffset;

            if (newOffset === prev.offset && newLimit === prev.limit && prev.items.length > 0) {
                return prev;
            }

            return { ...prev, offset: newOffset, limit: newLimit };
        });
    }, []);

    useEffect(() => {
        let canceled = false;
        const sortBy = sorting[0]?.id ?? null;
        const sortOrder = sorting[0]?.desc ? 'desc' : 'asc';

        invoke<{ total: number; items: FuzzerRequest[] }>('get_fuzzer_history_window', {
            selectedSession: sessionIndex,
            fuzzHistory: historyIndex,
            offset: windowState.offset,
            limit: windowState.limit,
            sortBy,
            sortOrder,
        })
            .then((res) => {
                if (canceled) return;
                if (res && res.items) {
                    setWindowState((prev) => ({
                        ...prev,
                        items: res.items,
                        totalFromBackend: res.total,
                    }));
                }
            })
            .catch(() => {
                // Fallback gracefully if backend store isn't available
            });

        return () => {
            canceled = true;
        };
    }, [sessionIndex, historyIndex, windowState.offset, windowState.limit, runState.completed, runState.status, sorting]);

    const effectiveRequests = useMemo(() => {
        return windowState.items;
    }, [windowState.items]);

    const effectiveTotal = useMemo(() => {
        if (windowState.totalFromBackend > 0) return windowState.totalFromBackend;
        return runState.total;
    }, [windowState.totalFromBackend, runState.total]);

    const rows = useMemo(
        () => adaptFuzzerRequests(effectiveRequests, windowState.offset),
        [effectiveRequests, windowState.offset]
    );

    const enrichedRows = useMemo(
        () => rows.map((r) => enrichFuzzerRow(r, fuzzConfigSnapshot)),
        [rows, fuzzConfigSnapshot]
    );

    useEffect(() => {
        if (focusedId === null) {
            setFetchedFocusedResult(null);
            return;
        }

        const foundInWindow = enrichedRows.find((r) => r.id === focusedId);
        if (foundInWindow && foundInWindow.rawRequest && (foundInWindow.response?.rawResponse || foundInWindow.status !== 'completed')) {
            setFetchedFocusedResult(foundInWindow);
            return;
        }

        if (fetchedFocusedResult && fetchedFocusedResult.id === focusedId && fetchedFocusedResult.rawRequest && (fetchedFocusedResult.response?.rawResponse || fetchedFocusedResult.status !== 'completed')) {
            return;
        }

        let canceled = false;
        invoke<FuzzerRequest | null>('get_fuzzer_request_by_id', {
            selectedSession: sessionIndex,
            fuzzHistory: historyIndex,
            requestId: String(focusedId),
        })
            .then((res) => {
                if (canceled) return;
                if (res) {
                    const row = adaptFuzzerRequests([res], focusedId)[0];
                    setFetchedFocusedResult(enrichFuzzerRow(row, fuzzConfigSnapshot));
                }
            })
            .catch(() => {
            });

        return () => {
            canceled = true;
        };
    }, [focusedId, enrichedRows, sessionIndex, historyIndex, fuzzConfigSnapshot, fetchedFocusedResult]);

    const focusedResult = fetchedFocusedResult;

    const failedCount = runState.failed ?? 0;

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
                targetUrl={fuzzConfigSnapshot?.metadata?.targetUrl ?? ''}
                numThreads={fuzzConfigSnapshot?.numThreads ?? 4}
                delayMs={fuzzConfigSnapshot?.delayMs ?? 0}
                failedCount={failedCount}
            />
            <ResizablePanelGroup direction='vertical' autoSaveId="fuzzing-history-table" >
                <ResizablePanel defaultSize={30} minSize={15}>
                    <Table
                        data={enrichedRows}
                        columns={fuzzerColumns}
                        totalCount={effectiveTotal}
                        windowOffset={windowState.offset}
                        onScrollWindowChange={handleScrollWindowChange}
                        sorting={sorting}
                        onSortingChange={handleSortingChange}
                        manualSorting={true}
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
                        {!focusedResult ? (
                            <div className="h-full bg-card">
                                <EmptyState
                                    icon={Clipboard}
                                    title="No Request Selected"
                                    description="Choose a request from the fuzzer history table above to view its details."
                                />
                            </div>
                        ) : (
                            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-history-req-res">
                                <ResizablePanel defaultSize={50} minSize={15}>
                                    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
                                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                                            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Request</span>
                                            <div className="flex items-center gap-2">
                                                <MethodBadge method={focusedResult.parsedRequest.method || 'GET'} />
                                                {focusedResult.payloadValues.length > 0 && (
                                                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground truncate max-w-[200px]" title={focusedResult.payloadPreview}>
                                                        {focusedResult.payloadPreview}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex-1 min-h-0">
                                            <CodeMirrorEditor value={focusedResult.rawRequest ?? ''} />
                                        </div>
                                    </div>
                                </ResizablePanel>
                                <ResizableHandle withHandle />
                                <ResizablePanel defaultSize={50} minSize={15}>
                                    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
                                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Response</span>
                                                <HttpStatusBadge status={focusedResult.statusCode ?? focusedResult.status} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {canResendFocused && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 gap-1 px-2 text-[11px] font-medium"
                                                        onClick={() => resendSingleFuzzRequest(
                                                            dispatch,
                                                            sessionIndex,
                                                            historyIndex,
                                                            focusedResult!.fuzzRequestId,
                                                            focusedResult!.rawRequest ?? '',
                                                            fuzzConfigSnapshot?.metadata?.targetUrl ?? '',
                                                            projectId,
                                                        )}
                                                    >
                                                        <RotateCcw className="w-3 h-3" />
                                                        Resend
                                                    </Button>
                                                )}
                                                {focusedResult.response?.responseTime !== undefined && focusedResult.response.responseTime > 0 && (
                                                    <span className="text-[11px] font-mono text-muted-foreground">
                                                        {focusedResult.response.responseTime} ms
                                                    </span>
                                                )}
                                                {focusedResult.contentLength > 0 && (
                                                    <span className="text-[11px] font-mono text-muted-foreground">
                                                        {focusedResult.contentLength} B
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex-1 min-h-0">
                                            {focusedResult.status === 'error' || focusedResult.connectionDropped ? (
                                                <div className="flex h-full flex-col gap-3 p-4 bg-card">
                                                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                                                        <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                                                            <AlertTriangle className="w-4 h-4 shrink-0" />
                                                            {focusedResult.connectionDropped ? 'Connection dropped' : 'Request failed'}
                                                        </p>
                                                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                                            {focusedResult.errorMessage ?? 'Unknown error occurred while executing this fuzzed request.'}
                                                        </p>
                                                    </div>
                                                    {canResendFocused && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-fit h-7 gap-1.5 text-xs font-medium"
                                                            onClick={() => resendSingleFuzzRequest(
                                                                dispatch,
                                                                sessionIndex,
                                                                historyIndex,
                                                                focusedResult.fuzzRequestId,
                                                                focusedResult.rawRequest ?? '',
                                                                fuzzConfigSnapshot?.metadata?.targetUrl ?? '',
                                                                projectId,
                                                            )}
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                            Resend request
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : focusedResult.status === 'cancelled' ? (
                                                <div className="flex h-full flex-col gap-3 p-4 bg-card">
                                                    <div className="rounded-md border border-muted-foreground/30 bg-muted/40 p-3">
                                                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                                                            Request Cancelled
                                                        </p>
                                                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                                            This request was not sent because the fuzz run was stopped. Click "Resend request" below to send this request or use "Resume" on the toolbar to continue all pending requests.
                                                        </p>
                                                    </div>
                                                    {canResendFocused && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-fit h-7 gap-1.5 text-xs font-medium"
                                                            onClick={() => resendSingleFuzzRequest(
                                                                dispatch,
                                                                sessionIndex,
                                                                historyIndex,
                                                                focusedResult.fuzzRequestId,
                                                                focusedResult.rawRequest ?? '',
                                                                fuzzConfigSnapshot?.metadata?.targetUrl ?? '',
                                                                projectId,
                                                            )}
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                            Resend request
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <CodeMirrorEditor value={focusedResult.response?.rawResponse || (focusedResult.response as any)?.response || 'No response available'} />
                                            )}
                                        </div>
                                    </div>
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        )}
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div >
    );
}

export default FuzzerHistoryCompo;