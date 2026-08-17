import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import { RsTree, HighlightedText } from 'rstree-ui';
import type { ReactNode } from 'react';
import {
    Globe,
    Server,
    Folder,
    Route,
    Braces,
    ListTree,
    Search,
    X,
    Copy,
    Trash2,
    ShieldAlert,
    ShieldCheck,
    Terminal,
} from 'lucide-react';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SitemapKind, TreeNode } from '@/types/sitemap.type';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import Table from '@/components/Table';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { adaptFromReqRes, httpColumns } from '@/pages/HttpHistory';
import { getHistorySelectors } from '@/store/slices/http-historySlice';
import {
    deleteSitemapNode,
    selectSitemap,
    selectSitemapState,
    loadSitemapFromBackend,
    persistSitemapStateToDb,
    setSitemapExpandedIds,
    setSitemapSelectedNode,
    setSitemapSelectedRequest,
    setSitemapSearchTerm,
    setSitemapScopeFilter,
    setSitemapReqViewMode,
    setSitemapResViewMode,
} from '@/store/slices/sitemapSlice';
import { addRule, selectActiveScope, Scope } from '@/store/slices/scopeSlice';
import {
    buildSitemapNodeIndex,
    collectRequestIdsDeduped,
    countUniqueRequests,
    filterSitemapTree,
    getNodeTargetInfo,
    rawRequestToCurl,
} from './utils';
import type { EntityId } from '@reduxjs/toolkit';
import type { HttpHistory } from '@/types/http.type';
import { EmptyState } from '@/components/ui/empty-state';
import { isInScope } from '@/lib/scopeMatcher';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import SendToReplayer from '@/components/ContextMenu/SendToReplayer';
import SendToFuzzer from '@/components/ContextMenu/SendToFuzzer';
import MethodBadge from '@/components/MethodBadge';
import HttpRequestViewerPane from '@/components/HttpRequestViewerPane';

const kindIcon: Record<SitemapKind, ReactNode> = {
    domain: <Globe className="w-3.5 h-3.5 text-primary shrink-0" />,
    host: <Server className="w-3.5 h-3.5 text-sky-500 shrink-0" />,
    folder: <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />,
    endpoint: <Route className="w-3.5 h-3.5 text-foreground/80 shrink-0" />,
    variant: <Braces className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />,
};

function resolveEntityId(id: string): EntityId {
    const asNumber = Number(id);
    return Number.isNaN(asNumber) ? id : asNumber;
}

// ---------------------------------------------------------------------------
// Tree Node Context Menu Component
// ---------------------------------------------------------------------------
interface TreeNodeContextMenuProps {
    node: TreeNode;
    activeScope: Scope | null;
    projectId: string | null;
    representativeItem?: HttpHistory;
    children: React.ReactNode;
}

