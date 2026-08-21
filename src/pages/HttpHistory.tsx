import Table, { isRowSelected } from '@/components/Table';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { HttpTransaction } from '@/types/http.type';
import MethodBadge from '@/components/MethodBadge';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { useProjectId } from '@/hooks/useProjectId';
import { ScopeFilterBar, ScopeFilterOption } from '@/components/ScopeFilterBar';
import { HttpqlBar } from '@/components/Httpql/HttpqlBar';
import HttpRequestViewerPane from '@/components/HttpRequestViewerPane';
import { useVirtualHttpHistory } from '@/hooks/useVirtualHttpHistory';
import {
    selectApplyInterceptionInHistory,
    setApplyInterceptionInHistory,
} from '@/store/slices/filtersSlice';

function codeColor(code: number, selected: boolean) {
    if (selected) return 'text-primary-foreground';
    if (!code) return 'text-muted-foreground';
    if (code < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (code < 400) return 'text-amber-600 dark:text-amber-400';
    if (code < 500) return 'text-rose-600 dark:text-rose-400';
    return 'text-red-600 dark:text-red-400';
}

const columnHelper = createColumnHelper<HttpTransaction>();

export const httpColumns: ColumnDef<HttpTransaction, any>[] = [
    columnHelper.accessor('id', {
        id: 'id',
        header: 'ID',
        size: 64,
        minSize: 50,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] whitespace-nowrap ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('method', {
        id: 'method',
        header: 'Method',
        size: 90,
        minSize: 70,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <MethodBadge method={info.getValue()} selected={selected} />;
        },
    }),
    columnHelper.accessor('host', {
        id: 'host',
        header: 'Host',
        size: 220,
        minSize: 120,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] whitespace-nowrap ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('path', {
        id: 'path',
        header: 'Path',
        size: 320,
        minSize: 150,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] whitespace-nowrap ${selected ? 'text-primary-foreground/90' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('query', {
        id: 'query',
        header: 'Query',
        size: 240,
        minSize: 100,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`truncate font-mono text-[12px] whitespace-nowrap ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('extension', {
        id: 'extension',
        header: 'Ext',
        size: 70,
        minSize: 50,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`text-[12px] whitespace-nowrap ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('statusCode', {
        id: 'statusCode',
        header: 'Status',
        size: 85,
        minSize: 65,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold whitespace-nowrap ${codeColor(value, selected)}`}>{value || '—'}</span>;
        },
    }),
    columnHelper.accessor('responseLength', {
        id: 'responseLength',
        header: 'Length',
        size: 95,
        minSize: 70,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums whitespace-nowrap ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()} B</span>;
        },
    }),
    columnHelper.accessor('responseTimeMs', {
        id: 'responseTimeMs',
        header: 'Duration (ms)',
        size: 150,
        minSize: 120,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums whitespace-nowrap ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('sentAtMs', {
        id: 'sentAtMs',
        header: 'Sent at',
        size: 160,
        minSize: 130,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`text-[12px] tabular-nums whitespace-nowrap ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                    {(() => {
                        const date = new Date(info.getValue());
                        const pad = (value: number) => String(value).padStart(2, '0');
                        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
                    })()}
                </span>
            );
        },
    }),
];

const HTTPHistory = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const applyInterceptionInHistory = useAppSelector(selectApplyInterceptionInHistory(projectId));

    const [isStateLoaded, setIsStateLoaded] = useState<boolean>(false);
    const [scopeFilter, setScopeFilter] = useState<ScopeFilterOption>(() => {
        if (projectId) {
            try {
                const s = localStorage.getItem(`aresius_http_history_scope_${projectId}`);
                if (s === 'all' || s === 'in' || s === 'out') return s;
            } catch {}
        }
        return 'in';
    });
    const [httpqlQuery, setHttpqlQuery] = useState<string>(() => {
        if (projectId) {
            try {
                const q = localStorage.getItem(`aresius_http_history_httpql_${projectId}`);
                if (q !== null) return q;
            } catch {}
        }
        return '';
    });

    const {
        items,
        total,
        offset,
        sorting,
        handleSortingChange,
        handleScrollWindowChange,
        selectedRequest,
        setSelectedRequest,
        selectedEntity,
        isLoading,
    } = useVirtualHttpHistory({
        projectId,
        activeScope,
        scopeFilter,
        searchQuery: httpqlQuery,
        applyInterceptionFilters: applyInterceptionInHistory,
    });

    // 1. Fetch persistent state from SQLite DB on project mount / switch
    useEffect(() => {
        if (!projectId) return;

        invoke<{
            projectId: string;
            httpqlQuery: string;
            scopeFilter: string;
            selectedRequestId: number | null;
            applyInterceptionFilters: boolean;
            updatedAt: number;
        } | null>('get_http_history_state_db', { projectId })
            .then((savedState) => {
                if (savedState) {
                    if (savedState.httpqlQuery !== undefined) {
                        setHttpqlQuery(savedState.httpqlQuery);
                    }
                    if (
                        savedState.scopeFilter &&
                        (savedState.scopeFilter === 'all' ||
                            savedState.scopeFilter === 'in' ||
                            savedState.scopeFilter === 'out')
                    ) {
                        setScopeFilter(savedState.scopeFilter as ScopeFilterOption);
                    }
                    if (savedState.selectedRequestId) {
                        setSelectedRequest(savedState.selectedRequestId);
                    }
                    if (savedState.applyInterceptionFilters !== undefined) {
                        dispatch(
                            setApplyInterceptionInHistory({
                                projectId,
                                enabled: savedState.applyInterceptionFilters,
                            })
                        );
                    }
                }
                setIsStateLoaded(true);
            })
            .catch((err) => {
                console.error('Failed to load http history state:', err);
                setIsStateLoaded(true);
            });
    }, [projectId, dispatch]);

    // 2. Debounced save to SQLite DB whenever query or filter changes (only after initial load)
    useEffect(() => {
        if (!projectId || !isStateLoaded) return;

        try {
            localStorage.setItem(`aresius_http_history_httpql_${projectId}`, httpqlQuery);
            localStorage.setItem(`aresius_http_history_scope_${projectId}`, scopeFilter);
        } catch {}

        const timer = setTimeout(() => {
            invoke('save_http_history_state_db', {
                projectId,
                httpqlQuery,
                scopeFilter,
                selectedRequestId: selectedRequest ?? null,
                applyInterceptionFilters: applyInterceptionInHistory,
            }).catch((err) => {
                console.error('Failed to save http history state to DB:', err);
            });
        }, 400);

        return () => clearTimeout(timer);
    }, [projectId, httpqlQuery, scopeFilter, selectedRequest, applyInterceptionInHistory, isStateLoaded]);

    const handleToggleApplyFilter = (checked: boolean) => {
        if (projectId) {
            dispatch(setApplyInterceptionInHistory({ projectId, enabled: checked }));
        }
    };

    return (
        <div className="overflow-hidden h-screen">
            <ResizablePanelGroup direction="vertical" autoSaveId="http-history-table">
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className="h-full flex flex-col">
                        {/* Scope filter bar (rendered only when activeScope is set) */}
                        <ScopeFilterBar
                            activeScope={activeScope}
                            value={scopeFilter}
                            onChange={setScopeFilter}
                        />

                        {/* HTTPQL Search & Filter Bar */}
                        <HttpqlBar
                            value={httpqlQuery}
                            onChange={setHttpqlQuery}
                            applyFilterChecked={applyInterceptionInHistory}
                            onApplyFilterChange={handleToggleApplyFilter}
                        />
                        <Table
                            data={items}
                            columns={httpColumns}
                            totalCount={total}
                            windowOffset={offset}
                            onScrollWindowChange={handleScrollWindowChange}
                            sorting={sorting}
                            onSortingChange={handleSortingChange}
                            manualSorting={true}
                            emptyLabel={isLoading ? 'Loading requests…' : 'No requests captured yet'}
                            emptyHint={isLoading ? undefined : 'Start your proxy to begin capturing HTTP traffic'}
                            selectedRequestId={selectedRequest}
                            setSelectedRequest={setSelectedRequest}
                            renderRowContextMenu={renderHttpHistoryTableContextMenu}
                            fillHeight
                        />
                    </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={15}>
                    <div className="h-full">
                        <HttpRequestViewerPane
                            request={selectedEntity}
                            autoSaveId="http-history-req-res"
                        />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default HTTPHistory;