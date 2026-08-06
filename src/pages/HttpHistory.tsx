import { CodeMirrorEditor } from '@/components/result-table.components';
import Table from '@/components/Table';
import { useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { isRowSelected, FacetFilter } from '@/components/Table';
import { parseRequest, parseResponse } from '@/components/utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { HttpHistory } from '@/types/http.type';
import { historySelectors } from '@/store/slices/http-historySlice'; // adjust path to match your alias
import { EmptyState } from '@/components/ui/empty-state';
import { Clipboard } from 'lucide-react'

export type RequestState = 'Pending' | 'Info' | 'Success' | 'Redirect' | 'Client Error' | 'Server Error' | 'Failed';

export type HttpTransaction = {
    id: number;
    host: string;
    url: string;
    method: string;
    code: number | null;
    time: number;
    duration: number;
    state: RequestState;
    group?: string;
    rawRequest: string;
    rawResponse: string;
};

function stateFromCode(code: number | null): RequestState {
    if (code === null || code === undefined) return 'Pending';
    if (code >= 100 && code < 200) return 'Info';
    if (code >= 200 && code < 300) return 'Success';
    if (code >= 300 && code < 400) return 'Redirect';
    if (code >= 400 && code < 500) return 'Client Error';
    if (code >= 500 && code < 600) return 'Server Error';
    return 'Failed';
}

export function adaptFromReqRes(items: HttpHistory[]): HttpTransaction[] {
    return items.map((item) => {
        const req = parseRequest(item.rawRequest);
        const res = parseResponse(item.rawResponse);
        let host = item.host;
        let path = req.path ?? '/';
        try {
            const asUrl = req.path?.startsWith('http') ? req.path : `https://${item.host}${req.path ?? ''}`;
            const parsed = new URL(asUrl);
            host = parsed.host;
            path = parsed.pathname + parsed.search;
        } catch {
            // keep raw fallbacks above
        }

        return {
            id: Number(item.id), // real backend-assigned id, not array index
            host,
            url: path,
            method: req.method,
            code: res.statusCode ?? null,
            time: item.timestamp,
            duration: item.duration ?? 0,
            state: stateFromCode(res.statusCode ?? null),
            rawRequest: item.rawRequest,
            rawResponse: item.rawResponse,
        };
    });
}

function methodColor(method: string, selected: boolean) {
    if (selected) return 'bg-primary-foreground/15 text-primary-foreground';
    const colors: Record<string, string> = {
        GET: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        POST: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        PUT: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
        DELETE: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
        PATCH: 'bg-stone-500/15 text-stone-700 dark:text-stone-400',
    };
    return colors[method] ?? 'bg-muted text-muted-foreground';
}

function codeColor(code: number | null, selected: boolean) {
    if (selected) return 'text-primary-foreground';
    if (code === null) return 'text-muted-foreground';
    if (code < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (code < 400) return 'text-amber-600 dark:text-amber-400';
    if (code < 500) return 'text-rose-600 dark:text-rose-400';
    return 'text-red-600 dark:text-red-400';
}

function stateDotColor(state: RequestState) {
    const colors: Record<RequestState, string> = {
        Pending: 'bg-muted-foreground/40',
        Info: 'bg-amber-500',
        Success: 'bg-emerald-500',
        Redirect: 'bg-amber-600',
        'Client Error': 'bg-rose-500',
        'Server Error': 'bg-red-500',
        Failed: 'bg-red-700',
    };
    return colors[state];
}

const columnHelper = createColumnHelper<HttpTransaction>();

export const httpColumns: ColumnDef<HttpTransaction, any>[] = [
    columnHelper.accessor('id', {
        id: 'id',
        header: 'ID',
        size: 56,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('method', {
        id: 'method',
        header: 'Method',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${methodColor(info.getValue(), selected)}`}>
                    {info.getValue()}
                </span>
            );
        },
    }),
    columnHelper.accessor('host', {
        id: 'host',
        header: 'Host',
        size: 200,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('url', {
        id: 'url',
        header: 'URL',
        size: 320,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('code', {
        id: 'code',
        header: 'Code',
        size: 64,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold ${codeColor(value, selected)}`}>{value ?? '—'}</span>;
        },
    }),
    columnHelper.accessor('duration', {
        id: 'duration',
        header: 'Duration',
        size: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}ms</span>;
        },
    }),
    columnHelper.accessor('time', {
        id: 'time',
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
    columnHelper.accessor('state', {
        id: 'state',
        header: 'State',
        size: 110,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`inline-flex items-center gap-1.5 text-[12px] ${selected ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${stateDotColor(info.getValue())}`} />
                    {info.getValue()}
                </span>
            );
        },
    }),
];

export const httpFacetFilters: FacetFilter<HttpTransaction>[] = [
    { id: 'method', label: 'Method', getValue: (r: any) => r.method },
    { id: 'state', label: 'State', getValue: (r: any) => r.state },
];


const HTTPHisotry = () => {
    const history = useAppSelector(historySelectors.selectAll);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);

    const selectedEntity = useAppSelector((state) =>
        selectedRequest !== null ? historySelectors.selectById(state, selectedRequest) : undefined,
    );

    const rows = useMemo(() => adaptFromReqRes(history), [history]);

    return (
        <div className='overflow-hidden h-screen'>
            <ResizablePanelGroup direction='vertical' autoSaveId="http-history-table" >
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full'>
                        <Table data={rows}
                            columns={httpColumns}
                            facetFilters={httpFacetFilters}
                            searchPlaceholder="Search host, url, method, code…"
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