const TreeNodeContextMenu: React.FC<TreeNodeContextMenuProps> = ({
    node,
    activeScope,
    projectId,
    representativeItem,
    children,
}) => {
    const dispatch = useAppDispatch();
    const targetInfo = useMemo(() => getNodeTargetInfo(node), [node]);

    const handleIncludeInScope = () => {
        if (!projectId || !activeScope) return;
        dispatch(
            addRule({
                projectId,
                scopeId: activeScope.id,
                list: 'allow',
                pattern: targetInfo.scopeAllowPattern,
            })
        );
    };

    const handleExcludeFromScope = () => {
        if (!projectId || !activeScope) return;
        dispatch(
            addRule({
                projectId,
                scopeId: activeScope.id,
                list: 'deny',
                pattern: targetInfo.scopeDenyPattern,
            })
        );
    };

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(targetInfo.url);
    };

    const handleCopyPath = () => {
        navigator.clipboard.writeText(targetInfo.path);
    };

    const handleCopyCurl = () => {
        if (!representativeItem?.rawRequest) return;
        const curlCmd = rawRequestToCurl(representativeItem.rawRequest, targetInfo.host);
        navigator.clipboard.writeText(curlCmd);
    };

    const handleDeleteFromSitemap = () => {
        if (!projectId) return;
        dispatch(deleteSitemapNode({ nodeId: node.id, projectId }));
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-56 text-xs">
                <ContextMenuLabel className="text-[11px] text-muted-foreground font-mono truncate">
                    {node.label}
                </ContextMenuLabel>
                <ContextMenuSeparator />

                {/* Scope Management */}
                {activeScope ? (
                    <>
                        <ContextMenuItem onSelect={handleIncludeInScope}>
                            <ShieldCheck className="mr-2 h-3.5 w-3.5 text-emerald-500" />
                            Include in Scope
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handleExcludeFromScope}>
                            <ShieldAlert className="mr-2 h-3.5 w-3.5 text-rose-500" />
                            Exclude from Scope
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                ) : null}

                {/* Pentest Tools */}
                {representativeItem?.rawRequest && (
                    <>
                        <SendToFuzzer rawRequest={representativeItem.rawRequest} host={targetInfo.host} />
                        <SendToReplayer rawRequest={representativeItem.rawRequest} />
                        <ContextMenuSeparator />
                    </>
                )}

                {/* Copy Menu */}
                <ContextMenuSub>
                    <ContextMenuSubTrigger>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-44 text-xs">
                        <ContextMenuItem onSelect={handleCopyUrl}>
                            URL
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handleCopyPath}>
                            Path
                        </ContextMenuItem>
                        {representativeItem?.rawRequest && (
                            <>
                                <ContextMenuItem onSelect={handleCopyCurl}>
                                    <Terminal className="mr-2 h-3 w-3" />
                                    cURL Command
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => {
                                        navigator.clipboard.writeText(representativeItem.rawRequest);
                                    }}
                                >
                                    Raw Request
                                </ContextMenuItem>
                                {representativeItem.rawResponse && (
                                    <ContextMenuItem
                                        onSelect={() => {
                                            navigator.clipboard.writeText(representativeItem.rawResponse);
                                        }}
                                    >
                                        Raw Response
                                    </ContextMenuItem>
                                )}
                            </>
                        )}
                    </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator />

                {/* Delete / Prune */}
                <ContextMenuItem
                    onSelect={handleDeleteFromSitemap}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete from Sitemap
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};

// ---------------------------------------------------------------------------
// Render Individual Tree Node
// ---------------------------------------------------------------------------
function renderSitemapNode(
    node: TreeNode,
    activeScope: Scope | null,
    projectId: string | null,
    entities: Record<string | number, HttpHistory>,
    searchMatches?: any[]
) {
    const d = node.data;
    if (!d) return <span className="text-xs">{node.label}</span>;

    const targetInfo = getNodeTargetInfo(node);
    const inScope = activeScope ? isInScope(activeScope, targetInfo.host, targetInfo.path) : true;

    // Find representative item for context menu
    const requestIds = d.kind === 'variant' ? d.requestIds : collectRequestIdsDeduped(node);
    const repId = requestIds?.[0];
    const representativeItem = repId ? entities[resolveEntityId(repId)] : undefined;

    // Check if variant node (label format is e.g. "GET ?id" or "POST")
    const isVariant = d.kind === 'variant';
    const variantParts = isVariant ? node.label.trim().split(/\s+(.+)/) : [];
    const variantMethod = isVariant ? variantParts[0] : null;
    const variantParams = isVariant && variantParts[1] ? ` ${variantParts[1]}` : '';

    return (
        <TreeNodeContextMenu
            node={node}
            activeScope={activeScope}
            projectId={projectId}
            representativeItem={representativeItem}
        >
            <div
                className={cn(
                    'flex items-center gap-1.5 w-full min-w-0 py-0.5 px-1 rounded-sm select-none transition-opacity',
                    !inScope && activeScope && 'opacity-60 text-muted-foreground'
                )}
            >
                <span className="shrink-0 flex items-center">{kindIcon[d.kind]}</span>

                {isVariant && variantMethod ? (
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                        <MethodBadge
                            method={variantMethod}
                            className="shrink-0 text-[9px] font-semibold leading-none px-1 py-[2px]"
                        />
                        {variantParams ? (
                            <span className="truncate text-xs font-mono text-muted-foreground leading-none">
                                <HighlightedText text={variantParams} matches={searchMatches || []} />
                            </span>
                        ) : null}
                    </div>
                ) : (
                    <span
                        className={cn(
                            'truncate text-xs font-mono leading-none',
                            d.kind === 'domain' || d.kind === 'host'
                                ? 'font-semibold text-foreground'
                                : d.kind === 'folder'
                                    ? 'font-medium text-foreground/90'
                                    : 'text-foreground/80'
                        )}
                    >
                        <HighlightedText text={node.label} matches={searchMatches || []} />
                    </span>
                )}

                {d.methods?.map((m) => (
                    <MethodBadge
                        key={m}
                        method={m}
                        className="shrink-0 text-[9px] font-semibold leading-none px-1 py-[2px]"
                    />
                ))}

                <span className="ml-auto shrink-0 text-[10px] tabular-nums leading-none font-medium px-1.5 py-[2px] rounded-full bg-muted/60 text-muted-foreground">
                    {countUniqueRequests(node)}
                </span>
            </div>
        </TreeNodeContextMenu>
    );
}

