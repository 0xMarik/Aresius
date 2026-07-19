import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    SortingState,
    ColumnDef,
    VisibilityState,
} from '@tanstack/react-table';
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
/*  Main generic component                                             */
/* ================================================================== */

interface DataTableProps<TData extends BaseRow> {
    /** Already-normalized rows. Any domain-specific parsing (like the old
     *  adaptFromReqRes) belongs in the consumer, not here. */
    data: TData[];
    columns: ColumnDef<TData, any>[];
    /** Fires with the id of the single selected row, or null when zero/multiple rows are selected. */
    setSelectedRequest?: (id: number | null) => void;
    /** Free-text search. Defaults to checking every primitive field on the row. */
    searchFn?: (row: TData, query: string) => boolean;
    /** Dropdown filters, e.g. Method / State for HTTP, or Severity for something else. */
    facetFilters?: FacetFilter<TData>[];
    searchPlaceholder?: string;
    emptyLabel?: string;
    emptyHint?: string;
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
}: DataTableProps<TData>) {
    const [rows, setRows] = useState<TData[]>(data);
    useEffect(() => setRows(data), [data]);

    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.id as string));

    const [search, setSearch] = useState('');
    const [facetState, setFacetState] = useState<Record<string, Set<string>>>({});

    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const lastClickedId = useRef<number | null>(null);

    const [groups, setGroups] = useState<RequestGroup[]>([]);
    const groupCounter = useRef(0);
    const colorCursor = useRef(0);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    function handleColumnDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setColumnOrder((prev) => {
            const oldIndex = prev.indexOf(active.id as string);
            const newIndex = prev.indexOf(over.id as string);
            if (oldIndex === -1 || newIndex === -1) return prev;
            return arrayMove(prev, oldIndex, newIndex);
        });
    }

    /* -- facet option lists derived from current rows -- */
    const facetOptions = useMemo(() => {
        const map: Record<string, string[]> = {};
        facetFilters.forEach((f) => {
            map[f.id] = Array.from(new Set(rows.map((r) => f.getValue(r)))).sort();
        });
        return map;
    }, [rows, facetFilters]);

    function toggleFacetValue(facetId: string, value: string) {
        setFacetState((prev) => {
            const next = new Set(prev[facetId] ?? []);
            next.has(value) ? next.delete(value) : next.add(value);
            return { ...prev, [facetId]: next };
        });
    }

    const defaultSearch = (row: TData, q: string) =>
        Object.values(row as Record<string, unknown>).some(
            (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q)
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
    }, [rows, search, facetFilters, facetState, searchFn]);

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

    function handleRowClick(e: React.MouseEvent, id: number) {
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
            const ids = visibleRows.map((r) => r.original.id);
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
    }

    function idsForContextMenu(rowId: number): number[] {
        if (selectedIds.has(rowId) && selectedIds.size > 1) return Array.from(selectedIds);
        return [rowId];
    }

    function handleRowContextMenu(rowId: number) {
        if (!(selectedIds.has(rowId) && selectedIds.size > 1)) {
            setSelectedIds(new Set([rowId]));
            lastClickedId.current = rowId;
        }
    }

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (visibleRows.length === 0) return;
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();

            const ids = visibleRows.map((r) => r.original.id);
            const current = lastClickedId.current !== null ? ids.indexOf(lastClickedId.current) : -1;
            const nextIndex =
                e.key === 'ArrowDown' ? Math.min(current + 1, ids.length - 1) : Math.max(current - 1, 0);
            const nextId = ids[Math.max(nextIndex, 0)];
            lastClickedId.current = nextId;
            setSelectedIds(new Set([nextId]));
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [visibleRows]);

    function createGroupAndAssign(ids: number[]) {
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
    }

    function assignToGroup(ids: number[], groupId: string) {
        const idSet = new Set(ids);
        setRows((prev) => prev.map((r) => (idSet.has(r.id) ? { ...r, group: groupId } : r)));
    }

    function ungroupIds(ids: number[]) {
        const idSet = new Set(ids);
        setRows((prev) => prev.map((r) => (idSet.has(r.id) ? { ...r, group: undefined } : r)));
    }

    function removeIds(ids: number[]) {
        const idSet = new Set(ids);
        setRows((prev) => prev.filter((r) => !idSet.has(r.id)));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
    }

    function clearFilters() {
        setSearch('');
        setFacetState({});
    }

    const hasActiveFilters = !!search || Object.values(facetState).some((s) => s.size > 0);

    return (
        <div className="mx-auto max-w-7xl bg-[#FAF7F2] p-2">
            {/* Toolbar */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
                                onToggle={() => toggleFacetValue(f.id, value)}
                            />
                        ))}
                    </Dropdown>
                ))}

                <Dropdown label="Columns" icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#9A9A90]" />}>
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
                        onClick={clearFilters}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#9A9A90] hover:text-[#5C6360]"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset
                    </button>
                )}

                <div className="ml-auto text-[12px] text-[#9A9A90]">
                    {filteredData.length} of {rows.length} rows
                </div>
            </div>


            <div className="overflow-hidden rounded-md border border-[#E3DCCC] bg-white">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
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

                <div className="divide-y divide-[#F0EDE6]">
                    {visibleRows.map((row) => {
                        const rowId = row.original.id;
                        const selected = selectedIds.has(rowId);
                        const groupId = row.original.group;
                        const group = groups.find((g) => g.id === groupId);
                        const actionIds = idsForContextMenu(rowId);
                        const otherGroups = groups.filter((g) => g.id !== groupId);

                        return (
                            <ContextMenu key={row.id}>
                                <ContextMenuTrigger asChild>
                                    <div
                                        onClick={(e) => handleRowClick(e, rowId)}
                                        onContextMenu={() => handleRowContextMenu(rowId)}
                                        className={`flex cursor-pointer items-center border-l-[3px]  ${selected ? 'bg-[#B23A2E]' : 'hover:bg-[#FAF7F2]'
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

                                    <ContextMenuItem onSelect={() => createGroupAndAssign(actionIds)}>
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
                                                <ContextMenuItem key={g.id} onSelect={() => assignToGroup(actionIds, g.id)}>
                                                    <Circle className="mr-2 h-3 w-3" style={{ color: g.color, fill: g.color }} />
                                                    {g.name}
                                                </ContextMenuItem>
                                            ))}
                                        </ContextMenuSubContent>
                                    </ContextMenuSub>

                                    <ContextMenuItem onSelect={() => ungroupIds(actionIds)} disabled={!groupId}>
                                        <FolderMinus className="mr-2 h-3.5 w-3.5" />
                                        Ungroup
                                    </ContextMenuItem>

                                    <ContextMenuSeparator />

                                    <ContextMenuItem
                                        onSelect={() => removeIds(actionIds)}
                                        className="text-[#C0392B] focus:text-[#C0392B]"
                                    >
                                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                                        Remove
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        );
                    })}
                </div>

                {visibleRows.length === 0 && (
                    <div className="py-12 text-center text-[#9A9A90]">
                        <p className="text-[13px]">{rows.length === 0 ? emptyLabel : 'No rows match the current filters'}</p>
                        {emptyHint && <p className="mt-1 text-[11px]">{rows.length === 0 ? emptyHint : 'Try clearing search or filters'}</p>}
                    </div>
                )}
            </div>
        </div>
    );
}