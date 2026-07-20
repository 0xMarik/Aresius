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
    Search,
    SlidersHorizontal,
    Trash2,
    Layers,
    X,
    Check,
    RotateCcw,
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

const GROUP_PALETTE = ['#B23A2E', '#8F2E24', '#C08A3E', '#3C7A5A', '#5C6360', '#6E4A3E', '#A85D3B'];

/** Fixed row height in px. Must match the actual rendered row height
 *  (padding + line-height below) since the virtualizer uses this to
 *  compute scroll offsets without measuring the DOM. If you change the
 *  row's vertical padding/font-size, update this. */
const ROW_HEIGHT = 30;

/* ================================================================== */
/*  Facet filters — replaces the hardcoded Method/State dropdowns      */
/* ================================================================== */

export type FacetFilter<TData> = {
    id: string;
    label: string;
    getValue: (row: TData) => string;
};

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
    width,
    children,
}: {
    id: string;
    width: number;
    children: React.ReactNode;
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
                width,
                opacity: isDragging ? 0.4 : 1,
                backgroundColor: isOver ? '#F4E4DE' : undefined,
            }}
            className="flex items-center gap-1 px-2 py-1.5 hover:bg-[#F4EEE3]"
        >
            <span
                {...attributes}
                {...listeners}
                className="cursor-grab text-[#C9C2B2] hover:text-[#9A9A90] active:cursor-grabbing"
                title="Drag to reorder"
            >
                <GripVertical className="h-3 w-3" />
            </span>
            {children}
        </div>
    );
}

/* ================================================================== */
/*  Small reusable dropdown (unchanged)                                */
/* ================================================================== */

function Dropdown({
    label,
    icon,
    badge,
    children,
}: {
    label: string;
    icon: React.ReactNode;
    badge?: number;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((o) => !o)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]  ${open ? 'border-[#E3DCCC] bg-[#FAF7F2]' : 'border-[#E3DCCC] bg-white hover:bg-[#FAF7F2]'
                    }`}
            >
                {icon}
                <span className="text-[#5C6360]">{label}</span>
                {!!badge && (
                    <span className="rounded-full bg-[#B23A2E] px-1.5 text-[10px] font-semibold text-white">{badge}</span>
                )}
            </button>
            {open && (
                <div className="absolute left-0 z-20 mt-1 min-w-[180px] rounded-md border border-[#E3DCCC] bg-white p-1 shadow-lg">
                    {children}
                </div>
            )}
        </div>
    );
}

function DropdownCheckboxItem({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
    return (
        <button
            onClick={onToggle}
            className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[12px] text-[#1B211E] hover:bg-[#FAF7F2]"
        >
            <span className="truncate">{label}</span>
            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${checked ? 'border-[#B23A2E] bg-[#B23A2E]' : 'border-[#E3DCCC]'}`}>
                {checked && <Check className="h-2.5 w-2.5 text-white" />}
            </span>
        </button>
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
    onRowClick: (e: React.MouseEvent, id: number) => void;
    onContextMenu: (id: number) => void;
    onCreateGroup: (ids: number[]) => void;
    onAssignToGroup: (ids: number[], groupId: string) => void;
    onUngroup: (ids: number[]) => void;
    onRemove: (ids: number[]) => void;
    getActionIds: (rowId: number) => number[];
}