// ---------------------------------------------------------------------------
// 1. Sitemap Tree Pane Component
// ---------------------------------------------------------------------------
interface SitemapTreePaneProps {
    data: TreeNode[];
    selectedIds: string[];
    onSelect: (ids: string[]) => void;
    expandedIds: string[];
    onExpand: (ids: string[]) => void;
    activeScope: Scope | null;
    projectId: string | null;
    entities: Record<string | number, HttpHistory>;
    searchTerm: string;
}

const SitemapTreePane = React.memo<SitemapTreePaneProps>(function SitemapTreePane({
    data,
    selectedIds,
    onSelect,
    expandedIds,
    onExpand,
    activeScope,
    projectId,
    entities,
    searchTerm,
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
            searchTerm={searchTerm}
            className="!h-full bg-transparent border-none"
            treeLineClassName="!border-border/30"
            treeNodeClassName="
                !bg-transparent
                !text-foreground
                hover:!bg-accent/40 hover:!text-foreground
                aria-selected:!bg-accent/70 aria-selected:!text-accent-foreground aria-selected:font-medium
                rounded-md text-xs font-mono transition-colors py-0.5
            "
            renderNode={(node: any, props: any) =>
                renderSitemapNode(
                    node,
                    activeScope,
                    projectId,
                    entities,
                    props?.searchMatches
                ) as any
            }
            virtualizeEnabled
        />
    );
});

// ---------------------------------------------------------------------------
// 2. Sitemap Request Table Pane Component
// ---------------------------------------------------------------------------
interface SitemapRequestTablePaneProps {
    selectedNode: TreeNode | null;
    requestIds: string[];
    selectedRequestId: number | null;
    onSelectRequest: (id: number | null) => void;
}

