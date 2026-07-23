import { CodeMirrorEditor } from '@/components/result-table.components';
import Table from '@/components/Table';
import { useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { isRowSelected, FacetFilter } from '@/components/Table';
import { parseRequest, parseResponse } from '@/components/utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

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
};

type RawReqRes = {
    request: string;
    response: string;
    host: string;
    timestamp: number;
    duration: number;
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

export function adaptFromReqRes(items: RawReqRes[]): HttpTransaction[] {
    return items.map((item, idx) => {
        const req = parseRequest(item.request);
        const res = parseResponse(item.response);
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
            id: idx,
            host,
            url: path,
            method: req.method,
            code: res.statusCode ?? null,
            time: item.timestamp,
            duration: item.duration ?? 0,
            state: stateFromCode(res.statusCode ?? null),
        };
    });
}

function methodColor(method: string, selected: boolean) {
    if (selected) return 'bg-white/15 text-white';
    const colors: Record<string, string> = {
        GET: 'bg-[#F4E4DE] text-[#8F2E24]',
        POST: 'bg-[#E7EFEA] text-[#3C7A5A]',
        PUT: 'bg-[#F6EEDD] text-[#8A6A2E]',
        DELETE: 'bg-[#F4E4DE] text-[#C0392B]',
        PATCH: 'bg-[#EFEAE6] text-[#6E4A3E]',
    };
    return colors[method] ?? 'bg-[#F0EDE6] text-[#5C6360]';
}

function codeColor(code: number | null, selected: boolean) {
    if (selected) return 'text-white';
    if (code === null) return 'text-[#9A9A90]';
    if (code < 300) return 'text-[#3C7A5A]';
    if (code < 400) return 'text-[#8A6A2E]';
    if (code < 500) return 'text-[#B23A2E]';
    return 'text-[#C0392B]';
}

function stateDotColor(state: RequestState) {
    const colors: Record<RequestState, string> = {
        Pending: 'bg-[#C9C2B2]',
        Info: 'bg-[#8A6A2E]',
        Success: 'bg-[#3C7A5A]',
        Redirect: 'bg-[#B27A3E]',
        'Client Error': 'bg-[#B23A2E]',
        'Server Error': 'bg-[#C0392B]',
        Failed: 'bg-[#7A2A1E]',
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
            return <span className={`font-mono text-[11px] ${selected ? 'text-white/80' : 'text-[#9A9A90]'}`}>{info.getValue()}</span>;
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
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-white' : 'text-[#1B211E]'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('url', {
        id: 'url',
        header: 'URL',
        size: 320,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-white/90' : 'text-[#5C6360]'}`}>{info.getValue()}</span>;
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
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-white/80' : 'text-[#5C6360]'}`}>{info.getValue()}ms</span>;
        },
    }),
    columnHelper.accessor('time', {
        id: 'time',
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
    columnHelper.accessor('state', {
        id: 'state',
        header: 'State',
        size: 110,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`inline-flex items-center gap-1.5 text-[12px] ${selected ? 'text-white/90' : 'text-[#5C6360]'}`}>
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

    const { history } = useAppSelector(state => state.httpHistory);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);

    return (
        <div className='overflow-hidden h-screen'>
            {/* <ReactSplit
                direction={SplitDirection.Vertical}
                initialSizes={[40, 60]} // 👈 Initial widths: 40% left, 60% right
                // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
                // gutterClassName="custom-gutter-horizontal"
                // draggerClassName="custom-dragger-horizontal"
                classes={["py-1", "py-1"]}
            > */}
            <ResizablePanelGroup direction='vertical' autoSaveId="http-history-table" >
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full'>
                        <Table data={adaptFromReqRes(history)}
                            columns={httpColumns}
                            facetFilters={httpFacetFilters}
                            searchPlaceholder="Search host, url, method, code…"
                            emptyLabel="No requests captured yet"
                            emptyHint="Start your proxy to begin capturing HTTP traffic"
                            setSelectedRequest={setSelectedRequest} />
                    </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className='h-full'>
                        <ResizablePanelGroup direction='horizontal' autoSaveId="http-history-req-res" >
                            <ResizablePanel defaultSize={50} minSize={15}>
                                <div className=' h-full'>
                                    {
                                        (selectedRequest === null) ? "select a request" : <CodeMirrorEditor value={history[selectedRequest].request} />
                                    }
                                </div>
                            </ResizablePanel>
                            <ResizableHandle />
                            <ResizablePanel defaultSize={50} minSize={15}>
                                <div className=' h-full'>
                                    {
                                        (selectedRequest === null) ? "select a request" : <CodeMirrorEditor value={history[selectedRequest].response} />
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
