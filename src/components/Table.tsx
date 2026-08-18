import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    SortingState,
    ColumnDef,
    VisibilityState,
    Row,
    Table,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    ChevronUp,
    ChevronDown,
    ChevronsUpDown,
    Trash2,
    GripVertical,
} from 'lucide-react';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
    DndContext,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    PointerSensor,
    closestCenter,
    DragEndEvent,
} from '@dnd-kit/core';

/* ================================================================== */
/*  Generic row contract — the only thing DataTable requires of TData  */
/* ================================================================== */

export type BaseRow = {
    id: number;
};

export type TableMeta = { selectedIds: Set<number> };

/** Exported so consumer column-def files can style the "selected" state without
 *  knowing anything about DataTable's internals. */
export function isRowSelected<TData extends BaseRow>(info: {
    row: { original: TData };
    table: { options: { meta?: unknown } };
}) {
    const meta = info.table.options.meta as TableMeta | undefined;
    return meta?.selectedIds.has(info.row.original.id) ?? false;
}

/* ------------------------------------------------------------------ */
/*  Context menu is now a parameter, not something DataTable hardcodes. */
/*  A row's ContextMenuContent is produced by calling                  */
/*  `renderRowContextMenu(ctx)` (or DataTable's own default, below, if  */
/*  the consumer doesn't pass one). Everything the renderer could      */
/*  plausibly need — including DataTable's built-in remove action —    */
/*  is bundled into `ctx`, so a fully custom menu can still            */
/*  call into the built-in remove behavior, or ignore it completely    */
/*  and render its own domain-specific items instead.                  */
/* ------------------------------------------------------------------ */

export type RowContextMenuContext<TData extends BaseRow> = {
    /** id of the row that was right-clicked / opened the menu. */
    rowId: number;
    /** the full row data for that row. */
    row: TData;
    /** ids the action should apply to — either just [rowId], or the full
     *  current multi-selection if rowId is part of it. */
    actionIds: number[];
    isMultiple: boolean;
    onRemove: (ids: number[]) => void;
};

/** Fixed row height in px. Must match the actual rendered row height
 *  (padding + line-height below) since the virtualizer uses this to
 *  compute scroll offsets without measuring the DOM. If you change the
 *  row's vertical padding/font-size, update this. */
const ROW_HEIGHT = 30;

/** CSS custom-property name that drives a given column's width. Defined
 *  once per leaf column, on the table's root element (see
 *  `columnWidthVars` in DataTable below), and referenced — never
 *  recomputed per-cell — by that column's header cell AND by that
 *  column's cell in every rendered row, virtualized or not. Resizing a
 *  column is then just one CSSOM write to this property; the browser
 *  fans the new width out to every element referencing it. */
const colWidthVar = (columnId: string) => `--col-${columnId}-w`;

/* ================================================================== */
/*  Column drag-to-reorder (unchanged, already generic)                */
/* ================================================================== */

function arrayMove<T>(array: T[], from: number, to: number): T[] {
    const next = array.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

function DraggableHeaderCell({
    id,
    children,
    onResizeStart,
    onResizeReset,
}: {
    id: string;
    children: React.ReactNode;
    onResizeStart: (id: string, e: React.PointerEvent) => void;
    onResizeReset: (id: string) => void;
}) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

    return (
        <div
            ref={(node) => {
                setDragRef(node);
                setDropRef(node);
            }}
            style={{
                width: `var(${colWidthVar(id)})`,
                opacity: isDragging ? 0.4 : 1,
            }}
            className={`relative flex items-center gap-1 py-1.5 pl-2 pr-3 hover:bg-accent/60 ${isOver ? 'bg-accent' : ''}`}
        >
            <span
                {...attributes}
                {...listeners}
                className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
                title="Drag to reorder"
            >
                <GripVertical className="h-3 w-3" />
            </span>
            {children}

            {/* Resize handle. Deliberately a *sibling* of the grip span
             *  above, not nested inside its {...listeners}, so dnd-kit's
             *  PointerSensor never sees these pointer events — a resize
             *  can't accidentally get picked up as a column reorder.
             *
             *  `right-0` (with no translate) keeps this fully INSIDE the
             *  column's own border box — it used to be centered on the
             *  boundary line (-translate-x-1/2), so half of it sat on top
             *  of the next column's drag grip. The extra `pr-3` (vs. the
             *  cell's own `pl-2`) reserves a dead zone wider than the
             *  handle itself, so it also can't crowd this column's own
             *  sort chevron. */}
            <span
                onPointerDown={(e) => onResizeStart(id, e)}
                onDoubleClick={() => onResizeReset(id)}
                title="Drag to resize · double-click to reset"
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40 active:bg-primary/60"
            />
        </div>
    );
}


