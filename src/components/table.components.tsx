import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    createColumnHelper,
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
} from 'lucide-react';
import { parseRequest, parseResponse } from './utils';
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

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export type RequestState =
    | 'Pending'
    | 'Info'
    | 'Success'
    | 'Redirect'
    | 'Client Error'
    | 'Server Error'
    | 'Failed';

export type HttpTransaction = {
    id: number;
    host: string;
    url: string;
    method: string;
    code: number | null;
    time: number; // epoch ms, when the request was fired
    duration: number; // ms, round-trip latency
    state: RequestState;
    group?: string; // group id assigned via the "Group" context menu action
};

export type RequestGroup = {
    id: string;
    name: string;
    color: string;
};

type RawReqRes = {
    request: string;
    response: string;
    host: string;
    timestamp: number;
    duration: number;
};

interface HttpHistoryTableProps {
    /** Already-normalized rows. Defaults to generated sample data so this component is testable standalone. */
    data?: RawReqRes[];
    /** Fires with the id of the single selected row, or null when zero/multiple rows are selected. */
    setSelectedRequest?: (id: number | null) => void;
}

/* ================================================================== */
/*  Adapter — wire real proxy captures into the shape this table wants */
/* ================================================================== */

function stateFromCode(code: number | null): RequestState {
    if (code === null || code === undefined) return 'Pending';
    if (code >= 100 && code < 200) return 'Info';
    if (code >= 200 && code < 300) return 'Success';
    if (code >= 300 && code < 400) return 'Redirect';
    if (code >= 400 && code < 500) return 'Client Error';
    if (code >= 500 && code < 600) return 'Server Error';
    return 'Failed';
}

/** Converts raw captured request/response pairs (parseRequest/parseResponse from ./utils) into table rows. */
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
            // keep raw fallbacks above if the url can't be parsed
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

/* ================================================================== */
/*  Sample data — for local testing / storybook-style usage            */
/* ================================================================== */

// const SAMPLE_HOSTS = [
//     'api.stripe.com',
//     'accounts.google.com',
//     'github.com',
//     'api.github.com',
//     'graph.facebook.com',
//     'analytics.google.com',
//     'sentry.io',
//     'cdn.jsdelivr.net',
//     'api.segment.io',
//     'ads.doubleclick.net',
//     'login.microsoftonline.com',
//     'api.internal-app.io',
//     'admin.internal-app.io',
//     'storage.googleapis.com',
// ];

// const SAMPLE_PATHS: Record<string, string[]> = {
//     'api.stripe.com': ['/v1/charges', '/v1/customers', '/v1/tokens'],
//     'accounts.google.com': ['/o/oauth2/auth', '/o/oauth2/token'],
//     'github.com': ['/login', '/session'],
//     'api.github.com': ['/user', '/repos/anthropics/claude', '/notifications'],
//     'graph.facebook.com': ['/v18.0/me', '/v18.0/me/friends'],
//     'analytics.google.com': ['/collect', '/j/collect'],
//     'sentry.io': ['/api/0/envelope/'],
//     'cdn.jsdelivr.net': ['/npm/react@18/umd/react.production.min.js'],
//     'api.segment.io': ['/v1/track', '/v1/identify'],
//     'ads.doubleclick.net': ['/pagead/viewthroughconversion'],
//     'login.microsoftonline.com': ['/common/oauth2/v2.0/token'],
//     'api.internal-app.io': ['/v2/users/42', '/v2/orders', '/v2/orders/1183'],
//     'admin.internal-app.io': ['/panel/users', '/panel/settings'],
//     'storage.googleapis.com': ['/bucket/avatar.png'],
// };

// const SAMPLE_METHODS = ['GET', 'GET', 'GET', 'POST', 'POST', 'PUT', 'DELETE', 'PATCH'];
// const SAMPLE_CODES = [200, 200, 200, 201, 204, 301, 302, 400, 401, 403, 404, 429, 500, 502];

// function pick<T>(arr: T[]): T {
//     return arr[Math.floor(Math.random() * arr.length)];
// }