const SitemapRequestTablePane = React.memo<SitemapRequestTablePaneProps>(function SitemapRequestTablePane({
    selectedNode,
    requestIds,
    selectedRequestId,
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
            {/* Table Header Bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-card/40 border-b border-border/50 text-xs shrink-0 select-none">
                <div className="flex items-center gap-2 truncate">
                    <span className="text-muted-foreground font-medium">Selected:</span>
                    <span className="font-mono font-medium text-foreground truncate">
                        {selectedNode ? selectedNode.label : 'All / None'}
                    </span>
                    {selectedNode && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {selectedNode.data?.kind}
                        </Badge>
                    )}
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {rows.length} {rows.length === 1 ? 'request' : 'requests'}
                </span>
            </div>

            <div className="flex-1 min-h-0">
                <Table
                    fillHeight
                    data={rows}
                    columns={httpColumns}
                    emptyLabel={selectedNode ? 'No requests for this node' : 'Select a node in the tree'}
                    emptyHint={
                        selectedNode
                            ? 'Captured traffic matching this endpoint will appear here'
                            : 'Click any domain, host, folder or endpoint to inspect requests'
                    }
                    selectedRequestId={selectedRequestId}
                    setSelectedRequest={onSelectRequest}
                    renderRowContextMenu={renderHttpHistoryTableContextMenu}
                />
            </div>
        </div>
    );
});



// ---------------------------------------------------------------------------
// Main Sitemap Page Component
// ---------------------------------------------------------------------------
export default function SitemapTree() {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const historySelectors = useMemo(() => getHistorySelectors(projectId), [projectId]);
    const history = useAppSelector(historySelectors.selectAll);
    const historyEntities = useAppSelector((state) => historySelectors.selectEntities(state) as Record<string | number, HttpHistory>);

    const sitemap = useAppSelector(selectSitemap(projectId));
    const sitemapState = useAppSelector(selectSitemapState(projectId));
    const activeScope = useAppSelector(selectActiveScope(projectId));

    const sitemapStateRef = useRef(sitemapState);
    useEffect(() => {
        sitemapStateRef.current = sitemapState;
    }, [sitemapState]);

    const selectedNodeId = sitemapState.selectedNodeId;
    const selectedIds = useMemo(() => (selectedNodeId ? [selectedNodeId] : []), [selectedNodeId]);
    const expandedIds = sitemapState.expandedIds;
    const selectedRequest = sitemapState.selectedRequestId;
    const searchTerm = sitemapState.searchTerm;
    const scopeFilter = sitemapState.scopeFilter;
    const reqViewMode = sitemapState.reqViewMode;
    const resViewMode = sitemapState.resViewMode;

    // Load latest sitemap tree and view state directly from backend SQLite DB on mount / visit, updating Redux cache
    useEffect(() => {
        if (projectId) {
            dispatch(loadSitemapFromBackend(projectId) as any);
        }
    }, [projectId, dispatch]);

    const nodeIndex = useMemo(() => buildSitemapNodeIndex(sitemap), [sitemap]);
    const selectedNode = selectedNodeId ? nodeIndex.get(selectedNodeId) ?? null : null;

    // Filter tree by search term and scope filter
    const { filteredTree, matchingIds } = useMemo(() => {
        return filterSitemapTree(sitemap, searchTerm, activeScope, scopeFilter, isInScope);
    }, [sitemap, searchTerm, activeScope, scopeFilter]);

    // Auto-expand branches when searching
    useEffect(() => {
        if (searchTerm.trim().length > 0 && matchingIds.size > 0 && projectId) {
            const currentSet = new Set(expandedIds);
            let hasNew = false;
            for (const id of matchingIds) {
                if (!currentSet.has(id)) {
                    hasNew = true;
                    break;
                }
            }
            if (hasNew) {
                const nextExpanded = Array.from(new Set([...expandedIds, ...Array.from(matchingIds)]));
                dispatch(setSitemapExpandedIds({ projectId, expandedIds: nextExpanded }));
                persistSitemapStateToDb(projectId, {
                    ...sitemapStateRef.current,
                    expandedIds: nextExpanded,
                });
            }
        }
    }, [searchTerm, matchingIds, expandedIds, projectId, dispatch]);

    const requestIds = useMemo(
        () => (selectedNode ? collectRequestIdsDeduped(selectedNode) : []),
        [selectedNode]
    );

    const handleSelectTree = useCallback((ids: string[]) => {
        if (!projectId) return;
        const newSelectedNodeId = ids[0] ?? null;
        dispatch(setSitemapSelectedNode({ projectId, selectedNodeId: newSelectedNodeId }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            selectedNodeId: newSelectedNodeId,
        });
    }, [projectId, dispatch]);

    const handleExpandTree = useCallback((ids: string[]) => {
        if (!projectId) return;
        dispatch(setSitemapExpandedIds({ projectId, expandedIds: ids }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            expandedIds: ids,
        });
    }, [projectId, dispatch]);

    const handleSelectRequest = useCallback((id: number | null) => {
        if (!projectId) return;
        dispatch(setSitemapSelectedRequest({ projectId, selectedRequestId: id }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            selectedRequestId: id,
        });
    }, [projectId, dispatch]);

    const handleSearchChange = useCallback((term: string) => {
        if (!projectId) return;
        dispatch(setSitemapSearchTerm({ projectId, searchTerm: term }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            searchTerm: term,
        });
    }, [projectId, dispatch]);

    const handleScopeFilterChange = useCallback((filter: 'all' | 'in' | 'out') => {
        if (!projectId) return;
        dispatch(setSitemapScopeFilter({ projectId, scopeFilter: filter }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            scopeFilter: filter,
        });
    }, [projectId, dispatch]);

    const handleReqViewModeChange = useCallback((mode: 'raw' | 'pretty') => {
        if (!projectId) return;
        dispatch(setSitemapReqViewMode({ projectId, mode }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            reqViewMode: mode,
        });
    }, [projectId, dispatch]);

    const handleResViewModeChange = useCallback((mode: 'raw' | 'pretty') => {
        if (!projectId) return;
        dispatch(setSitemapResViewMode({ projectId, mode }));
        persistSitemapStateToDb(projectId, {
            ...sitemapStateRef.current,
            resViewMode: mode,
        });
    }, [projectId, dispatch]);

    if (sitemap.length === 0 && history.length === 0) {
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
        <div className="flex h-full min-h-0 flex-col bg-background select-none font-sans">
            {/* Top Scope & Filter Bar (Caido-style, rendered only when activeScope is set) */}
            <ScopeFilterBar
                activeScope={activeScope}
                value={scopeFilter}
                onChange={handleScopeFilterChange}
            />

            {/* Main Resizable Panes */}
            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-layout" className="flex-1 min-h-0">
                {/* Left Side: Tree Pane & Caido-like Search Bar */}
                <ResizablePanel defaultSize={30} minSize={18} className="min-h-0 flex flex-col border-r border-border/50 overflow-hidden">
                    {/* Tree Search & Controls Header */}
                    <div className="p-2 border-b border-border/50 bg-card/20 space-y-1.5 shrink-0">
                        <div className="relative flex items-center">
                            <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground/70 pointer-events-none" />
                            <Input
                                value={searchTerm}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                placeholder="Filter tree (e.g. /api, GET, host)..."
                                className="h-7 text-xs pl-8 pr-7 bg-background shadow-none border-border/60"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => handleSearchChange('')}
                                    className="absolute right-2 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>


                    </div>

                    {/* Tree Node Content */}
                    <div className="flex-1 min-h-0 overflow-auto p-1 bg-background">
                        {filteredTree.length === 0 ? (
                            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                                No tree nodes match the filter
                            </div>
                        ) : (
                            <SitemapTreePane
                                data={filteredTree}
                                selectedIds={selectedIds}
                                onSelect={handleSelectTree}
                                expandedIds={expandedIds}
                                onExpand={handleExpandTree}
                                activeScope={activeScope}
                                projectId={projectId}
                                entities={historyEntities}
                                searchTerm={searchTerm}
                            />
                        )}
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right Side: Requests Table + Request/Response Viewers */}
                <ResizablePanel defaultSize={70} minSize={30} className="min-h-0 overflow-hidden">
                    <ResizablePanelGroup direction="vertical" autoSaveId="aresius-sitemap-right-layout" className="h-full min-h-0">
                        {/* Upper: Requests Table */}
                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                            <SitemapRequestTablePane
                                selectedNode={selectedNode}
                                requestIds={requestIds}
                                selectedRequestId={selectedRequest}
                                onSelectRequest={handleSelectRequest}
                            />
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Lower: Request/Response Split View */}
                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                            <HttpRequestViewerPane
                                request={selectedRequest !== null ? historyEntities[selectedRequest] : undefined}
                                reqViewMode={reqViewMode}
                                resViewMode={resViewMode}
                                onReqViewModeChange={handleReqViewModeChange}
                                onResViewModeChange={handleResViewModeChange}
                                autoSaveId="aresius-sitemap-req-res"
                            />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}

