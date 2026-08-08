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
    Layers,
    FolderPlus,
    FolderMinus,
    Circle,
    GripVertical,
} from 'lucide-react';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
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
    group?: string;
};

export type RequestGroup = {
    id: string;
    name: string;
    color: string;
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
/*  plausibly need — including DataTable's built-in group/remove       */
/*  actions — is bundled into `ctx`, so a fully custom menu can still   */
/*  call into the built-in grouping behavior, or ignore it completely   */
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
    /** the group this row currently belongs to, if any. */
    group?: RequestGroup;
    /** all groups that currently exist in the table. */
    groups: RequestGroup[];
    onCreateGroup: (ids: number[]) => void;
    onAssignToGroup: (ids: number[], groupId: string) => void;
    onUngroup: (ids: number[]) => void;
    onRemove: (ids: number[]) => void;
};

const GROUP_PALETTE = ['#B23A2E', '#8F2E24', '#C08A3E', '#3C7A5A', '#5C6360', '#6E4A3E', '#A85D3B'];

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
    group?: RequestGroup;
    groups: RequestGroup[];
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
    onCreateGroup: (ids: number[]) => void;
    onAssignToGroup: (ids: number[], groupId: string) => void;
    onUngroup: (ids: number[]) => void;
    onRemove: (ids: number[]) => void;
}

