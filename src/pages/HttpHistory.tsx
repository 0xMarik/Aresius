import Table, { isRowSelected } from '@/components/Table';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    selectInterceptionFilters,
    selectApplyInterceptionInHistory,
    setApplyInterceptionInHistory,
} from '@/store/slices/filtersSlice';
import { Antenna } from 'lucide-react';

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
    const interceptionFilters = useAppSelector(selectInterceptionFilters(projectId));
    const applyInterceptionInHistory = useAppSelector(selectApplyInterceptionInHistory(projectId));

    const [scopeFilter, setScopeFilter] = useState<ScopeFilterOption>('in');
    const [httpqlQuery, setHttpqlQuery] = useState<string>('');

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

                        {/* Top Filter Bar with HTTPQL and Apply Filter Switch */}
                        <div className="flex items-center justify-between px-3 py-1.5 bg-card/40 border-b border-border/70 gap-3">
                            {/* Interception Filter Active Switch */}
                            <div className="flex items-center gap-2.5 bg-muted/40 px-2.5 py-1 rounded-md border border-border/60 text-xs shrink-0">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="http-history-apply-filter-switch"
                                        checked={applyInterceptionInHistory}
                                        onCheckedChange={handleToggleApplyFilter}
                                    />
                                    <Label
                                        htmlFor="http-history-apply-filter-switch"
                                        className="cursor-pointer text-[11px] font-medium text-foreground flex items-center gap-1.5"
                                    >
                                        <Antenna className="w-3.5 h-3.5 text-amber-500" />
                                        <span>Apply Filter</span>
                                        {interceptionFilters.length > 0 && (
                                            <Badge
                                                variant="outline"
                                                className={`text-[9.5px] px-1 py-0 font-mono transition-colors ${
                                                    applyInterceptionInHistory
                                                        ? 'text-amber-500 bg-amber-500/10 border-amber-500/30 font-semibold'
                                                        : 'text-muted-foreground bg-muted/30 border-border/40 line-through'
                                                }`}
                                            >
                                                {interceptionFilters.length} {interceptionFilters.length === 1 ? 'preset' : 'presets'}
                                            </Badge>
                                        )}
                                    </Label>
                                </div>

                                {applyInterceptionInHistory && interceptionFilters.length > 0 && (
                                    <div className="hidden sm:flex items-center gap-1 pl-1 border-l border-border/60 overflow-hidden max-w-[280px]">
                                        {interceptionFilters.slice(0, 2).map((f) => (
                                            <span
                                                key={f.id}
                                                className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-background/80 border border-border/50 text-muted-foreground truncate"
                                                title={`Active filter: ${f.name} (${f.expression})`}
                                            >
                                                {f.name}
                                            </span>
                                        ))}
                                        {interceptionFilters.length > 2 && (
                                            <span className="text-[10px] text-muted-foreground">
                                                +{interceptionFilters.length - 2} more
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* HTTPQL Search & Filter Bar */}
                        <HttpqlBar
                            value={httpqlQuery}
                            onChange={setHttpqlQuery}
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