/* ================================================================== */
/*  Row component — memoized so selecting one row doesn't force        */
/*  React to reconcile every row in the table.                         */
/* ================================================================== */

interface TableRowProps<TData extends BaseRow> {
    row: Row<TData>;
    selected: boolean;
    /** Not read directly in the row body below — `row.getVisibleCells()`
     *  already reflects the table's current column order whenever it's
     *  called. It's threaded through purely so the memo comparator (see
     *  `TableRow` below) can detect a drag-to-reorder and force this row
     *  to re-render and re-call `getVisibleCells()`. Without it, a
     *  column reorder updates the header (which gets `columnOrder` as an
     *  explicit prop already) but every row's `row` object reference is
     *  untouched by a reorder, so TableRow's memo silently kept the old
     *  cell order — the body looked like it "didn't update" until some
     *  unrelated re-render (e.g. the next streamed row) happened to
     *  paper over it. */
    columnOrder: string[];
    onRowClick: (e: React.MouseEvent, id: number) => void;
    onContextMenu: (id: number) => void;
    getActionIds: (rowId: number) => number[];
    /** If omitted, the row renders with no context menu at all (no Radix
     *  wrapper, no popover) — cheaper than rendering an empty menu. */
    renderContextMenu?: (ctx: RowContextMenuContext<TData>) => React.ReactNode;
    onRemove: (ids: number[]) => void;
}

