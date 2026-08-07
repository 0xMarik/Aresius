import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    SortingState,
    ColumnDef,
    ColumnSizingState,
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
/*  Also skips re-render on unrelated column-sizing state changes,     */
/*  but DOES re-render when the sizing signature changes so column     */
/*  widths inside the row stay in sync while dragging a resize handle. */
/* ================================================================== */

interface TableRowProps<TData extends BaseRow> {
    row: Row<TData>;
    selected: boolean;
    onRowClick: (id: number) => void;
    /** Cheap serialized signature of columnSizing state. Changes only
     *  during an active resize drag, so this stays stable (and rows stay
     *  memoized) the rest of the time, including during high-frequency
     *  streaming updates. */
    columnSizingSignature: string;
}

function TableRowInner<TData extends BaseRow>({ row, selected, onRowClick }: TableRowProps<TData>) {
    return (
        <div
            onClick={() => onRowClick(row.original.id)}
            className={`flex h-full cursor-pointer items-center border-b border-border/40 ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/50 text-foreground'
                }`}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    key={cell.id}
                    className="truncate px-2 py-1"
                    style={{ width: cell.column.getSize(), flexShrink: 0 }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const TableRow = React.memo(TableRowInner, (prev, next) => {
    return (
        prev.row === next.row &&
        prev.selected === next.selected &&
        prev.onRowClick === next.onRowClick &&
        prev.columnSizingSignature === next.columnSizingSignature
    );
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
    /** 'onChange' (default) reflows widths live while dragging.
     *  'onEnd' only reflows on mouseup — smoother under heavy streaming load. */
    columnResizeMode?: 'onChange' | 'onEnd';
    /** Controlled column sizing, if the parent wants to persist/lift it
     *  (e.g. into Redux or localStorage-backed state). Uncontrolled by default. */
    columnSizing?: ColumnSizingState;
    onColumnSizingChange?: (sizing: ColumnSizingState) => void;
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
    columnResizeMode = 'onChange',
    columnSizing: controlledColumnSizing,
    onColumnSizingChange,
}: LightDataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [internalColumnSizing, setInternalColumnSizing] = useState<ColumnSizingState>({});

    // Support either controlled (parent-owned) or uncontrolled column sizing.
    const columnSizing = controlledColumnSizing ?? internalColumnSizing;
    const setColumnSizing = useCallback(
        (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
            const next = typeof updater === 'function' ? (updater as any)(columnSizing) : updater;
            if (onColumnSizingChange) {
                onColumnSizingChange(next);
            } else {
                setInternalColumnSizing(next);
            }
        },
        [columnSizing, onColumnSizingChange]
    );

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
        state: { sorting, columnSizing },
        onSortingChange: setSorting,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        columnResizeMode,
        enableColumnResizing: true,
    });

    const rows = table.getRowModel().rows;

    // Cheap signature that only changes while a column is actively being
    // resized (or after a resize completes). Passed to memoized rows so
    // they pick up new widths without re-rendering on every stream tick.
    const columnSizingSignature = useMemo(() => JSON.stringify(columnSizing), [columnSizing]);

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
        <div className={fillHeight ? 'flex h-full min-h-0 w-full flex-col bg-background' : 'w-full flex flex-col bg-background'}>
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 p-2 border-b border-border bg-background">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="w-56 border-none bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="text-muted-foreground/70 hover:text-foreground">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <div className="ml-auto text-[12px] text-muted-foreground">
                    {filteredData.length} of {data.length} rows
                </div>
            </div>

            {/* Table */}
            <div
                className={
                    fillHeight
                        ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-card'
                        : 'overflow-hidden bg-card'
                }
            >
                {/* Header */}
                <div className={fillHeight ? 'shrink-0' : undefined}>
                    <div className="border-b border-border bg-muted/50 text-muted-foreground">
                        {table.getHeaderGroups().map((hg) => (
                            <div key={hg.id} className="flex items-center">
                                {hg.headers.map((header) => {
                                    const isResizing = header.column.getIsResizing();
                                    return (
                                        <div
                                            key={header.id}
                                            style={{ width: header.getSize(), flexShrink: 0, position: 'relative' }}
                                            className="group flex select-none items-center justify-between gap-1 px-2 py-1.5 hover:bg-accent/60"
                                        >
                                            <span
                                                onClick={header.column.getToggleSortingHandler()}
                                                className="flex-1 min-w-0 cursor-pointer truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
                                            >
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </span>
                                            <span className="pointer-events-none shrink-0 text-muted-foreground/60">
                                                {header.column.getIsSorted() === 'asc' && <ChevronUp className="h-3 w-3" />}
                                                {header.column.getIsSorted() === 'desc' && <ChevronDown className="h-3 w-3" />}
                                                {!header.column.getIsSorted() && <ChevronsUpDown className="h-3 w-3" />}
                                            </span>

                                            {header.column.getCanResize() && (
                                                <div
                                                    onMouseDown={header.getResizeHandler()}
                                                    onTouchStart={header.getResizeHandler()}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none ${isResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-border'
                                                        }`}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Rows (virtualized) */}
                {rows.length === 0 ? (
                    <div
                        className={
                            fillHeight
                                ? 'flex min-h-0 flex-1 items-center justify-center py-12 text-center text-muted-foreground'
                                : 'py-12 text-center text-muted-foreground'
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
                                        <TableRow
                                            row={row}
                                            selected={selectedId === row.original.id}
                                            onRowClick={handleRowClick}
                                            columnSizingSignature={columnSizingSignature}
                                        />
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