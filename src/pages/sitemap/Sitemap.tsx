import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { RsTree } from 'rstree-ui';
import type { ReactNode } from 'react';
import { Globe, Server, Folder, Route, Braces, ListTree } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SitemapKind, TreeNode } from '@/types/sitemap.type';
import { useAppSelector } from '@/hooks/redux';
import Table from '@/components/Table';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { adaptFromReqRes, httpColumns } from '@/pages/HttpHistory';
import { historySelectors } from '@/store/slices/http-historySlice';
import { buildSitemapNodeIndex, collectRequestIdsDeduped, countUniqueRequests } from './utils';
import type { EntityId } from '@reduxjs/toolkit';
import type { HttpHistory } from '@/types/http.type';
import { EmptyState } from '@/components/ui/empty-state';

const kindIcon: Record<SitemapKind, ReactNode> = {
    domain: <Globe className="w-2.5 h-2.5 text-[--color-terracotta]" />,
    host: <Server className="w-2.5 h-2.5 text-[--color-terracotta]" />,
    folder: <Folder className="w-2.5 h-2.5 text-[--color-charcoal]/70" />,
    endpoint: <Route className="w-2.5 h-2.5 text-[--color-charcoal]" />,
    variant: <Braces className="w-2.5 h-2.5 text-[--color-charcoal]/50" />,
};

function renderSitemapNode(node: TreeNode) {
    const d = node.data;
    if (!d) return <span className="text-sm">{node.label}</span>;

    return (
        <div className="flex items-center gap-1.5 w-full min-w-0 py-px">
            <span className="shrink-0 flex items-center">{kindIcon[d.kind]}</span>

            <span
                className={`truncate text-[13px] leading-tight ${d.kind === 'domain' || d.kind === 'host'
                    ? 'font-medium text-[--color-charcoal]'
                    : 'text-[--color-charcoal]/90'
                    }`}
            >
                {node.label}
            </span>

            {d.methods?.map(m => (
                <span
                    key={m}
                    className="shrink-0 font-mono text-[9px] font-medium leading-none px-1 py-[3px] rounded-sm bg-[--color-charcoal]/[0.06] text-[--color-charcoal]/70 tracking-wide"
                >
                    {m}
                </span>
            ))}

            {d.inScope === false && (
                <span className="shrink-0 text-[9px] leading-none px-1 py-[3px] rounded-sm bg-gray-100 text-gray-400">
                    out of scope
                </span>
            )}

            <span className="ml-auto shrink-0 text-[9px] leading-none font-medium px-1.5 py-[3px] rounded-full bg-[--color-terracotta]/10 text-[--color-terracotta]">
                {countUniqueRequests(node)}
            </span>
        </div>
    );
}

function resolveEntityId(id: string): EntityId {
    const asNumber = Number(id);
    return Number.isNaN(asNumber) ? id : asNumber;
}

// ---------------------------------------------------------------------------
// 1. Memoized Tree Pane Component
// ---------------------------------------------------------------------------
interface SitemapTreePaneProps {
    data: TreeNode[];
    selectedIds: string[];
    onSelect: (ids: string[]) => void;
    expandedIds: string[];
    onExpand: (ids: string[]) => void;
}

const SitemapTreePane = React.memo<SitemapTreePaneProps>(function SitemapTreePane({
    data,
    selectedIds,
    onSelect,
    expandedIds,
    onExpand,
}) {
    return (
        <RsTree
            data={data}
            selectedIds={selectedIds}
            onSelect={onSelect}
            expandedIds={expandedIds}
            onExpand={onExpand}
            showIcons={false}
            showTreeLines
            renderNode={renderSitemapNode as any}
            virtualizeEnabled
            className="bg-transparent !h-full"
            treeLineClassName="!border-border/40"
            treeNodeClassName="
    !bg-transparent
    !text-muted-foreground
    hover:!bg-accent/50 hover:!text-foreground
    aria-selected:!bg-accent aria-selected:!text-accent-foreground
    rounded-sm text-[13px] font-mono transition-colors
  "
        />
    );
});

// ---------------------------------------------------------------------------
// 2. Memoized Request Table Component
// ---------------------------------------------------------------------------
interface SitemapRequestTablePaneProps {
    selectedNodeId: string;
    requestIds: string[];
    onSelectRequest: (id: number | null) => void;
}