function TableRowInner<TData extends BaseRow>({
    row,
    selected,
    columnOrder,
    onRowClick,
    onContextMenu,
    getActionIds,
    renderContextMenu,
    onRemove,
}: TableRowProps<TData>) {
    // Not read directly — see the doc comment on `columnOrder` above.
    void columnOrder;

    const rowId = row.original.id;
    // getActionIds is a stable (useCallback([])) function that reads a ref
    // internally, so rowId alone is a sufficient dep.
    const actionIds = useMemo(() => getActionIds(rowId), [getActionIds, rowId]);

    const rowContent = (
        <div
            onClick={(e) => onRowClick(e, rowId)}
            onContextMenu={() => onContextMenu(rowId)}
            className={`flex h-full cursor-pointer items-center border-b border-border/40 ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/50 text-foreground'
                }`}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    key={cell.id}
                    className="truncate px-2 py-1"
                    style={{ width: `var(${colWidthVar(cell.column.id)})` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );

    // No renderer supplied → skip the Radix ContextMenu wrapper entirely
    // instead of mounting one with an empty/undefined content.
    if (!renderContextMenu) {
        return rowContent;
    }

    const ctx: RowContextMenuContext<TData> = {
        rowId,
        row: row.original,
        actionIds,
        isMultiple: actionIds.length > 1,
        onRemove,
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">{renderContextMenu(ctx)}</ContextMenuContent>
        </ContextMenu>
    );
}

const TableRow = React.memo(TableRowInner, (prev, next) => {
    return (
        prev.row === next.row &&
        prev.selected === next.selected &&
        prev.columnOrder === next.columnOrder &&
        prev.onRowClick === next.onRowClick &&
        prev.onContextMenu === next.onContextMenu &&
        prev.getActionIds === next.getActionIds &&
        prev.renderContextMenu === next.renderContextMenu &&
        prev.onRemove === next.onRemove
    );
}) as typeof TableRowInner;



/* ================================================================== */
/*  Header row (sort + drag-to-reorder + resize). Same isolation       */
/*  rationale as the toolbar above — this should never re-render on    */
/*  selection.                                                         */
/* ================================================================== */

interface TableHeaderRowProps<TData extends BaseRow> {
    table: Table<TData>;
    columnOrder: string[];
    sorting: SortingState;
    sensors: ReturnType<typeof useSensors>;
    onColumnDragEnd: (event: DragEndEvent) => void;
    onResizeStart: (id: string, e: React.PointerEvent) => void;
    onResizeReset: (id: string) => void;
}

function TableHeaderRowInner<TData extends BaseRow>({
    table,
    columnOrder,
    sorting,
    sensors,
    onColumnDragEnd,
    onResizeStart,
    onResizeReset,
}: TableHeaderRowProps<TData>) {
    // Not read directly below — table.getHeaderGroups() already reflects
    // them — but declared as explicit props so React.memo actually detects
    // a sort/reorder and re-renders, instead of bailing out because the
    // `table` instance reference never changes.
    void columnOrder;
    void sorting;

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDragEnd}>
            <div className="border-b border-border bg-muted/50 text-muted-foreground">
                {table.getHeaderGroups().map((hg) => (
                    <div key={hg.id} className="flex items-center">
                        {hg.headers.map((header) => (
                            <DraggableHeaderCell
                                key={header.id}
                                id={header.column.id}
                                onResizeStart={onResizeStart}
                                onResizeReset={onResizeReset}
                            >
                                <span
                                    onClick={header.column.getToggleSortingHandler()}
                                    className="flex flex-1 cursor-pointer select-none items-center justify-between gap-1"
                                >
                                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                    </span>
                                    <span className="text-muted-foreground/60">
                                        {header.column.getIsSorted() === 'asc' && <ChevronUp className="h-3 w-3" />}
                                        {header.column.getIsSorted() === 'desc' && <ChevronDown className="h-3 w-3" />}
                                        {!header.column.getIsSorted() && <ChevronsUpDown className="h-3 w-3" />}
                                    </span>
                                </span>
                            </DraggableHeaderCell>
                        ))}
                    </div>
                ))}
            </div>
        </DndContext>
    );
}

const TableHeaderRow = React.memo(TableHeaderRowInner) as typeof TableHeaderRowInner;

/* ================================================================== */
/*  RowsViewport — owns the virtualizer + keyboard navigation.         */
/*                                                                      */
/*  This is the ONLY subtree that re-renders when selection changes    */
/*  (or, now, when columns are reordered — see the `columnOrder` prop  */
/*  and the comment on TableRowProps.columnOrder above). Isolating it  */
/*  here means an arrow-key press no longer re-runs the toolbar, the   */
/*  header, or any of the derivation logic in the parent — it only     */
/*  ever touches this component, and inside it only the rows whose     */
/*  props actually changed re-render (enforced by TableRow's memo      */
/*  comparator above). Column *resizing* deliberately does NOT go      */
/*  through this path at all — see the resize block in DataTable.      */
/* ================================================================== */

interface RowsViewportProps<TData extends BaseRow> {
    visibleRows: Row<TData>[];
    columnOrder: string[];
    selectedIds: Set<number>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
    maxHeight: number;
    fillHeight?: boolean;
    emptyLabel: string;
    emptyHint?: string;
    renderContextMenu?: (ctx: RowContextMenuContext<TData>) => React.ReactNode;
    onRemove: (ids: number[]) => void;
    totalCount?: number;
    windowOffset?: number;
    onScrollWindowChange?: (startIndex: number, count: number) => void;
}

