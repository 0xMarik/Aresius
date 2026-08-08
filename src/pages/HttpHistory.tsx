import { CodeMirrorEditor } from '@/components/result-table.components';
import Table from '@/components/Table';
import { useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { isRowSelected, } from '@/components/Table';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { HttpHistory, RequestState } from '@/types/http.type';
import { getHistorySelectors } from '@/store/slices/http-historySlice';
import { EmptyState } from '@/components/ui/empty-state';
import { Clipboard } from 'lucide-react'
import { Badge } from '@/components/ui/badge';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { isInScope } from '@/lib/scopeMatcher';
import { cn } from '@/lib/utils';
import { useProjectId } from '@/hooks/useProjectId';

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
    sentAtTsMs: number;
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
        sentAtTsMs: item.sentAtTsMs,
        state: stateFromCode(item.statusCode),
        rawRequest: item.rawRequest,
        rawResponse: item.rawResponse,
    }));
}

function methodColor(method: string, selected: boolean) {
    if (selected) return 'bg-primary-foreground/15 text-primary-foreground';
    const colors: Record<string, string> = {
        GET: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
        POST: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
        PUT: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
        DELETE: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
        PATCH: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
        HEAD: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30 border-sky-500/30',
        OPTIONS: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
        CONNECT: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/30',
        TRACE: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
    };
    return colors[method] ?? 'bg-muted text-muted-foreground';
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
            return (
                <Badge
                    variant="outline"
                    className={`text-[10px] font-mono px-1.5 py-0 ${methodColor(info.getValue(), selected)}`}
                >
                    {info.getValue()}
                </Badge>
            );
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
    columnHelper.accessor('sentAtTsMs', {
        id: 'sentAtTsMs',
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

// export const httpFacetFilters: FacetFilter<HttpTransaction>[] = [
//     { id: 'method', label: 'Method', getValue: (r: any) => r.method },
//     { id: 'state', label: 'State', getValue: (r: any) => r.state },
//     { id: 'extension', label: 'Extension', getValue: (r: any) => r.extension ?? '—' },
// ];


const HTTPHisotry = () => {
    const projectId = useProjectId();
    const historySelectors = useMemo(() => getHistorySelectors(projectId), [projectId]);
    const history = useAppSelector(historySelectors.selectAll);
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
    const [scopeFilter, setScopeFilter] = useState<'all' | 'in' | 'out'>('all');

    const selectedEntity = useAppSelector((state) =>
        selectedRequest !== null ? historySelectors.selectById(state, selectedRequest) : undefined,
    );

    const allRows = useMemo(() => adaptFromReqRes(history), [history]);

    const rows = useMemo(() => {
        if (scopeFilter === 'all' || !activeScope) return allRows;
        return allRows.filter((row) => {
            const inScope = isInScope(activeScope, row.host, row.path);
            return scopeFilter === 'in' ? inScope : !inScope;
        });
    }, [allRows, activeScope, scopeFilter]);

    return (
        <div className='overflow-hidden h-screen'>
            <ResizablePanelGroup direction='vertical' autoSaveId="http-history-table" >
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full flex flex-col'>
                        {/* Scope filter bar */}
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-card/30 shrink-0">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mr-1">Scope</span>
                            {(['all', 'in', 'out'] as const).map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setScopeFilter(f)}
                                    className={cn(
                                        'px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors border',
                                        scopeFilter === f
                                            ? f === 'in'
                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                                : f === 'out'
                                                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400'
                                                    : 'bg-primary/10 border-primary/30 text-primary'
                                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                                    )}
                                >
                                    {f === 'all' ? 'All' : f === 'in' ? 'In Scope' : 'Out of Scope'}
                                </button>
                            ))}
                            {activeScope && (
                                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: activeScope.color }}
                                    />
                                    {activeScope.name}
                                </span>
                            )}
                            {!activeScope && (
                                <span className="ml-auto text-[11px] text-muted-foreground/50">No active scope</span>
                            )}
                        </div>
                        <Table data={rows}
                            columns={httpColumns}
                            // facetFilters={httpFacetFilters}
                            // searchPlaceholder="Search host, path, method, status…"
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
                        <ResizablePanelGroup direction='horizontal' autoSaveId="http-history-req-res" >
                            <ResizablePanel defaultSize={50} minSize={15}>
                                <div className=' h-full'>
                                    {
                                        !selectedEntity ? <EmptyState
                                            icon={Clipboard}
                                            title="Nothing Selected"
                                            description="Choose a request from the history list to view its details."
                                        /> : <CodeMirrorEditor value={selectedEntity.rawRequest} />
                                    }
                                </div>
                            </ResizablePanel>
                            <ResizableHandle withHandle />
                            <ResizablePanel defaultSize={50} minSize={15}>
                                <div className=' h-full'>
                                    {
                                        !selectedEntity ? <EmptyState
                                            icon={Clipboard}
                                            title="Nothing Selected"
                                            description="Choose a request from the history list to view its details."
                                        /> : <CodeMirrorEditor value={selectedEntity.rawResponse} />
                                    }
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    )
}

export default HTTPHisotry