// export function generateDumpData(count = 45): HttpTransaction[] {
//     const now = Date.now();
//     return Array.from({ length: count }, (_, id) => {
//         const host = pick(SAMPLE_HOSTS);
//         const path = pick(SAMPLE_PATHS[host] ?? ['/']);
//         const code = pick(SAMPLE_CODES);
//         return {
//             id,
//             host,
//             url: path,
//             method: pick(SAMPLE_METHODS),
//             code,
//             time: now - (count - id) * 4000 - Math.floor(Math.random() * 2000),
//             duration: Math.floor(Math.random() * 900) + 20,
//             state: stateFromCode(code),
//         };
//     });
// }

/* ================================================================== */
/*  Ares palette (light mode) — used instead of default blue/slate     */
/* ================================================================== */
/*
   bg / surface : #FAF7F2 / #FFFFFF
   border       : #E3DCCC
   text primary : #1B211E
   text muted   : #5C6360
   accent       : #B23A2E   (selection, primary actions)
   accent hover : #8F2E24
   accent tint  : #F4E4DE   (badges, subtle bg)
   success      : #3C7A5A
   danger       : #C0392B
   group colors : warm, non-neon set derived from the same family
*/

const GROUP_PALETTE = ['#B23A2E', '#8F2E24', '#C08A3E', '#3C7A5A', '#5C6360', '#6E4A3E', '#A85D3B'];

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

/* ================================================================== */
/*  Column definitions                                                 */
/* ================================================================== */

const columnHelper = createColumnHelper<HttpTransaction>();

type TableMeta = { selectedIds: Set<number> };

function isRowSelected(info: { row: { original: HttpTransaction }; table: { options: { meta?: unknown } } }) {
    const meta = info.table.options.meta as TableMeta | undefined;
    return meta?.selectedIds.has(info.row.original.id) ?? false;
}

