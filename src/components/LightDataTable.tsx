import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    SortingState,
    ColumnDef,
    Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, X } from 'lucide-react';

/* ================================================================== */
/*  Generic row contract                                               */
/* ================================================================== */

export type BaseRow = { id: number };

/** Fixed row height in px — must match the rendered row's actual height
 *  since the virtualizer computes offsets from this without measuring
 *  the DOM. Update this if you change row padding/font-size. */
const ROW_HEIGHT = 30;

/* ================================================================== */
/*  Row — memoized so selecting one row doesn't reconcile every row.   */
/* ================================================================== */

interface TableRowProps<TData extends BaseRow> {
    row: Row<TData>;
    selected: boolean;
    onRowClick: (id: number) => void;
}

function TableRowInner<TData extends BaseRow>({ row, selected, onRowClick }: TableRowProps<TData>) {
    return (
        <div
            onClick={() => onRowClick(row.original.id)}
            className={`flex h-full cursor-pointer items-center border-b border-[#F0EDE6] ${selected ? 'bg-[#B23A2E] text-white' : 'hover:bg-[#FAF7F2]'
                }`}
        >
            {row.getVisibleCells().map((cell) => (
                <div key={cell.id} className="truncate px-2 py-1" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const TableRow = React.memo(TableRowInner, (prev, next) => {
    return prev.row === next.row && prev.selected === next.selected && prev.onRowClick === next.onRowClick;
}) as typeof TableRowInner;

/* ================================================================== */
/*  Main component                                                     */
/* ================================================================== */

interface LightDataTableProps<TData extends BaseRow> {
    data: TData[];
    columns: ColumnDef<TData, any>[];
    onSelectRow?: (id: number | null) => void;
    searchFn?: (row: TData, query: string) => boolean;
    searchPlaceholder?: string;
    emptyLabel?: string;
    /** Max height of the scrollable row viewport. Ignored when `fillHeight` is true. */
    maxHeight?: number;
    /** Fill the parent height instead of a fixed maxHeight. Parent must be
     *  a bounded container (h-full + min-h-0 flex chain). */
    fillHeight?: boolean;
}

export default function LightDataTable<TData extends BaseRow>({
    data,
    columns,
    onSelectRow,
    searchFn,
    searchPlaceholder = 'Search…',
    emptyLabel = 'No rows',
    maxHeight = 600,
    fillHeight = false,
}: LightDataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const defaultSearch = useCallback(
        (row: TData, q: string) =>
            Object.values(row as Record<string, unknown>).some(
                (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q)
            ),
        []
    );

    const filteredData = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return data;
        return data.filter((r) => (searchFn ?? defaultSearch)(r, q));
    }, [data, search, searchFn, defaultSearch]);

    const table = useReactTable({
        data: filteredData,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const rows = table.getRowModel().rows;

    const handleRowClick = useCallback(
        (id: number) => {
            setSelectedId(id);
            onSelectRow?.(id);
        },
        [onSelectRow]
    );

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const getScrollElement = useCallback(() => scrollContainerRef.current, []);
    const estimateSize = useCallback(() => ROW_HEIGHT, []);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement,
        estimateSize,
        overscan: 12,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
        <div className={fillHeight ? 'flex h-full min-h-0 w-full flex-col bg-[#FAF7F2] p-2' : 'mx-auto max-w-7xl bg-[#FAF7F2] p-2'}>
            {/* Toolbar */}
            <div className="mb-2 flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-md border border-[#E3DCCC] bg-white px-2 py-1">
                    <Search className="h-3.5 w-3.5 text-[#9A9A90]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="w-56 border-none bg-transparent text-[12px] text-[#1B211E] outline-none placeholder:text-[#9A9A90]"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="text-[#C9C2B2] hover:text-[#5C6360]">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <div className="ml-auto text-[12px] text-[#9A9A90]">
                    {filteredData.length} of {data.length} rows
                </div>
            </div>

            {/* Table */}
            <div
                className={
                    fillHeight
                        ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[#E3DCCC] bg-white'
                        : 'overflow-hidden rounded-md border border-[#E3DCCC] bg-white'
                }
            >
                {/* Header */}
                <div className={fillHeight ? 'shrink-0' : undefined}>
                    <div className="border-b border-[#E3DCCC] bg-[#FAF7F2]">
                        {table.getHeaderGroups().map((hg) => (
                            <div key={hg.id} className="flex items-center">
                                {hg.headers.map((header) => (
                                    <div
                                        key={header.id}
                                        onClick={header.column.getToggleSortingHandler()}
                                        style={{ width: header.getSize() }}
                                        className="flex cursor-pointer select-none items-center justify-between gap-1 px-2 py-1.5 hover:bg-[#F4EEE3]"
                                    >
                                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#5C6360]">
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                        </span>
                                        <span className="text-[#C9C2B2]">
                                            {header.column.getIsSorted() === 'asc' && <ChevronUp className="h-3 w-3" />}
                                            {header.column.getIsSorted() === 'desc' && <ChevronDown className="h-3 w-3" />}
                                            {!header.column.getIsSorted() && <ChevronsUpDown className="h-3 w-3" />}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Rows (virtualized) */}
                {rows.length === 0 ? (
                    <div
                        className={
                            fillHeight
                                ? 'flex min-h-0 flex-1 items-center justify-center py-12 text-center text-[#9A9A90]'
                                : 'py-12 text-center text-[#9A9A90]'
                        }
                    >
                        <p className="text-[13px]">{data.length === 0 ? emptyLabel : 'No rows match your search'}</p>
                    </div>
                ) : (
                    <div
                        ref={scrollContainerRef}
                        className={fillHeight ? 'relative min-h-0 flex-1 overflow-y-auto' : undefined}
                        style={fillHeight ? undefined : { maxHeight, overflowY: 'auto', position: 'relative' }}
                    >
                        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                            {virtualItems.map((virtualItem) => {
                                const row = rows[virtualItem.index];
                                return (
                                    <div
                                        key={row.id}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: virtualItem.size,
                                            transform: `translateY(${virtualItem.start}px)`,
                                        }}
                                    >
                                        <TableRow row={row} selected={selectedId === row.original.id} onRowClick={handleRowClick} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}