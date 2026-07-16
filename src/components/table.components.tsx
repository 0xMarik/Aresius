import React, { useEffect, useMemo, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    createColumnHelper,
    SortingState,
    ColumnDef,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { parseRequest, parseResponse } from './utils';



type HttpTransaction = {
    id: number;
    method: string;
    url: string;
    status: number;
    time: number;
    timestamp: string;
};

// const data: HttpTransaction[] = [
//     { id: 1, method: 'GET', url: 'https://api.example.com/users', status: 200, time: 145, timestamp: '10:23:45' },
//     { id: 2, method: 'POST', url: 'https://api.example.com/login', status: 201, time: 234, timestamp: '10:24:12' },
//     { id: 3, method: 'DELETE', url: 'https://api.example.com/users/5', status: 404, time: 89, timestamp: '10:25:03' },
//     { id: 4, method: 'PUT', url: 'https://api.example.com/users/3', status: 200, time: 178, timestamp: '10:26:34' },
//     { id: 5, method: 'GET', url: 'https://api.example.com/posts', status: 500, time: 2341, timestamp: '10:27:01' },
// ];

const columnHelper = createColumnHelper<HttpTransaction>();

const getMethodColor = (method: string, isSelected: boolean) => {
    if (isSelected) return 'bg-blue-600 text-white';
    const colors: Record<string, string> = {
        GET: 'bg-blue-100 text-blue-800',
        POST: 'bg-green-100 text-green-800',
        PUT: 'bg-yellow-100 text-yellow-800',
        DELETE: 'bg-red-100 text-red-800',
        PATCH: 'bg-purple-100 text-purple-800',
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
};

const getStatusColor = (status: number, isSelected: boolean) => {
    if (isSelected) return 'text-white font-semibold';
    if (status >= 200 && status < 300) return 'text-green-600 font-semibold';
    if (status >= 300 && status < 400) return 'text-blue-600 font-semibold';
    if (status >= 400 && status < 500) return 'text-orange-600 font-semibold';
    if (status >= 500) return 'text-red-600 font-semibold';
    return 'text-gray-600';
};

const columns: ColumnDef<HttpTransaction, any>[] = [
    columnHelper.accessor('id', {
        header: 'ID',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return <span className={`text-sm ${isSelected ? 'text-white' : 'text-gray-500'}`}>#{info.getValue()}</span>;
        },
        size: 60,
    }),
    columnHelper.accessor('method', {
        header: 'Method',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return (
                <span className={`px-2 py-1 rounded text-xs font-medium ${getMethodColor(info.getValue(), isSelected)}`}>
                    {info.getValue()}
                </span>
            );
        },
        size: 100,
    }),
    columnHelper.accessor('url', {
        header: 'URL',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return <span className={`text-sm font-mono ${isSelected ? 'text-white' : 'text-gray-700'}`}>{info.getValue()}</span>;
        },
        size: 400,
    }),
    columnHelper.accessor('status', {
        header: 'Status',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return <span className={getStatusColor(info.getValue(), isSelected)}>{info.getValue()}</span>;
        },
        size: 80,
    }),
    columnHelper.accessor('time', {
        header: 'Time',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return <span className={`text-sm ${isSelected ? 'text-white' : 'text-gray-600'}`}>{info.getValue()}ms</span>;
        },
        size: 80,
    }),
    columnHelper.accessor('timestamp', {
        header: 'Time Of Request',
        cell: info => {
            const isSelected = info.row.index === (info.table.options.meta as any).selectedRow;
            return <span className={`text-sm ${isSelected ? 'text-white' : 'text-gray-500'}`}>{info.getValue()}</span>;
        },
        size: 350,
    })
];

interface TableProps {
    request: string,
    response: string,
    host: string,
    timestamp: number,
}

export default function HttpHistoryTable({ reqReses, setSelectedRequest }: { reqReses: TableProps[], setSelectedRequest: any }) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [selectedRow, setSelectedRow] = useState<number | null>(null);

    // const { history } = useAppSelector(state => state.httpHistory)

    useEffect(() => {
        setSelectedRequest(selectedRow)
    }, [selectedRow])

    const data = useMemo(() =>
        reqReses.map((item, idx) => {
            const parsedRequest = parseRequest(item.request);
            const parsedResponse = parseResponse(item.response);
            return {
                id: idx,
                method: parsedRequest.method,
                status: parsedResponse.statusCode,
                time: 0,
                timestamp: (new Date(item.timestamp)).toString(),
                url: item.host
            };
        }),
        [reqReses]
    );

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        meta: {
            selectedRow,
        },
    });

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const rows = table.getRowModel().rows;
            if (rows.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedRow(prev => {
                    if (prev === null) return 0;
                    return Math.min(prev + 1, rows.length - 1);
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedRow(prev => {
                    if (prev === null) return 0;
                    return Math.max(prev - 1, 0);
                });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [table]);

    return (
        <div className="max-w-7xl mx-auto p-3">
            {/* <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">HTTP History</h1>
                <p className="text-gray-600 text-sm mt-1">{data.length} requests captured</p>
            </div> */}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="bg-gray-50 border-b border-gray-200">
                    {table.getHeaderGroups().map(headerGroup => (
                        <div key={headerGroup.id} className="flex items-center">
                            {headerGroup.headers.map(header => (
                                <div
                                    key={header.id}
                                    className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    style={{ width: header.getSize() }}
                                    onClick={header.column.getToggleSortingHandler()}
                                >
                                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                    </span>
                                    <span className="text-gray-400">
                                        {header.column.getIsSorted() === 'asc' && <ChevronUp className="w-4 h-4" />}
                                        {header.column.getIsSorted() === 'desc' && <ChevronDown className="w-4 h-4" />}
                                        {!header.column.getIsSorted() && <ChevronsUpDown className="w-4 h-4" />}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>

                {/* Body */}
                <div className="divide-y divide-gray-100">
                    {table.getRowModel().rows.map((row, index) => (
                        <div
                            key={row.id}
                            className={`flex items-center cursor-pointer transition-colors ${selectedRow === index ? 'bg-blue-500 text-white' : 'hover:bg-blue-50'
                                }`}
                            onClick={() => setSelectedRow(index)}
                        >
                            {row.getVisibleCells().map(cell => (
                                <div
                                    key={cell.id}
                                    className="px-4 py-1"
                                    style={{ width: cell.column.getSize() }}
                                >
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {data.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">No requests captured yet</p>
                    <p className="text-sm mt-2">Start your proxy to begin capturing HTTP traffic</p>
                </div>
            )}
        </div>
    );
}