function TableRowInner<TData extends BaseRow>({
    row,
    selected,
    group,
    groups,
    columnOrder,
    onRowClick,
    onContextMenu,
    getActionIds,
    renderContextMenu,
    onCreateGroup,
    onAssignToGroup,
    onUngroup,
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
            className={`flex h-full cursor-pointer items-center border-b border-border/40 border-l-[3px] ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/50 text-foreground'
                }`}
            style={{ borderLeftColor: group?.color ?? 'transparent' }}
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
        group,
        groups,
        onCreateGroup,
        onAssignToGroup,
        onUngroup,
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
        prev.group?.id === next.group?.id &&
        prev.groups === next.groups &&
        prev.columnOrder === next.columnOrder &&
        prev.onRowClick === next.onRowClick &&
        prev.onContextMenu === next.onContextMenu &&
        prev.getActionIds === next.getActionIds &&
        prev.renderContextMenu === next.renderContextMenu &&
        prev.onCreateGroup === next.onCreateGroup &&
        prev.onAssignToGroup === next.onAssignToGroup &&
        prev.onUngroup === next.onUngroup &&
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
    groups: RequestGroup[];
    groupMap: Map<string, RequestGroup>;
    columnOrder: string[];
    selectedIds: Set<number>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
    maxHeight: number;
    fillHeight?: boolean;
    emptyLabel: string;
    emptyHint?: string;
    renderContextMenu?: (ctx: RowContextMenuContext<TData>) => React.ReactNode;
    onCreateGroup: (ids: number[]) => void;
    onAssignToGroup: (ids: number[], groupId: string) => void;
    onUngroup: (ids: number[]) => void;
    onRemove: (ids: number[]) => void;
}

function RowsViewportInner<TData extends BaseRow>({
    visibleRows,
    groups,
    groupMap,
    columnOrder,
    selectedIds,
    setSelectedIds,
    maxHeight,
    fillHeight = false,
    emptyLabel,
    emptyHint,
    renderContextMenu,
    onCreateGroup,
    onAssignToGroup,
    onUngroup,
    onRemove,
}: RowsViewportProps<TData>) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Stable references so useVirtualizer's own internal option-diffing
    // never sees "new" functions on every render.
    const getScrollElement = useCallback(() => scrollContainerRef.current, []);
    const estimateSize = useCallback(() => ROW_HEIGHT, []);

    const rowVirtualizer = useVirtualizer({
        count: visibleRows.length,
        getScrollElement,
        estimateSize,
        overscan: 12,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();

    // Kept in refs so the keyboard-nav effect below never needs to be
    // re-subscribed, and so it always reads live data.
    const lastClickedId = useRef<number | null>(null);
    const visibleIdsRef = useRef<number[]>([]);
    const idIndexRef = useRef<Map<number, number>>(new Map());
    const rowVirtualizerRef = useRef(rowVirtualizer);
    const selectedIdsRef = useRef(selectedIds);

    useEffect(() => {
        const ids = visibleRows.map((r) => r.original.id);
        visibleIdsRef.current = ids;
        const map = new Map<number, number>();
        for (let i = 0; i < ids.length; i++) map.set(ids[i], i);
        idIndexRef.current = map;
    }, [visibleRows]);

    useEffect(() => {
        rowVirtualizerRef.current = rowVirtualizer;
    });

    useEffect(() => {
        selectedIdsRef.current = selectedIds;
    }, [selectedIds]);

    const handleRowClick = useCallback((e: React.MouseEvent, id: number) => {
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

    // Arrow-key navigation.
    //
    // Multiple keydowns in the same frame are coalesced into a single
    // commit via rAF (holding the key down shouldn't queue more renders
    // than the browser can paint).
    //
    // FIX (was: Maximum update depth exceeded / flushSync-inside-flushSync):
    // @tanstack/react-virtual's React adapter wraps its own re-render in
    // flushSync whenever a scroll/measurement update needs to land
    // synchronously. Previously `setSelectedIds` and `scrollToIndex` were
    // both called inside a single flushSync(...) callback, so calling
    // scrollToIndex triggered the virtualizer's *own* internal flushSync
    // while React was still mid-commit from our outer one — a nested
    // flush that can cascade into repeated correction passes and blow
    // past React's nested-update guard.
    //
    // The fix is to NOT nest them: flushSync only the selection state
    // (forces it to commit synchronously), then call scrollToIndex
    // afterwards, outside that flushSync. Both still run synchronously,
    // back-to-back, in the same tick/frame — before the browser paints —
    // so the highlight and the newly-mounted row still land together.
    // scrollToIndex manages its own internal flushSync independently now,
    // instead of being nested inside ours.
    useEffect(() => {
        let pendingIndex: number | null = null;
        let rafId: number | null = null;

        function flush() {
            rafId = null;
            const idx = pendingIndex;
            pendingIndex = null;
            if (idx === null) return;
            const nextId = visibleIdsRef.current[idx];
            if (nextId === undefined) return;
            lastClickedId.current = nextId;

            flushSync(() => {
                setSelectedIds(new Set([nextId]));
            });
            rowVirtualizerRef.current?.scrollToIndex(idx, { align: 'auto' });
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const ids = visibleIdsRef.current;
            if (ids.length === 0) return;
            e.preventDefault();

            const baseIndex =
                pendingIndex !== null
                    ? pendingIndex
                    : lastClickedId.current !== null
                        ? idIndexRef.current.get(lastClickedId.current) ?? -1
                        : -1;

            const nextIndex =
                e.key === 'ArrowDown'
                    ? Math.min(baseIndex + 1, ids.length - 1)
                    : Math.max(baseIndex - 1, 0);

            pendingIndex = Math.max(nextIndex, 0);
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
                    const row = visibleRows[virtualItem.index];
                    const rowId = row.original.id;
                    const groupId = row.original.group;
                    const group = groupId ? groupMap.get(groupId) : undefined;

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
                                group={group}
                                groups={groups}
                                columnOrder={columnOrder}
                                onRowClick={handleRowClick}
                                onContextMenu={handleRowContextMenu}
                                getActionIds={getActionIds}
                                renderContextMenu={renderContextMenu}
                                onCreateGroup={onCreateGroup}
                                onAssignToGroup={onAssignToGroup}
                                onUngroup={onUngroup}
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
     *  multi-selection, and DataTable's built-in group/remove actions
     *  ready to call. Return the contents of a ContextMenuContent (labels,
     *  items, separators, subs — whatever you need); DataTable supplies
     *  the ContextMenu/ContextMenuTrigger/ContextMenuContent wrapper.
     *  If omitted, falls back to the built-in New group / Add to group /
     *  Ungroup / Remove menu. Pass an empty fragment-returning function
     *  to suppress the menu without losing the built-in group state. */
    renderRowContextMenu?: (ctx: RowContextMenuContext<TData>) => React.ReactNode;
}

export default function DataTable<TData extends BaseRow>({
    data,
    columns,
    setSelectedRequest,
    emptyLabel = 'No rows',
    emptyHint,
    maxHeight = 600,
    fillHeight = false,
    maxBufferRows,
    minColumnWidth = 60,
    maxColumnWidth = 800,
    renderRowContextMenu,
}: DataTableProps<TData>) {
    const [rows, setRows] = useState<TData[]>(data);

    // ------------------------------------------------------------------
    // FIX #1 — local-only edits (grouping, removal) no longer get
    // stomped by the next streamed update.
    //
    // Previously the rAF sync loop did:
    //   setRows(prev => prev === latestDataRef.current ? prev : latestDataRef.current)
    // i.e. it *replaced* `rows` outright with the incoming `data` prop
    // whenever they differed by reference. But grouping/removal mutate
    // the local `rows` copy only (they have nowhere else to write to —
    // `data` is owned by the parent/Redux). Under a live stream pushing
    // 60-80 updates/sec, `data` changes reference almost every frame, so
    // the very next tick after a user grouped or removed rows would
    // overwrite `rows` back to the raw, group-less, un-removed `data` —
    // the action visibly reverted within ~16ms.
    //
    // Fix: `rows` is now a *merge* of the incoming `data` with two
    // local-only overlays tracked in refs (so mutating them doesn't
    // itself trigger renders — only marking the merge dirty does):
    //   - `groupOverridesRef`: id -> groupId | null (null = explicitly
    //     ungrouped). Applied on top of whatever `group` value (if any)
    //     the incoming row carries.
    //   - `removedIdsRef`: ids locally removed, filtered out of every
    //     incoming `data` even if the upstream stream still includes them.
    // The rAF loop still runs at most once per frame, but now recomputes
    // the merge (instead of blindly copying) whenever either the
    // incoming `data` reference changed OR a local action marked the
    // merge dirty.
    const latestDataRef = useRef(data);
    latestDataRef.current = data;

    const removedIdsRef = useRef<Set<number>>(new Set());
    const groupOverridesRef = useRef<Map<number, string | null>>(new Map());
    const mergeDirtyRef = useRef(false);
    const lastMergedDataRef = useRef<TData[]>(data);

    const computeMergedRows = useCallback(
        (incoming: TData[]): TData[] => {
            const removed = removedIdsRef.current;
            const overrides = groupOverridesRef.current;

            let merged: TData[];
            if (removed.size === 0 && overrides.size === 0) {
                merged = incoming;
            } else {
                merged = [];
                for (let i = 0; i < incoming.length; i++) {
                    const r = incoming[i];
                    if (removed.has(r.id)) continue;
                    if (overrides.has(r.id)) {
                        const ov = overrides.get(r.id);
                        const nextGroup = ov === null ? undefined : ov;
                        merged.push(r.group === nextGroup ? r : { ...r, group: nextGroup });
                    } else {
                        merged.push(r);
                    }
                }
            }

            // FIX #4 — bound memory/CPU growth for long-running capture
            // sessions. Without a cap, `rows` (and therefore every sort
            // pass derived from it) grows for as long as the session
            // runs, so the same operation gets slower over time.
            // Dropping the oldest rows once the buffer is full keeps every
            // per-update pass O(maxBufferRows) instead of O(session length).
            if (maxBufferRows && merged.length > maxBufferRows) {
                const dropCount = merged.length - maxBufferRows;
                for (let i = 0; i < dropCount; i++) {
                    const droppedId = merged[i].id;
                    // Clean up the overlays too, or they'd accumulate
                    // forever for rows that have scrolled out of the buffer.
                    removedIdsRef.current.delete(droppedId);
                    groupOverridesRef.current.delete(droppedId);
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

    // Read-only mirror of `rows`, kept for callbacks (group/remove actions)
    // that need to see current row content without depending on `rows`
    // directly — depending on it would make those callbacks' identities
    // churn every frame during streaming, defeating TableRow's memo.
    const rowsRef = useRef<TData[]>(rows);
    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.id as string));

    // Selection lives here (not pushed down into RowsViewport) because it
    // also has to feed `meta.selectedIds` on the `table` instance below, for
    // consumer column-defs that use the exported `isRowSelected` helper.
    // Everything that doesn't need it — the toolbar and header below — is
    // isolated in its own memoized component so this state changing does
    // not force them to reconcile.
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const [groups, setGroups] = useState<RequestGroup[]>([]);
    const groupCounter = useRef(0);
    const colorCursor = useRef(0);

    // O(1) group lookup instead of groups.find(...) per row per render.
    const groupMap = useMemo(() => {
        const map = new Map<string, RequestGroup>();
        groups.forEach((g) => map.set(g.id, g));
        return map;
    }, [groups]);

    // Hoisted so dnd-kit's internal useMemo (keyed on this options object)
    // doesn't see a "new" value every render, which would otherwise make
    // `sensors` a fresh array every render and defeat TableHeaderRow's memo.
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
        // FIX #2 — stable row identity. Without this, TanStack Table
        // defaults `row.id` to array index, so after any sort/filter/
        // insert the row that *used to* sit at index N and the row that
        // *now* sits at index N share the same `row.id` even though
        // they're different underlying requests. That breaks `key={row.id}`
        // in RowsViewport (React reconciles the wrong DOM node against the
        // wrong data) and anything downstream that assumes row identity
        // tracks the request it came from.
        getRowId: (row) => String(row.id),
        state: { sorting, columnVisibility, columnOrder },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        meta: { selectedIds } as TableMeta,
    });

    // Stable across selection-only re-renders: tanstack-table memoizes the
    // row model on [data, sorting, columnOrder, ...] — none of which change
    // when `selectedIds` changes — so this reference doesn't churn on
    // arrow-key nav.
    const visibleRows = table.getRowModel().rows;

    // ------------------------------------------------------------------
    // Column resizing.
    //
    // Perf constraint: this table can be receiving 60-80 streamed row
    // updates/sec (see the merge-tick effect above), so anything that
    // runs on every pointermove during a drag — and would ALSO cause the
    // whole virtualized row list to re-render — is a non-starter; it'd be
    // fighting the stream for every animation frame, and jank on every
    // resize.
    //
    // So resizing never touches React state while the pointer is down.
    // Every column's width lives in one CSS custom property
    // (`--col-<id>-w`, see `colWidthVar` up top) defined on this table's
    // own root element and referenced via var(...) by that column's
    // header cell AND by that column's cell in every rendered row. During
    // a drag we write straight to `containerRef.current.style` — bypassing
    // React entirely — so a resize is a single CSSOM write per animation
    // frame that the browser fans out to every element referencing that
    // var, not a React re-render of N row components.
    //
    // `columnSizing` (React state) is written exactly once, on pointer-up.
    // That's the only state touched, and it isn't part of `useReactTable`'s
    // `state` — so `table`, `visibleRows`, and everything RowsViewport
    // depends on stay referentially identical across a resize commit, and
    // RowsViewport's React.memo bails out without re-rendering a single
    // row. Only the toolbar/header (which read `table` directly) re-render.
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

    // The only thing that ever writes these vars through React — and it
    // only re-runs when `columnSizing` (a committed resize) or the column
    // set itself changes, never on the high-frequency streaming
    // re-renders. That matters: if this ran every render, it would stomp
    // an in-progress drag's live CSSOM value back to the last *committed*
    // width up to 60-80 times a second.
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

            // rAF-coalesced, same pattern as the keyboard-nav fix above:
            // however many pointermove events fire in a frame, only the
            // last one before paint gets written to the DOM.
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

                // The one and only React state write in the whole drag —
                // everything up to here was a direct DOM mutation — so a
                // resize costs one re-render total, not one per pixel.
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

    useEffect(() => {
        if (!setSelectedRequest) return;
        if (selectedIds.size === 1) {
            setSelectedRequest(Array.from(selectedIds)[0]);
        } else {
            setSelectedRequest(null);
        }
    }, [selectedIds, setSelectedRequest]);

    // Safety net for `data` shrinking via the external prop (e.g. a
    // parent-driven reset/clear-session), as opposed to a local removal
    // (which is handled immediately and precisely by `removeIds` below).
    // Only runs when row count actually drops, so it stays out of the way
    // of the streaming append path.
    const prevRowsLengthRef = useRef(rows.length);
    useEffect(() => {
        const prevLength = prevRowsLengthRef.current;
        prevRowsLengthRef.current = rows.length;
        if (rows.length >= prevLength) return; // append/no-op: nothing to prune

        setSelectedIds((prev) => {
            const validIds = new Set(rows.map((r) => r.id));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });

        setGroups((prev) => {
            const usedIds = new Set(rows.map((r) => r.group).filter(Boolean));
            const next = prev.filter((g) => usedIds.has(g.id));
            return next.length === prev.length ? prev : next;
        });
    }, [rows]);

    // FIX #5 — group pruning no longer nests setState calls inside
    // setState updaters (setGroups(prev => { setRows(cur => { setGroups...
    // }) })), which is fragile and can double-fire under StrictMode.
    // Instead it reads current row content from `rowsRef` (a plain ref,
    // not reactive state) and folds in the not-yet-merged overrides
    // directly, so it can run as an ordinary function call from within
    // the action that triggered it. This only runs on user-driven group/
    // remove actions (human-paced), never on every streamed update, so
    // the O(n) scan here is not a performance concern.
    const pruneUnusedGroups = useCallback(() => {
        setGroups((prev) => {
            if (prev.length === 0) return prev;
            const used = new Set<string>();
            for (const r of rowsRef.current) {
                if (removedIdsRef.current.has(r.id)) continue;
                let g: string | undefined;
                if (groupOverridesRef.current.has(r.id)) {
                    const ov = groupOverridesRef.current.get(r.id);
                    g = ov === null ? undefined : ov;
                } else {
                    g = r.group;
                }
                if (g) used.add(g);
            }
            const next = prev.filter((grp) => used.has(grp.id));
            return next.length === prev.length ? prev : next;
        });
    }, []);

    const createGroupAndAssign = useCallback((ids: number[]) => {
        groupCounter.current += 1;
        const color = GROUP_PALETTE[colorCursor.current % GROUP_PALETTE.length];
        colorCursor.current += 1;
        const newGroup: RequestGroup = {
            id: `grp-${Date.now()}-${groupCounter.current}`,
            name: `Group ${groupCounter.current}`,
            color,
        };
        setGroups((prev) => [...prev, newGroup]);
        ids.forEach((id) => groupOverridesRef.current.set(id, newGroup.id));
        mergeDirtyRef.current = true;
    }, []);

    const assignToGroup = useCallback((ids: number[], groupId: string) => {
        ids.forEach((id) => groupOverridesRef.current.set(id, groupId));
        mergeDirtyRef.current = true;
        // Reassigning can empty out the group these ids used to belong to.
        pruneUnusedGroups();
    }, [pruneUnusedGroups]);

    const ungroupIds = useCallback((ids: number[]) => {
        ids.forEach((id) => groupOverridesRef.current.set(id, null));
        mergeDirtyRef.current = true;
        pruneUnusedGroups();
    }, [pruneUnusedGroups]);

    const removeIds = useCallback((ids: number[]) => {
        ids.forEach((id) => removedIdsRef.current.add(id));
        mergeDirtyRef.current = true;

        // Immediate, O(ids.length) prune — no need to wait for the merge
        // tick or the shrink-detecting effect above.
        setSelectedIds((prev) => {
            if (!ids.some((id) => prev.has(id))) return prev;
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });

        pruneUnusedGroups();
    }, [pruneUnusedGroups]);

    // Default context menu — reproduces the original hardcoded behavior
    // (New group / Add to group / Ungroup / Remove) so DataTable still
    // works out of the box if `renderRowContextMenu` isn't supplied.
    // Consumers that want something else entirely (different actions,
    // domain-specific items, or no menu at all) just pass their own
    // `renderRowContextMenu` and this is never called.
    const defaultRenderContextMenu = useCallback(
        (ctx: RowContextMenuContext<TData>) => {
            const { actionIds, isMultiple, group, groups: allGroups, onCreateGroup, onAssignToGroup, onUngroup, onRemove } = ctx;
            const otherGroups = allGroups.filter((g) => g.id !== group?.id);

            return (
                <>
                    <ContextMenuLabel className="text-[11px] text-muted-foreground">
                        {isMultiple ? `${actionIds.length} rows` : `Row #${actionIds[0]}`}
                    </ContextMenuLabel>
                    <ContextMenuSeparator />

                    <ContextMenuItem onSelect={() => onCreateGroup(actionIds)}>
                        <FolderPlus className="mr-2 h-3.5 w-3.5" />
                        New group
                    </ContextMenuItem>

                    <ContextMenuSub>
                        <ContextMenuSubTrigger disabled={otherGroups.length === 0}>
                            <Layers className="mr-2 h-3.5 w-3.5" />
                            Add to group
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            {otherGroups.length === 0 && (
                                <ContextMenuItem disabled>No other groups yet</ContextMenuItem>
                            )}
                            {otherGroups.map((g) => (
                                <ContextMenuItem key={g.id} onSelect={() => onAssignToGroup(actionIds, g.id)}>
                                    <Circle className="mr-2 h-3 w-3" style={{ color: g.color, fill: g.color }} />
                                    {g.name}
                                </ContextMenuItem>
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>

                    <ContextMenuItem onSelect={() => onUngroup(actionIds)} disabled={!group}>
                        <FolderMinus className="mr-2 h-3.5 w-3.5" />
                        Ungroup
                    </ContextMenuItem>

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
            {/* <div className={fillHeight ? 'shrink-0' : undefined}>
                <TableToolbar table={table} columnVisibility={columnVisibility} totalCount={rows.length} />
            </div> */}

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
                    groups={groups}
                    groupMap={groupMap}
                    columnOrder={columnOrder}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    maxHeight={maxHeight}
                    fillHeight={fillHeight}
                    emptyLabel={emptyLabel}
                    emptyHint={emptyHint}
                    renderContextMenu={resolvedRenderContextMenu}
                    onCreateGroup={createGroupAndAssign}
                    onAssignToGroup={assignToGroup}
                    onUngroup={ungroupIds}
                    onRemove={removeIds}
                />
            </div>
        </div>
    );
}