const SitemapRequestTablePane = React.memo<SitemapRequestTablePaneProps>(function SitemapRequestTablePane({
    selectedNodeId,
    requestIds,
    onSelectRequest,
}) {
    // Fine-grained Redux selector: only re-compute `rows` if the relevant entities change
    const rows = useAppSelector(
        (state) => {
            const entities = state.httpHistory.entities;
            const items: HttpHistory[] = [];
            for (const idStr of requestIds) {
                const item = entities[resolveEntityId(idStr) as any];
                if (item) items.push(item);
            }
            return adaptFromReqRes(items);
        },
        (prevRows, nextRows) => {
            if (prevRows.length !== nextRows.length) return false;
            for (let i = 0; i < prevRows.length; i++) {
                if (prevRows[i].id !== nextRows[i].id) return false;
            }
            return true;
        }
    );

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <Table
                key={selectedNodeId}
                fillHeight
                data={rows}
                columns={httpColumns}
                emptyLabel="No requests for this node"
                emptyHint="Captured traffic matching this path will appear here"
                setSelectedRequest={onSelectRequest}
                renderRowContextMenu={renderHttpHistoryTableContextMenu}
            />
        </div>
    );
});

// ---------------------------------------------------------------------------
// 3. Memoized Request/Response CodeMirror Viewer Component
// ---------------------------------------------------------------------------
interface SitemapRequestViewerPaneProps {
    selectedRequestId: number | null;
}

const SitemapRequestViewerPane = React.memo<SitemapRequestViewerPaneProps>(function SitemapRequestViewerPane({
    selectedRequestId,
}) {
    const selectedEntity = useAppSelector((state) =>
        selectedRequestId !== null ? historySelectors.selectById(state, selectedRequestId) : undefined
    );

    return (
        <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-req-res" className="h-full min-h-0">
            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                <div className="h-full min-h-0 overflow-hidden">
                    {!selectedEntity ? (
                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">select a request</div>
                    ) : (
                        <CodeMirrorEditor value={selectedEntity.rawRequest} />
                    )}
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                <div className="h-full min-h-0 overflow-hidden">
                    {!selectedEntity ? (
                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">select a request</div>
                    ) : (
                        <CodeMirrorEditor value={selectedEntity.rawResponse} />
                    )}
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
});

// ---------------------------------------------------------------------------
// Main Sitemap Component
// ---------------------------------------------------------------------------
export default function SitemapTree() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);

    const sitemap = useAppSelector((state) => state.sitemap);
    const selectedNodeId = selectedIds[0] ?? null;

    const nodeIndex = useMemo(() => buildSitemapNodeIndex(sitemap), [sitemap]);
    const selectedNode = selectedNodeId ? nodeIndex.get(selectedNodeId) ?? null : null;

    const requestIds = useMemo(
        () => (selectedNode ? collectRequestIdsDeduped(selectedNode) : []),
        [selectedNode]
    );

    useEffect(() => {
        setSelectedRequest(null);
    }, [selectedNodeId]);

    const handleSelectTree = useCallback((ids: string[]) => {
        setSelectedIds(ids);
    }, []);

    const handleExpandTree = useCallback((ids: string[]) => {
        setExpandedIds(ids);
    }, []);

    const handleSelectRequest = useCallback((id: number | null) => {
        setSelectedRequest(id);
    }, []);

    return (
        <div className="h-full min-h-0 overflow-hidden rounded-md">
            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-layout" className="h-full min-h-0">
                <ResizablePanel defaultSize={20} minSize={13} className="min-h-0 overflow-hidden">
                    <SitemapTreePane
                        data={sitemap}
                        selectedIds={selectedIds}
                        onSelect={handleSelectTree}
                        expandedIds={expandedIds}
                        onExpand={handleExpandTree}
                    />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={80} minSize={20} className="min-h-0 overflow-hidden">
                    {!selectedNode ? (
                        <div className="flex h-full items-center justify-center text-sm text-[--color-charcoal]/50">
                            <EmptyState
                                icon={ListTree}
                                title="Sitemap Node Not Selected"
                                description="Pick any host, folder, or endpoint on the left to inspect the requests captured for it."
                            />
                        </div>
                    ) : (
                        <ResizablePanelGroup direction="vertical" autoSaveId="aresius-sitemap-requests-layout" className="h-full min-h-0">
                            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                <SitemapRequestTablePane
                                    selectedNodeId={selectedNodeId!}
                                    requestIds={requestIds}
                                    onSelectRequest={handleSelectRequest}
                                />
                            </ResizablePanel>
                            <ResizableHandle withHandle />
                            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                                    <SitemapRequestViewerPane selectedRequestId={selectedRequest} />
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    )}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