const COLUMNS: ColumnDef<HttpTransaction, any>[] = [
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

/* ================================================================== */
/*  Small reusable dropdown (filter menus, unrelated to context menu)  */
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
/*  Main component                                                     */
/* ================================================================== */

export default function HttpHistoryTable({ data: initialData, setSelectedRequest }: HttpHistoryTableProps) {
    const [rows, setRows] = useState<HttpTransaction[]>(() => adaptFromReqRes(initialData ?? []));
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

    const [search, setSearch] = useState('');
    const [methodFilter, setMethodFilter] = useState<Set<string>>(new Set());
    const [stateFilter, setStateFilter] = useState<Set<RequestState>>(new Set());

    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const lastClickedId = useRef<number | null>(null);

    /* -- group registry: named/colored groups, independent from row.group id references -- */
    const [groups, setGroups] = useState<RequestGroup[]>([]);
    const groupCounter = useRef(0);
    const colorCursor = useRef(0);

    /* -- keep in sync if the parent swaps the data prop -- */
    useEffect(() => {
        if (initialData) setRows(adaptFromReqRes(initialData ?? []));
    }, [initialData]);

    /* -- available facets, derived from current data -- */
    const availableMethods = useMemo(() => Array.from(new Set(rows.map((r) => r.method))).sort(), [rows]);
    const availableStates = useMemo(() => Array.from(new Set(rows.map((r) => r.state))), [rows]);

    /* -- search + filter -- */
    const filteredData = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (methodFilter.size && !methodFilter.has(r.method)) return false;
            if (stateFilter.size && !stateFilter.has(r.state)) return false;
            if (!q) return true;
            return (
                r.host.toLowerCase().includes(q) ||
                r.url.toLowerCase().includes(q) ||
                r.method.toLowerCase().includes(q) ||
                String(r.code ?? '').includes(q) ||
                r.state.toLowerCase().includes(q) ||
                String(r.id).includes(q)
            );
        });
    }, [rows, search, methodFilter, stateFilter]);

    const table = useReactTable({
        data: filteredData,
        columns: COLUMNS,
        state: { sorting, columnVisibility },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        meta: { selectedIds } as TableMeta,
    });

    const visibleRows = table.getRowModel().rows;

    /* -- report selection up to the parent, following the original single-row contract -- */
    useEffect(() => {
        if (!setSelectedRequest) return;
        if (selectedIds.size === 1) {
            setSelectedRequest(Array.from(selectedIds)[0]);
        } else {
            setSelectedRequest(null);
        }
    }, [selectedIds, setSelectedRequest]);

    /* -- drop selection ids that no longer exist after filtering/removal -- */
    useEffect(() => {
        setSelectedIds((prev) => {
            const validIds = new Set(rows.map((r) => r.id));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [rows]);

    /* -- drop groups that no longer have any member rows -- */
    useEffect(() => {
        setGroups((prev) => {
            const usedIds = new Set(rows.map((r) => r.group).filter(Boolean));
            const next = prev.filter((g) => usedIds.has(g.id));
            return next.length === prev.length ? prev : next;
        });
    }, [rows]);

    /* -- row click: plain = select one, ctrl/meta = toggle, alt = range -- */
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

    /* -- right click: if the row is already part of the selection, act on the whole
          selection; otherwise select just that row and act on it -- */
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

    /* -- keyboard navigation mirrors the original arrow-key behaviour -- */
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

    /* -- group actions, driven from the context menu -- */
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
        setMethodFilter(new Set());
        setStateFilter(new Set());
    }

    const hasActiveFilters = !!search || methodFilter.size > 0 || stateFilter.size > 0;

    return (
        <div className="mx-auto max-w-7xl bg-[#FAF7F2] p-2">
            {/* Toolbar */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-md border border-[#E3DCCC] bg-white px-2 py-1">
                    <Search className="h-3.5 w-3.5 text-[#9A9A90]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search host, url, method, code…"
                        className="w-56 border-none bg-transparent text-[12px] text-[#1B211E] outline-none placeholder:text-[#9A9A90]"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="text-[#C9C2B2] hover:text-[#5C6360]">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <Dropdown label="Method" icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#9A9A90]" />} badge={methodFilter.size}>
                    {availableMethods.map((m) => (
                        <DropdownCheckboxItem
                            key={m}
                            label={m}
                            checked={methodFilter.has(m)}
                            onToggle={() =>
                                setMethodFilter((prev) => {
                                    const next = new Set(prev);
                                    next.has(m) ? next.delete(m) : next.add(m);
                                    return next;
                                })
                            }
                        />
                    ))}
                </Dropdown>

                <Dropdown label="State" icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#9A9A90]" />} badge={stateFilter.size}>
                    {availableStates.map((s) => (
                        <DropdownCheckboxItem
                            key={s}
                            label={s}
                            checked={stateFilter.has(s)}
                            onToggle={() =>
                                setStateFilter((prev) => {
                                    const next = new Set(prev);
                                    next.has(s) ? next.delete(s) : next.add(s);
                                    return next;
                                })
                            }
                        />
                    ))}
                </Dropdown>

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
                    {filteredData.length} of {rows.length} requests
                </div>
            </div>

            {/* Contextual selection bar — informational only, actions now live in the right-click menu */}
            {selectedIds.size > 0 && (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-[#E3DCCC] bg-[#F4E4DE] px-2 py-1">
                    <span className="text-[12px] font-medium text-[#8F2E24]">{selectedIds.size} selected</span>
                    <span className="text-[11px] text-[#8F2E24]/70">Right-click a row for actions</span>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-[#9A9A90] hover:bg-white"
                    >
                        <X className="h-3.5 w-3.5" />
                        Clear
                    </button>
                </div>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-md border border-[#E3DCCC] bg-white">
                <div className="border-b border-[#E3DCCC] bg-[#FAF7F2]">
                    {table.getHeaderGroups().map((hg) => (
                        <div key={hg.id} className="flex items-center">
                            {hg.headers.map((header) => (
                                <div
                                    key={header.id}
                                    className="flex cursor-pointer select-none items-center gap-1 px-2 py-1.5 hover:bg-[#F4EEE3]"
                                    style={{ width: header.getSize() }}
                                    onClick={header.column.getToggleSortingHandler()}
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
                                        {actionIds.length > 1 ? `${actionIds.length} requests` : `Request #${rowId}`}
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
                        <p className="text-[13px]">
                            {rows.length === 0 ? 'No requests captured yet' : 'No requests match the current filters'}
                        </p>
                        <p className="mt-1 text-[11px]">
                            {rows.length === 0 ? 'Start your proxy to begin capturing HTTP traffic' : 'Try clearing search or filters'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}