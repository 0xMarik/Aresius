import { useEffect, useMemo, useState } from 'react';
import { RsTree } from 'rstree-ui';
import type { ReactNode } from 'react';
import { Globe, Server, Folder, Route, Braces } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SitemapKind, TreeNode } from '@/types/sitemap.type';
import { useAppSelector } from '@/hooks/redux';
import Table from '@/components/Table';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { renderHttpHistoryTableContextMenu } from '@/components/HttpHistoryTableContextMenu';
import { adaptFromReqRes, httpColumns, httpFacetFilters } from '@/pages/HttpHistory';
import { historySelectors } from '@/store/slices/http-historySlice';
import { buildSitemapNodeIndex, collectRequestIdsDeduped } from './utils';
import type { EntityId } from '@reduxjs/toolkit';

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
                {d.hitCount}
            </span>
        </div>
    );
}

function resolveEntityId(id: string): EntityId {
    const asNumber = Number(id);
    return Number.isNaN(asNumber) ? id : asNumber;
}

export default function SitemapTree() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);

    const sitemap = useAppSelector(state => state.sitemap);
    const historyEntities = useAppSelector(historySelectors.selectEntities);

    const selectedNodeId = selectedIds[0] ?? null;

    const nodeIndex = useMemo(() => buildSitemapNodeIndex(sitemap), [sitemap]);

    const selectedNode = selectedNodeId ? nodeIndex.get(selectedNodeId) ?? null : null;

    const requestIds = useMemo(
        () => (selectedNode ? collectRequestIdsDeduped(selectedNode) : []),
        [selectedNode],
    );

    const rows = useMemo(() => {
        const items = requestIds
            .map((id) => historyEntities[resolveEntityId(id)])
            .filter((item): item is NonNullable<typeof item> => item !== undefined);
        return adaptFromReqRes(items);
    }, [requestIds, historyEntities]);

    const selectedEntity = useAppSelector((state) =>
        selectedRequest !== null ? historySelectors.selectById(state, selectedRequest) : undefined,
    );

    useEffect(() => {
        setSelectedRequest(null);
    }, [selectedNodeId]);

    return (
        <div className="h-full min-h-0 overflow-hidden rounded-md">
            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-layout" className="h-full min-h-0">
                <ResizablePanel defaultSize={20} minSize={13} className="min-h-0 overflow-hidden">
                    <RsTree
                        data={sitemap}
                        selectedIds={selectedIds}
                        onSelect={setSelectedIds}
                        expandedIds={expandedIds}
                        onExpand={setExpandedIds}
                        showIcons={false}
                        showTreeLines
                        renderNode={renderSitemapNode as any}
                        virtualizeEnabled
                        className="bg-transparent !h-full"
                    />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={80} minSize={20} className="min-h-0 overflow-hidden">
                    {!selectedNode ? (
                        <div className="flex h-full items-center justify-center text-sm text-[--color-charcoal]/50">
                            Select a sitemap node to view its requests
                        </div>
                    ) : (
                        <ResizablePanelGroup direction="vertical" autoSaveId="aresius-sitemap-requests-layout" className="h-full min-h-0">
                            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                                    <Table
                                        key={selectedNodeId}
                                        fillHeight
                                        data={rows}
                                        columns={httpColumns}
                                        facetFilters={httpFacetFilters}
                                        searchPlaceholder="Search host, url, method, code…"
                                        emptyLabel="No requests for this node"
                                        emptyHint="Captured traffic matching this path will appear here"
                                        setSelectedRequest={setSelectedRequest}
                                        renderRowContextMenu={renderHttpHistoryTableContextMenu}
                                    />
                                </div>
                            </ResizablePanel>
                            <ResizableHandle />
                            <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                                    <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-req-res" className="h-full min-h-0">
                                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                            <div className="h-full min-h-0 overflow-hidden">
                                                {!selectedEntity
                                                    ? 'select a request'
                                                    : <CodeMirrorEditor value={selectedEntity.rawRequest} />}
                                            </div>
                                        </ResizablePanel>
                                        <ResizableHandle />
                                        <ResizablePanel defaultSize={50} minSize={15} className="min-h-0 overflow-hidden">
                                            <div className="h-full min-h-0 overflow-hidden">
                                                {!selectedEntity
                                                    ? 'select a request'
                                                    : <CodeMirrorEditor value={selectedEntity.rawResponse} />}
                                            </div>
                                        </ResizablePanel>
                                    </ResizablePanelGroup>
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    )}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
