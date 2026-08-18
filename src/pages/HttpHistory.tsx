import Table, { isRowSelected } from '@/components/Table';
import { useAppSelector } from '@/hooks/redux';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { HttpTransaction } from '@/types/http.type';
import MethodBadge from '@/components/MethodBadge';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { useProjectId } from '@/hooks/useProjectId';
import { ScopeFilterBar, ScopeFilterOption } from '@/components/ScopeFilterBar';
import HttpRequestViewerPane from '@/components/HttpRequestViewerPane';
import { useVirtualHttpHistory } from '@/hooks/useVirtualHttpHistory';

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
        size: 56,
        minSize: 56,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`font-mono text-[11px] ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('method', {
        id: 'method',
        header: 'Method',
        size: 120,
        minSize: 120,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <MethodBadge method={info.getValue()} selected={selected} />;
        },
    }),
    columnHelper.accessor('host', {
        id: 'host',
        header: 'Host',
        size: 200,
        minSize: 200,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('path', {
        id: 'path',
        header: 'Path',
        size: 260,
        minSize: 260,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/90' : 'text-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('query', {
        id: 'query',
        header: 'Query',
        size: 200,
        minSize: 200,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`truncate font-mono text-[12px] ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('extension', {
        id: 'extension',
        header: 'Ext',
        size: 64,
        minSize: 64,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return (
                <span className={`text-[12px] ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {value ?? '—'}
                </span>
            );
        },
    }),
    columnHelper.accessor('statusCode', {
        id: 'statusCode',
        header: 'Status',
        size: 80,
        minSize: 80,
        cell: (info) => {
            const selected = isRowSelected(info);
            const value = info.getValue();
            return <span className={`text-[12px] font-semibold ${codeColor(value, selected)}`}>{value || '—'}</span>;
        },
    }),
    columnHelper.accessor('responseLength', {
        id: 'responseLength',
        header: 'Length',
        size: 84,
        minSize: 84,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()} B</span>;
        },
    }),
    columnHelper.accessor('responseTimeMs', {
        id: 'responseTimeMs',
        header: 'Duration (ms)',
        size: 150,
        minSize: 150,
        cell: (info) => {
            const selected = isRowSelected(info);
            return <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{info.getValue()}</span>;
        },
    }),
    columnHelper.accessor('sentAtMs', {
        id: 'sentAtMs',
        header: 'Sent at',
        size: 130,
        minSize: 130,
        cell: (info) => {
            const selected = isRowSelected(info);
            return (
                <span className={`text-[12px] tabular-nums ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
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
    const projectId = useProjectId();
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const [scopeFilter, setScopeFilter] = useState<ScopeFilterOption>('in');

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
    });

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