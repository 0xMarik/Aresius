import Table, { isRowSelected } from '@/components/Table';
import { useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { HttpHistory, RequestState } from '@/types/http.type';
import { getHistorySelectors } from '@/store/slices/http-historySlice';
import MethodBadge from '@/components/MethodBadge';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { isInScope } from '@/lib/scopeMatcher';
import { useProjectId } from '@/hooks/useProjectId';
import { ScopeFilterBar, ScopeFilterOption } from '@/components/ScopeFilterBar';
import HttpRequestViewerPane from '@/components/HttpRequestViewerPane';

// Flat, at the same level as rawRequest/rawResponse -- no nested metadata
// object. Every field except `state` is now populated straight from the
// backend's HttpHistoryPayload; nothing here is parsed from raw bytes on
// the frontend anymore.
export type HttpTransaction = {
    id: number;
    host: string;
    method: string;
    path: string;
    query: string | null;
    extension: string | null;
    statusCode: number;
    responseLength: number;
    responseTimeMs: number;
    sentAtMs: number;
    state: RequestState;
    rawRequest: string;
    rawResponse: string;
};

function stateFromCode(code: number): RequestState {
    // 0 is our backend's "couldn't parse a status line" sentinel -- treat
    // it like the old `null` case rather than falling through to Failed.
    if (!code) return 'Pending';
    if (code >= 100 && code < 200) return 'Info';
    if (code >= 200 && code < 300) return 'Success';
    if (code >= 300 && code < 400) return 'Redirect';
    if (code >= 400 && code < 500) return 'Client Error';
    if (code >= 500 && code < 600) return 'Server Error';
    return 'Failed';
}

export function adaptFromReqRes(items: HttpHistory[]): HttpTransaction[] {
    return items.map((item) => ({
        id: Number(item.id),
        host: item.host,
        method: item.method,
        path: item.path,
        query: item.query ?? null,
        extension: item.extension ?? null,
        statusCode: item.statusCode,
        responseLength: item.responseLength,
        responseTimeMs: item.responseTimeMs,
        sentAtMs: item.sentAtMs,
        state: stateFromCode(item.statusCode),
        rawRequest: item.rawRequest,
        rawResponse: item.rawResponse,
    }));
}

function codeColor(code: number, selected: boolean) {
    if (selected) return 'text-primary-foreground';
    if (!code) return 'text-muted-foreground';
    if (code < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (code < 400) return 'text-amber-600 dark:text-amber-400';
    if (code < 500) return 'text-rose-600 dark:text-rose-400';
    return 'text-red-600 dark:text-red-400';
}

const columnHelper = createColumnHelper<HttpTransaction>();

export const httpColumns: ColumnDef<HttpTransaction, any>[] = [
    columnHelper.accessor('id', {
        id: 'id',
        header: 'ID',
        size: 56,
        minSize: 56,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('method', {
        id: 'method',
        header: 'Method',
        size: 120,
        minSize: 120,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <MethodBadge method={info.getValue()} selected={selected} />;
        },
    }),
    columnHelper.accessor('host', {
        id: 'host',
        header: 'Host',
        size: 200,
        minSize: 200,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('path', {
        id: 'path',
        header: 'Path',
        size: 260,
        minSize: 260,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/90' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('query', {
        id: 'query',
        header: 'Query',
        size: 200,
        minSize: 200,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('extension', {
        id: 'extension',
        header: 'Ext',
        size: 64,
        minSize: 64,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`text-[12px] ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('statusCode', {
        id: 'statusCode',
        header: 'Status',
        size: 80,
        minSize: 80,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold ${codeColor(value, selected)}`}>{value || '—'}</span>;
        },
    }),
    columnHelper.accessor('responseLength', {
        id: 'responseLength',
        header: 'Length',
        size: 84,
        minSize: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()} B</span>;
        },
    }),
    columnHelper.accessor('responseTimeMs', {
        id: 'responseTimeMs',
        header: 'Duration (ms)',
        size: 150,
        minSize: 150,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('sentAtMs', {
        id: 'sentAtMs',
        header: 'Sent at',
        size: 130,
        minSize: 130,

        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                    {(() => {
                        const date = new Date(info.getValue());
                        const pad = (value: number) => String(value).padStart(2, '0');
                        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
                    })()}
                </span>
            );
        },
    }),
];

const HTTPHistory = () => {
    const projectId = useProjectId();
    const historySelectors = useMemo(() => getHistorySelectors(projectId), [projectId]);
    const history = useAppSelector(historySelectors.selectAll);
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
    const [scopeFilter, setScopeFilter] = useState<ScopeFilterOption>('in');

    const selectedEntity = useAppSelector((state) =>
        selectedRequest !== null ? historySelectors.selectById(state, selectedRequest) : undefined,
    );

    const allRows = useMemo(() => adaptFromReqRes(history), [history]);

    const rows = useMemo(() => {
        if (scopeFilter === 'all' || !activeScope) return allRows;
        return allRows.filter((row) => {
            const inScope = isInScope(activeScope, row.host, row.path || '/');
            return scopeFilter === 'in' ? inScope : !inScope;
        });
    }, [allRows, activeScope, scopeFilter]);

    return (
        <div className='overflow-hidden h-screen'>
            <ResizablePanelGroup direction='vertical' autoSaveId="http-history-table" >
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full flex flex-col'>
                        {/* Scope filter bar (rendered only when activeScope is set) */}
                        <ScopeFilterBar
                            activeScope={activeScope}
                            value={scopeFilter}
                            onChange={setScopeFilter}
                        />
                        <Table data={rows}
                            columns={httpColumns}
                            emptyLabel="No requests captured yet"
                            emptyHint="Start your proxy to begin capturing HTTP traffic"
                            setSelectedRequest={setSelectedRequest}
                            renderRowContextMenu={renderHttpHistoryTableContextMenu}
                            fillHeight
                        />
                    </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full'>
                        <HttpRequestViewerPane
                            request={selectedEntity}
                            autoSaveId="http-history-req-res"
                        />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default HTTPHistory;