function TableRowInner<TData extends BaseRow>({
    row,
    selected,
    group,
    groups,
    onRowClick,
    onContextMenu,
    onCreateGroup,
    onAssignToGroup,
    onUngroup,
    onRemove,
    getActionIds,
}: TableRowProps<TData>) {
    const rowId = row.original.id;
    const groupId = row.original.group;

    const otherGroups = useMemo(() => groups.filter((g) => g.id !== groupId), [groups, groupId]);
    // getActionIds is a stable (useCallback([])) function that reads a ref
    // internally, so rowId alone is a sufficient dep.
    const actionIds = useMemo(() => getActionIds(rowId), [getActionIds, rowId]);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    onClick={(e) => onRowClick(e, rowId)}
                    onContextMenu={() => onContextMenu(rowId)}
                    className={`flex h-full cursor-pointer items-center border-b border-[#F0EDE6] border-l-[3px]  ${selected ? 'bg-[#B23A2E]' : 'hover:bg-[#FAF7F2]'
                        }`}
                    style={{ borderLeftColor: group?.color ?? 'transparent' }}
                >
                    {row.getVisibleCells().map((cell) => (
                        <div key={cell.id} className="truncate px-2 py-1" style={{ width: cell.column.getSize() }}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                    ))}
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuLabel className="text-[11px] text-[#9A9A90]">
                    {actionIds.length > 1 ? `${actionIds.length} rows` : `Row #${rowId}`}
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

                <ContextMenuItem onSelect={() => onUngroup(actionIds)} disabled={!groupId}>
                    <FolderMinus className="mr-2 h-3.5 w-3.5" />
                    Ungroup
                </ContextMenuItem>

                <ContextMenuSeparator />

                <ContextMenuItem
                    onSelect={() => onRemove(actionIds)}
                    className="text-[#C0392B] focus:text-[#C0392B]"
                >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Remove
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

const TableRow = React.memo(TableRowInner, (prev, next) => {
    return (
        prev.row === next.row &&
        prev.selected === next.selected &&
        prev.group?.id === next.group?.id &&
        prev.groups === next.groups &&
        prev.onRowClick === next.onRowClick &&
        prev.onContextMenu === next.onContextMenu &&
        prev.onCreateGroup === next.onCreateGroup &&
        prev.onAssignToGroup === next.onAssignToGroup &&
        prev.onUngroup === next.onUngroup &&
        prev.onRemove === next.onRemove &&
        prev.getActionIds === next.getActionIds
    );
}) as typeof TableRowInner;

/* ================================================================== */
/*  Toolbar — search / facets / column visibility / reset / count.     */
/*  Extracted so that selection changes (arrow-key nav) never touch    */
/*  this subtree: none of its props change on selection, so            */
/*  React.memo bails out and it is skipped entirely during             */
/*  reconciliation, not just "cheaply re-rendered".                    */
/* ================================================================== */

interface TableToolbarProps<TData extends BaseRow> {
    search: string;
    onSearchChange: (value: string) => void;
    onClearSearch: () => void;
    searchPlaceholder: string;
    facetFilters: FacetFilter<TData>[];
    facetOptions: Record<string, string[]>;
    facetState: Record<string, Set<string>>;
    onToggleFacet: (facetId: string, value: string) => void;
    table: Table<TData>;
    columnVisibility: VisibilityState;
    hasActiveFilters: boolean;
    onClearFilters: () => void;
    filteredCount: number;
    totalCount: number;
}

function TableToolbarInner<TData extends BaseRow>({
    search,
    onSearchChange,
    onClearSearch,
    searchPlaceholder,
    facetFilters,
    facetOptions,
    facetState,
    onToggleFacet,
    table,
    columnVisibility,
    hasActiveFilters,
    onClearFilters,
    filteredCount,
    totalCount,
}: TableToolbarProps<TData>) {
    // `table` is a stable instance (tanstack mutates it in place rather than
    // returning a new object), so it alone can't tell React.memo that a
    // column was hidden/shown. `columnVisibility` is threaded through as an
    // explicit prop for that reason, and doubles as a genuinely useful
    // "N hidden" badge on the Columns dropdown.
    const hiddenCount = Object.values(columnVisibility).filter((v) => v === false).length;

    return (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-[#E3DCCC] bg-white px-2 py-1">
                <Search className="h-3.5 w-3.5 text-[#9A9A90]" />
                <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-56 border-none bg-transparent text-[12px] text-[#1B211E] outline-none placeholder:text-[#9A9A90]"
                />
                {search && (
                    <button onClick={onClearSearch} className="text-[#C9C2B2] hover:text-[#5C6360]">
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {facetFilters.map((f) => (
                <Dropdown
                    key={f.id}
                    label={f.label}
                    icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#9A9A90]" />}
                    badge={facetState[f.id]?.size}
                >
                    {(facetOptions[f.id] ?? []).map((value) => (
                        <DropdownCheckboxItem
                            key={value}
                            label={value}
                            checked={facetState[f.id]?.has(value) ?? false}
                            onToggle={() => onToggleFacet(f.id, value)}
                        />
                    ))}
                </Dropdown>
            ))}

            <Dropdown
                label="Columns"
                icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#9A9A90]" />}
                badge={hiddenCount || undefined}
            >
                {table.getAllLeafColumns().map((col) => (
                    <DropdownCheckboxItem
                        key={col.id}
                        label={String(col.columnDef.header)}
                        checked={col.getIsVisible()}
                        onToggle={col.getToggleVisibilityHandler() as unknown as () => void}
                    />
                ))}
            </Dropdown>

            {hasActiveFilters && (
                <button
                    onClick={onClearFilters}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#9A9A90] hover:text-[#5C6360]"
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                </button>
            )}

            <div className="ml-auto text-[12px] text-[#9A9A90]">
                {filteredCount} of {totalCount} rows
            </div>
        </div>
    );
}

const TableToolbar = React.memo(TableToolbarInner) as typeof TableToolbarInner;

/* ================================================================== */
/*  Header row (sort + drag-to-reorder). Same isolation rationale as   */
/*  the toolbar above — this should never re-render on selection.      */
/* ================================================================== */

interface TableHeaderRowProps<TData extends BaseRow> {
    table: Table<TData>;
    columnOrder: string[];
    sorting: SortingState;
    sensors: ReturnType<typeof useSensors>;
    onColumnDragEnd: (event: DragEndEvent) => void;
}

function TableHeaderRowInner<TData extends BaseRow>({
    table,
    columnOrder,
    sorting,
    sensors,
    onColumnDragEnd,
}: TableHeaderRowProps<TData>) {
    // Not read directly below — table.getHeaderGroups() already reflects
    // them — but declared as explicit props so React.memo actually detects
    // a sort/reorder and re-renders, instead of bailing out because the
    // `table` instance reference never changes.
    void columnOrder;
    void sorting;

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDragEnd}>
            <div className="border-b border-[#E3DCCC] bg-[#FAF7F2]">
                {table.getHeaderGroups().map((hg) => (
                    <div key={hg.id} className="flex items-center">
                        {hg.headers.map((header) => (
                            <DraggableHeaderCell key={header.id} id={header.column.id} width={header.getSize()}>
                                <span
                                    onClick={header.column.getToggleSortingHandler()}
                                    className="flex flex-1 cursor-pointer select-none items-center justify-between gap-1"
                                >
                                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#5C6360]">
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                    </span>
                                    <span className="text-[#C9C2B2]">
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
/*  This is the ONLY subtree that re-renders when selection changes.   */
/*  Isolating it here means an arrow-key press no longer re-runs the   */
/*  toolbar, the header, or any of the filtering/derivation logic in   */
/*  the parent — it only ever touches this component, and inside it    */
/*  only the two rows whose `selected` prop actually flipped re-render */
/*  (enforced by TableRow's memo comparator above).                    */
/* ================================================================== */

interface RowsViewportProps<TData extends BaseRow> {
    visibleRows: Row<TData>[];
    groups: RequestGroup[];
    groupMap: Map<string, RequestGroup>;
    selectedIds: Set<number>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
    maxHeight: number;
    totalRowsCount: number;
    emptyLabel: string;
    emptyHint?: string;
    onCreateGroup: (ids: number[]) => void;
    onAssignToGroup: (ids: number[], groupId: string) => void;
    onUngroup: (ids: number[]) => void;
    onRemove: (ids: number[]) => void;
}

function RowsViewportInner<TData extends BaseRow>({
    visibleRows,
    groups,
    groupMap,
    selectedIds,
    setSelectedIds,
    maxHeight,
    totalRowsCount,
    emptyLabel,
    emptyHint,
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
    // than the browser can paint). The commit itself is wrapped in
    // flushSync together with scrollToIndex: without that, `setSelectedIds`
    // (a normal, batched update) and the scroll-triggered mount of newly
    // visible rows can land a frame apart. That one-frame gap is exactly
    // the "hold" where the highlight jumps but the row hasn't appeared
    // yet (or vice versa). flushSync forces both into the same paint.
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
                rowVirtualizerRef.current?.scrollToIndex(idx, { align: 'auto' });
            });
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
            <div className="py-12 text-center text-[#9A9A90]">
                <p className="text-[13px]">{totalRowsCount === 0 ? emptyLabel : 'No rows match the current filters'}</p>
                {emptyHint && (
                    <p className="mt-1 text-[11px]">{totalRowsCount === 0 ? emptyHint : 'Try clearing search or filters'}</p>
                )}
            </div>
        );
    }

    return (
        <div ref={scrollContainerRef} style={{ maxHeight, overflowY: 'auto', position: 'relative' }}>
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
                                onRowClick={handleRowClick}
                                onContextMenu={handleRowContextMenu}
                                onCreateGroup={onCreateGroup}
                                onAssignToGroup={onAssignToGroup}
                                onUngroup={onUngroup}
                                onRemove={onRemove}
                                getActionIds={getActionIds}
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
    searchFn?: (row: TData, query: string) => boolean;
    facetFilters?: FacetFilter<TData>[];
    searchPlaceholder?: string;
    emptyLabel?: string;
    emptyHint?: string;
    /** Max height of the scrollable row viewport. Rows outside this
     *  viewport (plus overscan) are not mounted in the DOM. */
    maxHeight?: number;
}

export default function DataTable<TData extends BaseRow>({
    data,
    columns,
    setSelectedRequest,
    searchFn,
    facetFilters = [],
    searchPlaceholder = 'Search…',
    emptyLabel = 'No rows',
    emptyHint,
    maxHeight = 600,
}: DataTableProps<TData>) {
    const [rows, setRows] = useState<TData[]>(data);
    useEffect(() => setRows(data), [data]);

    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.id as string));

    const [search, setSearch] = useState('');
    const [facetState, setFacetState] = useState<Record<string, Set<string>>>({});

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

    const facetOptions = useMemo(() => {
        const map: Record<string, string[]> = {};
        facetFilters.forEach((f) => {
            map[f.id] = Array.from(new Set(rows.map((r) => f.getValue(r)))).sort();
        });
        return map;
    }, [rows, facetFilters]);

    const toggleFacetValue = useCallback((facetId: string, value: string) => {
        setFacetState((prev) => {
            const next = new Set(prev[facetId] ?? []);
            next.has(value) ? next.delete(value) : next.add(value);
            return { ...prev, [facetId]: next };
        });
    }, []);

    const defaultSearch = useCallback(
        (row: TData, q: string) =>
            Object.values(row as Record<string, unknown>).some(
                (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q)
            ),
        []
    );

    const filteredData = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            for (const f of facetFilters) {
                const active = facetState[f.id];
                if (active && active.size > 0 && !active.has(f.getValue(r))) return false;
            }
            if (!q) return true;
            return (searchFn ?? defaultSearch)(r, q);
        });
    }, [rows, search, facetFilters, facetState, searchFn, defaultSearch]);

    const table = useReactTable({
        data: filteredData,
        columns,
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

    useEffect(() => {
        if (!setSelectedRequest) return;
        if (selectedIds.size === 1) {
            setSelectedRequest(Array.from(selectedIds)[0]);
        } else {
            setSelectedRequest(null);
        }
    }, [selectedIds, setSelectedRequest]);

    useEffect(() => {
        setSelectedIds((prev) => {
            const validIds = new Set(rows.map((r) => r.id));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [rows]);

    useEffect(() => {
        setGroups((prev) => {
            const usedIds = new Set(rows.map((r) => r.group).filter(Boolean));
            const next = prev.filter((g) => usedIds.has(g.id));
            return next.length === prev.length ? prev : next;
        });
    }, [rows]);

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
        const idSet = new Set(ids);
        setRows((prev) => prev.map((r) => (idSet.has(r.id) ? { ...r, group: newGroup.id } : r)));
    }, []);

    const assignToGroup = useCallback((ids: number[], groupId: string) => {
        const idSet = new Set(ids);
        setRows((prev) => prev.map((r) => (idSet.has(r.id) ? { ...r, group: groupId } : r)));
    }, []);

    const ungroupIds = useCallback((ids: number[]) => {
        const idSet = new Set(ids);
        setRows((prev) => prev.map((r) => (idSet.has(r.id) ? { ...r, group: undefined } : r)));
    }, []);

    const removeIds = useCallback((ids: number[]) => {
        const idSet = new Set(ids);
        setRows((prev) => prev.filter((r) => !idSet.has(r.id)));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
    }, []);

    const clearFilters = useCallback(() => {
        setSearch('');
        setFacetState({});
    }, []);

    const clearSearch = useCallback(() => setSearch(''), []);

    const hasActiveFilters = !!search || Object.values(facetState).some((s) => s.size > 0);

    return (
        <div className="mx-auto max-w-7xl bg-[#FAF7F2] p-2">
            <TableToolbar
                search={search}
                onSearchChange={setSearch}
                onClearSearch={clearSearch}
                searchPlaceholder={searchPlaceholder}
                facetFilters={facetFilters}
                facetOptions={facetOptions}
                facetState={facetState}
                onToggleFacet={toggleFacetValue}
                table={table}
                columnVisibility={columnVisibility}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={clearFilters}
                filteredCount={filteredData.length}
                totalCount={rows.length}
            />

            <div className="overflow-hidden rounded-md border border-[#E3DCCC] bg-white">
                <TableHeaderRow
                    table={table}
                    columnOrder={columnOrder}
                    sorting={sorting}
                    sensors={sensors}
                    onColumnDragEnd={handleColumnDragEnd}
                />

                <RowsViewport
                    visibleRows={visibleRows}
                    groups={groups}
                    groupMap={groupMap}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    maxHeight={maxHeight}
                    totalRowsCount={rows.length}
                    emptyLabel={emptyLabel}
                    emptyHint={emptyHint}
                    onCreateGroup={createGroupAndAssign}
                    onAssignToGroup={assignToGroup}
                    onUngroup={ungroupIds}
                    onRemove={removeIds}
                />
            </div>
        </div>
    );
}