function RowsViewportInner<TData extends BaseRow>({
    visibleRows,
    columnOrder,
    selectedIds,
    setSelectedIds,
    maxHeight,
    fillHeight = false,
    emptyLabel,
    emptyHint,
    renderContextMenu,
    onRemove,
    totalCount,
    windowOffset,
    onScrollWindowChange,
}: RowsViewportProps<TData>) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Stable references so useVirtualizer's own internal option-diffing
    // never sees "new" functions on every render.
    const getScrollElement = useCallback(() => scrollContainerRef.current, []);
    const estimateSize = useCallback(() => ROW_HEIGHT, []);

    const rowVirtualizer = useVirtualizer({
        count: totalCount !== undefined ? totalCount : visibleRows.length,
        getScrollElement,
        estimateSize,
        overscan: 25,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();

    useEffect(() => {
        if (onScrollWindowChange && virtualItems.length > 0) {
            const start = virtualItems[0].index;
            const count = virtualItems.length;
            onScrollWindowChange(start, count);
        }
    }, [virtualItems, onScrollWindowChange]);

    const totalRowCount = totalCount !== undefined ? totalCount : visibleRows.length;
    const totalRowCountRef = useRef(totalRowCount);
    useEffect(() => {
        totalRowCountRef.current = totalRowCount;
    }, [totalRowCount]);

    // Observe container resize (e.g. ResizablePanel drag) and remeasure virtualizer
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(() => {
            rowVirtualizerRef.current?.measure();
        });
        observer.observe(el);
        return () => {
            observer.disconnect();
        };
    }, []);

    // Kept in refs so the keyboard-nav effect below never needs to be
    // re-subscribed, and so it always reads live data.
    const lastClickedId = useRef<number | null>(null);
    const lastClickedVisualIndex = useRef<number | null>(null);
    const pendingVisualIndex = useRef<number | null>(null);
    const visibleIdsRef = useRef<number[]>([]);
    const idIndexRef = useRef<Map<number, number>>(new Map());
    const visibleRowsRef = useRef(visibleRows);
    const windowOffsetRef = useRef(windowOffset);
    const rowVirtualizerRef = useRef(rowVirtualizer);
    const selectedIdsRef = useRef(selectedIds);

    useEffect(() => {
        visibleRowsRef.current = visibleRows;
        windowOffsetRef.current = windowOffset;
        const ids = visibleRows.map((r) => r.original.id);
        visibleIdsRef.current = ids;
        const map = new Map<number, number>();
        for (let i = 0; i < ids.length; i++) map.set(ids[i], i);
        idIndexRef.current = map;

        // If an arrow-key navigation was waiting for a window slice to load:
        if (pendingVisualIndex.current !== null) {
            const offset = windowOffset ?? 0;
            const sliceIndex = pendingVisualIndex.current - offset;
            const targetRow = visibleRows[sliceIndex];
            if (targetRow) {
                pendingVisualIndex.current = null;
                const rowId = targetRow.original.id;
                lastClickedId.current = rowId;
                setSelectedIds(new Set([rowId]));
            }
        }
    }, [visibleRows, windowOffset, setSelectedIds]);

    useEffect(() => {
        rowVirtualizerRef.current = rowVirtualizer;
    });

    useEffect(() => {
        selectedIdsRef.current = selectedIds;
    }, [selectedIds]);

    const handleRowClick = useCallback((e: React.MouseEvent, id: number) => {
        const localIdx = idIndexRef.current.get(id);
        if (localIdx !== undefined) {
            lastClickedVisualIndex.current = (windowOffsetRef.current ?? 0) + localIdx;
        }

        if (e.ctrlKey || e.metaKey) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
            lastClickedId.current = id;
            return;
        }

        if (e.shiftKey && lastClickedId.current !== null) {
            const ids = visibleIdsRef.current;
            const from = ids.indexOf(lastClickedId.current);
            const to = ids.indexOf(id);
            if (from !== -1 && to !== -1) {
                const [start, end] = from < to ? [from, to] : [to, from];
                setSelectedIds(new Set(ids.slice(start, end + 1)));
                return;
            }
        }

        setSelectedIds(new Set([id]));
        lastClickedId.current = id;
    }, [setSelectedIds]);

    const handleRowContextMenu = useCallback((rowId: number) => {
        const localIdx = idIndexRef.current.get(rowId);
        if (localIdx !== undefined) {
            lastClickedVisualIndex.current = (windowOffsetRef.current ?? 0) + localIdx;
        }
        setSelectedIds((prev) => {
            if (prev.has(rowId) && prev.size > 1) return prev;
            return new Set([rowId]);
        });
        lastClickedId.current = rowId;
    }, [setSelectedIds]);

    const getActionIds = useCallback((rowId: number) => {
        const sel = selectedIdsRef.current;
        if (sel.has(rowId) && sel.size > 1) return Array.from(sel);
        return [rowId];
    }, []);

    // Arrow-key navigation across visual rows in table order
    useEffect(() => {
        let pendingTargetIndex: number | null = null;
        let rafId: number | null = null;

        function flush() {
            rafId = null;
            const targetIdx = pendingTargetIndex;
            pendingTargetIndex = null;
            if (targetIdx === null || targetIdx < 0 || targetIdx >= totalRowCountRef.current) return;

            lastClickedVisualIndex.current = targetIdx;

            const offset = windowOffsetRef.current ?? 0;
            const sliceIndex = targetIdx - offset;
            const targetRow = visibleRowsRef.current[sliceIndex];

            if (targetRow) {
                const rowId = targetRow.original.id;
                lastClickedId.current = rowId;
                pendingVisualIndex.current = null;
                flushSync(() => {
                    setSelectedIds(new Set([rowId]));
                });
            } else {
                // Row not yet loaded in windowed slice; record pending and let virtualizer fetch
                pendingVisualIndex.current = targetIdx;
            }

            rowVirtualizerRef.current?.scrollToIndex(targetIdx, { align: 'auto' });
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const count = totalRowCountRef.current;
            if (count === 0) return;

            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable ||
                    target.closest('.cm-editor'))
            ) {
                return;
            }

            e.preventDefault();

            let baseVisualIndex: number;
            if (pendingTargetIndex !== null) {
                baseVisualIndex = pendingTargetIndex;
            } else if (lastClickedVisualIndex.current !== null) {
                baseVisualIndex = lastClickedVisualIndex.current;
            } else if (selectedIdsRef.current.size > 0) {
                const firstId = Array.from(selectedIdsRef.current)[0];
                const localIdx = idIndexRef.current.get(firstId);
                baseVisualIndex = localIdx !== undefined ? (windowOffsetRef.current ?? 0) + localIdx : -1;
            } else {
                baseVisualIndex = -1;
            }

            let nextVisualIndex: number;
            if (baseVisualIndex === -1) {
                nextVisualIndex = e.key === 'ArrowDown' ? 0 : count - 1;
            } else {
                nextVisualIndex =
                    e.key === 'ArrowDown'
                        ? Math.min(baseVisualIndex + 1, count - 1)
                        : Math.max(baseVisualIndex - 1, 0);
            }

            pendingTargetIndex = nextVisualIndex;
            if (rafId === null) {
                rafId = requestAnimationFrame(flush);
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [setSelectedIds]);

    if (visibleRows.length === 0) {
        return (
            <div className={fillHeight ? 'flex min-h-0 flex-1 items-center justify-center py-12 text-center text-muted-foreground' : 'py-12 text-center text-muted-foreground'}>
                <p className="text-[13px]">{emptyLabel}</p>
                {emptyHint && <p className="mt-1 text-[11px]">{emptyHint}</p>}
            </div>
        );
    }

    return (
        <div
            ref={scrollContainerRef}
            className={fillHeight ? 'relative min-h-0 flex-1 overflow-y-auto' : undefined}
            style={fillHeight ? undefined : { maxHeight, overflowY: 'auto', position: 'relative' }}
        >
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {virtualItems.map((virtualItem) => {
                    const sliceIndex = windowOffset !== undefined ? virtualItem.index - windowOffset : virtualItem.index;
                    const row = visibleRows[sliceIndex];
                    if (!row) {
                        return (
                            <div
                                key={`placeholder-${virtualItem.index}`}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: virtualItem.size,
                                    transform: `translateY(${virtualItem.start}px)`,
                                }}
                                className="flex items-center px-4 border-b border-border/40 text-xs text-muted-foreground/60 bg-accent/10 animate-pulse"
                            >
                                <span>Loading row #{virtualItem.index + 1}...</span>
                            </div>
                        );
                    }
                    const rowId = row.original.id;

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
                                selected={selectedIds.has(rowId)}
                                columnOrder={columnOrder}
                                onRowClick={handleRowClick}
                                onContextMenu={handleRowContextMenu}
                                getActionIds={getActionIds}
                                renderContextMenu={renderContextMenu}
                                onRemove={onRemove}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const RowsViewport = React.memo(RowsViewportInner) as typeof RowsViewportInner;

/* ================================================================== */
/*  Main generic component                                             */
/* ================================================================== */

interface DataTableProps<TData extends BaseRow> {
    data: TData[];
    columns: ColumnDef<TData, any>[];
    setSelectedRequest?: (id: number | null) => void;
    selectedRequestId?: number | null;
    emptyLabel?: string;
    emptyHint?: string;
    /** Max height of the scrollable row viewport. Rows outside this
     *  viewport (plus overscan) are not mounted in the DOM. Ignored when
     *  `fillHeight` is true. */
    maxHeight?: number;
    /** Fill the parent height and scroll rows within the remaining space.
     *  Parent must be a bounded container (`h-full` + `min-h-0` flex chain). */
    fillHeight?: boolean;
    /** Caps how many rows are kept for a live-streaming table. When set,
     *  the oldest rows (by position in `data`) beyond this count are
     *  dropped during the merge tick — bounding sort/render cost for
     *  long-running capture sessions instead of letting it grow forever.
     *  Omit for a static/bounded dataset. */
    maxBufferRows?: number;
    /** Minimum width (px) a column can be dragged down to. Default 60. */
    minColumnWidth?: number;
    /** Maximum width (px) a column can be dragged out to. Default 800. */
    maxColumnWidth?: number;
    /** Customize (or fully replace) the row context menu. Receives a
     *  RowContextMenuContext with the clicked row, the current
     *  multi-selection, and DataTable's built-in remove action
     *  ready to call. Return the contents of a ContextMenuContent (labels,
     *  items, separators, subs — whatever you need); DataTable supplies
     *  the ContextMenu/ContextMenuTrigger/ContextMenuContent wrapper.
     *  If omitted, falls back to the built-in Remove menu. Pass an empty
     *  fragment-returning function to suppress the menu. */
    renderRowContextMenu?: (ctx: RowContextMenuContext<TData>) => React.ReactNode;
    totalCount?: number;
    windowOffset?: number;
    onScrollWindowChange?: (startIndex: number, count: number) => void;
    sorting?: SortingState;
    onSortingChange?: (updater: any) => void;
    manualSorting?: boolean;
}

export default function DataTable<TData extends BaseRow>({
    data,
    columns,
    setSelectedRequest,
    selectedRequestId,
    emptyLabel = 'No rows',
    emptyHint,
    maxHeight = 600,
    fillHeight = false,
    maxBufferRows,
    minColumnWidth = 60,
    maxColumnWidth = 800,
    renderRowContextMenu,
    totalCount,
    windowOffset,
    onScrollWindowChange,
    sorting: propsSorting,
    onSortingChange,
    manualSorting = false,
}: DataTableProps<TData>) {
    const [rows, setRows] = useState<TData[]>(data);
    const [internalSorting, setInternalSorting] = useState<SortingState>([]);
    const sorting = propsSorting !== undefined ? propsSorting : internalSorting;
    const setSorting = onSortingChange !== undefined ? onSortingChange : setInternalSorting;

    const latestDataRef = useRef(data);
    latestDataRef.current = data;

    const removedIdsRef = useRef<Set<number>>(new Set());
    const mergeDirtyRef = useRef(false);
    const lastMergedDataRef = useRef<TData[]>(data);

    const computeMergedRows = useCallback(
        (incoming: TData[]): TData[] => {
            const removed = removedIdsRef.current;

            let merged: TData[];
            if (removed.size === 0) {
                merged = incoming;
            } else {
                merged = [];
                for (let i = 0; i < incoming.length; i++) {
                    const r = incoming[i];
                    if (removed.has(r.id)) continue;
                    merged.push(r);
                }
            }

            // Bound memory/CPU growth for long-running capture sessions.
            // Dropping the oldest rows once the buffer is full keeps every
            // per-update pass O(maxBufferRows) instead of O(session length).
            if (maxBufferRows && merged.length > maxBufferRows) {
                const dropCount = merged.length - maxBufferRows;
                for (let i = 0; i < dropCount; i++) {
                    const droppedId = merged[i].id;
                    removedIdsRef.current.delete(droppedId);
                }
                merged = merged.slice(dropCount);
            }

            return merged;
        },
        [maxBufferRows]
    );

    useEffect(() => {
        let rafId: number;
        const tick = () => {
            if (mergeDirtyRef.current || lastMergedDataRef.current !== latestDataRef.current) {
                mergeDirtyRef.current = false;
                lastMergedDataRef.current = latestDataRef.current;
                setRows((prev) => {
                    const merged = computeMergedRows(latestDataRef.current);
                    return merged === prev ? prev : merged;
                });
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [computeMergedRows]);

    const rowsRef = useRef<TData[]>(rows);
    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.id as string));

    const [selectedIds, setSelectedIds] = useState<Set<number>>(() =>
        selectedRequestId != null ? new Set([selectedRequestId]) : new Set()
    );

    const pointerSensorOptions = useMemo(() => ({ activationConstraint: { distance: 8 } }), []);
    const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));

    const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setColumnOrder((prev) => {
            const oldIndex = prev.indexOf(active.id as string);
            const newIndex = prev.indexOf(over.id as string);
            if (oldIndex === -1 || newIndex === -1) return prev;
            return arrayMove(prev, oldIndex, newIndex);
        });
    }, []);

    const table = useReactTable({
        data: rows,
        columns,
        getRowId: (row) => String(row.id),
        state: { sorting, columnVisibility, columnOrder },
        onSortingChange: setSorting,
        manualSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
        meta: { selectedIds } as TableMeta,
    });

    const visibleRows = table.getRowModel().rows;

    const containerRef = useRef<HTMLDivElement>(null);
    const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});

    const columnWidthVars = useMemo(() => {
        const vars: Record<string, string> = {};
        table.getAllLeafColumns().forEach((col) => {
            const width = columnSizing[col.id] ?? col.getSize();
            vars[colWidthVar(col.id)] = `${width}px`;
        });
        return vars;
    }, [table, columnSizing, columns]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        for (const [key, value] of Object.entries(columnWidthVars)) {
            el.style.setProperty(key, value);
        }
    }, [columnWidthVars]);

    const resizeRef = useRef<{
        colId: string;
        startX: number;
        startWidth: number;
        pending: number | null;
        rafId: number | null;
    } | null>(null);

    const handleResizeStart = useCallback(
        (colId: string, e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const col = table.getColumn(colId);
            const startWidth = columnSizing[colId] ?? col?.getSize() ?? minColumnWidth;
            resizeRef.current = { colId, startX: e.clientX, startWidth, pending: null, rafId: null };

            const flush = () => {
                const state = resizeRef.current;
                if (!state) return;
                state.rafId = null;
                if (state.pending === null) return;
                containerRef.current?.style.setProperty(colWidthVar(state.colId), `${state.pending}px`);
            };

            const onMove = (ev: PointerEvent) => {
                const state = resizeRef.current;
                if (!state) return;
                const delta = ev.clientX - state.startX;
                const next = Math.min(maxColumnWidth, Math.max(minColumnWidth, Math.round(state.startWidth + delta)));
                state.pending = next;
                if (state.rafId === null) {
                    state.rafId = requestAnimationFrame(flush);
                }
            };

            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                document.body.style.removeProperty('cursor');
                document.body.style.removeProperty('user-select');

                const state = resizeRef.current;
                resizeRef.current = null;
                if (!state) return;
                if (state.rafId !== null) cancelAnimationFrame(state.rafId);

                const finalWidth = state.pending ?? state.startWidth;
                setColumnSizing((prev) => (prev[state.colId] === finalWidth ? prev : { ...prev, [state.colId]: finalWidth }));
            };

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        },
        [table, columnSizing, minColumnWidth, maxColumnWidth]
    );

    const handleResizeReset = useCallback((colId: string) => {
        setColumnSizing((prev) => {
            if (!(colId in prev)) return prev;
            const next = { ...prev };
            delete next[colId];
            return next;
        });
    }, []);

    const setSelectedRequestRef = useRef(setSelectedRequest);
    useEffect(() => {
        setSelectedRequestRef.current = setSelectedRequest;
    }, [setSelectedRequest]);

    const prevSelectedIdRef = useRef<number | null | undefined>(selectedRequestId);

    useEffect(() => {
        if (selectedRequestId !== undefined && selectedRequestId !== prevSelectedIdRef.current) {
            prevSelectedIdRef.current = selectedRequestId;
            setSelectedIds((prev) => {
                if (selectedRequestId === null) {
                    return prev.size === 0 ? prev : new Set();
                }
                if (prev.size === 1 && prev.has(selectedRequestId)) {
                    return prev;
                }
                return new Set([selectedRequestId]);
            });
        }
    }, [selectedRequestId]);

    useEffect(() => {
        const cb = setSelectedRequestRef.current;
        if (!cb) return;

        const currentSelectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
        if (currentSelectedId !== prevSelectedIdRef.current) {
            prevSelectedIdRef.current = currentSelectedId;
            cb(currentSelectedId);
        }
    }, [selectedIds]);

    const prevRowsLengthRef = useRef(rows.length);
    useEffect(() => {
        const prevLength = prevRowsLengthRef.current;
        prevRowsLengthRef.current = rows.length;
        if (rows.length >= prevLength || rows.length === 0) return;

        setSelectedIds((prev) => {
            const validIds = new Set(rows.map((r) => r.id));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [rows]);

    const removeIds = useCallback((ids: number[]) => {
        ids.forEach((id) => removedIdsRef.current.add(id));
        mergeDirtyRef.current = true;

        setSelectedIds((prev) => {
            if (!ids.some((id) => prev.has(id))) return prev;
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
    }, []);

    const defaultRenderContextMenu = useCallback(
        (ctx: RowContextMenuContext<TData>) => {
            const { actionIds, isMultiple, onRemove } = ctx;

            return (
                <>
                    <ContextMenuLabel className="text-[11px] text-muted-foreground">
                        {isMultiple ? `${actionIds.length} rows` : `Row #${actionIds[0]}`}
                    </ContextMenuLabel>
                    <ContextMenuSeparator />

                    <ContextMenuItem
                        onSelect={() => onRemove(actionIds)}
                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Remove
                    </ContextMenuItem>
                </>
            );
        },
        []
    );

    const resolvedRenderContextMenu = renderRowContextMenu ?? defaultRenderContextMenu;

    return (
        <div
            ref={containerRef}
            className={fillHeight ? 'flex h-full min-h-0 w-full flex-col bg-background' : 'w-full flex flex-col bg-background'}
        >
            <div className={fillHeight
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-card'
                : 'overflow-hidden bg-card'
            }>
                <div className={fillHeight ? 'shrink-0' : undefined}>
                    <TableHeaderRow
                        table={table}
                        columnOrder={columnOrder}
                        sorting={sorting}
                        sensors={sensors}
                        onColumnDragEnd={handleColumnDragEnd}
                        onResizeStart={handleResizeStart}
                        onResizeReset={handleResizeReset}
                    />
                </div>

                <RowsViewport
                    visibleRows={visibleRows}
                    columnOrder={columnOrder}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    maxHeight={maxHeight}
                    fillHeight={fillHeight}
                    emptyLabel={emptyLabel}
                    emptyHint={emptyHint}
                    renderContextMenu={resolvedRenderContextMenu}
                    onRemove={removeIds}
                    totalCount={totalCount}
                    windowOffset={windowOffset}
                    onScrollWindowChange={onScrollWindowChange}
                />
            </div>
        </div>
    );
}