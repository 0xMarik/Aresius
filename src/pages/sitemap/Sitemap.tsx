import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { RsTree } from 'rstree-ui';
import type { ReactNode } from 'react';
import { Globe, Server, Folder, Route, Braces, ListTree, Eye, EyeOff } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SitemapKind, TreeNode } from '@/types/sitemap.type';
import { useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import Table from '@/components/Table';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { adaptFromReqRes, httpColumns } from '@/pages/HttpHistory';
import { getHistorySelectors } from '@/store/slices/http-historySlice';
import { selectSitemap } from '@/store/slices/sitemapSlice';
import { buildSitemapNodeIndex, collectRequestIdsDeduped, countUniqueRequests } from './utils';
import type { EntityId } from '@reduxjs/toolkit';
import type { HttpHistory } from '@/types/http.type';
import { EmptyState } from '@/components/ui/empty-state';
import { selectActiveScope, Scope } from '@/store/slices/scopeSlice';
import { isInScope } from '@/lib/scopeMatcher';
import { cn } from '@/lib/utils';

const kindIcon: Record<SitemapKind, ReactNode> = {
    domain: <Globe className="w-2.5 h-2.5 text-[--color-terracotta]" />,
    host: <Server className="w-2.5 h-2.5 text-[--color-terracotta]" />,
    folder: <Folder className="w-2.5 h-2.5 text-[--color-charcoal]/70" />,
    endpoint: <Route className="w-2.5 h-2.5 text-[--color-charcoal]" />,
    variant: <Braces className="w-2.5 h-2.5 text-[--color-charcoal]/50" />,
};

function renderSitemapNode(
    node: TreeNode,
    _activeScope: Scope | null
) {
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
    activeScope: Scope | null;
}

const SitemapTreePane = React.memo<SitemapTreePaneProps>(function SitemapTreePane({
    data,
    selectedIds,
    onSelect,
    expandedIds,
    onExpand,
    activeScope,
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
            renderNode={(node) => renderSitemapNode(node as any, activeScope) as any}
            virtualizeEnabled
        />
    );
});

// ---------------------------------------------------------------------------
// 2. Memoized Request Table Component
// ---------------------------------------------------------------------------
interface SitemapRequestTablePaneProps {
    selectedNodeId: string | null;
    requestIds: string[];
    onSelectRequest: (id: number | null) => void;
}

const SitemapRequestTablePane = React.memo<SitemapRequestTablePaneProps>(function SitemapRequestTablePane({
    selectedNodeId,
    requestIds,
    onSelectRequest,
}) {
    const projectId = useProjectId();
    const rows = useAppSelector(
        (state) => {
            const entities = getHistorySelectors(projectId).selectEntities(state);
            const items: HttpHistory[] = [];
            for (const idStr of requestIds) {
                const item = (entities as Record<string | number, HttpHistory>)[resolveEntityId(idStr)];
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
    const projectId = useProjectId();
    const selectedEntity = useAppSelector((state) =>
        selectedRequestId !== null
            ? getHistorySelectors(projectId).selectById(state, selectedRequestId)
            : undefined
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
    const [showOutOfScope, setShowOutOfScope] = useState(false);

    const projectId = useProjectId();
    const sitemap = useAppSelector(selectSitemap(projectId));
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const selectedNodeId = selectedIds[0] ?? null;

    const nodeIndex = useMemo(() => buildSitemapNodeIndex(sitemap), [sitemap]);
    const selectedNode = selectedNodeId ? nodeIndex.get(selectedNodeId) ?? null : null;

    const visibleSitemap = useMemo(() => {
        if (!activeScope || showOutOfScope) return sitemap;
        return sitemap.filter((node) => isInScope(activeScope, node.label ?? ''));
    }, [sitemap, activeScope, showOutOfScope]);

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

    if (sitemap.length === 0) {
        return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center">
                <EmptyState
                    icon={ListTree}
                    title="No Sitemap Data Yet"
                    description="Make HTTP requests through Aresius to populate the target sitemap hierarchy automatically."
                />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[--color-canvas] select-none font-sans">
            {/* Scope Bar */}
            {activeScope && (
                <div className="flex items-center justify-between px-3 py-1 bg-muted/20 border-b border-border/40 text-[11px] shrink-0">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span>Filtered by scope:</span>
                        <span className="font-semibold text-foreground flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: activeScope.color }} />
                            {activeScope.name}
                        </span>
                        {!showOutOfScope && (
                            <span className="text-[10px] text-muted-foreground/70">
                                ({sitemap.length - visibleSitemap.length} hidden)
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => setShowOutOfScope((v) => !v)}
                        className={cn(
                            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                            showOutOfScope
                                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                : 'bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {showOutOfScope ? (
                            <>
                                <EyeOff className="w-3 h-3" /> Hide Out-of-Scope
                            </>
                        ) : (
                            <>
                                <Eye className="w-3 h-3" /> Show Out-of-Scope
                            </>
                        )}
                    </button>
                </div>
            )}

            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-layout" className="flex-1 min-h-0">
                {/* Tree Pane */}
                <ResizablePanel defaultSize={30} minSize={15} className="min-h-0 overflow-hidden">
                    <div className="h-full min-h-0 overflow-auto p-2 bg-[--color-canvas]">
                        <SitemapTreePane
                            data={visibleSitemap}
                            selectedIds={selectedIds}
                            onSelect={handleSelectTree}
                            expandedIds={expandedIds}
                            onExpand={handleExpandTree}
                            activeScope={activeScope}
                        />
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right Side: Requests Table + Request/Response Viewers */}
                <ResizablePanel defaultSize={70} minSize={20} className="min-h-0 overflow-hidden">
                    <ResizablePanelGroup direction="vertical" autoSaveId="aresius-sitemap-right-layout" className="h-full min-h-0">
                        {/* Upper: Requests Table */}
                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                            <SitemapRequestTablePane
                                selectedNodeId={selectedNodeId}
                                requestIds={requestIds}
                                onSelectRequest={handleSelectRequest}
                            />
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Lower: Request/Response Split View */}
                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                            <SitemapRequestViewerPane selectedRequestId={selectedRequest} />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
