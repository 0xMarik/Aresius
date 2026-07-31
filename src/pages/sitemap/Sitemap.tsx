import { useEffect, useState } from 'react';
import { RsTree } from 'rstree-ui';
import type { ReactNode } from 'react';
import { Globe, Server, Folder, Route, Braces } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SitemapKind, TreeNode } from '@/types/sitemap.type';
import { useAppSelector } from '@/hooks/redux';

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

export default function SitemapTree() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    useEffect(() => {
        console.log({ selectedIds })
    }, [selectedIds])

    const [expandedIds, setExpandedIds] = useState<string[]>([]);

    const { sitemap } = useAppSelector(state => state);

    return (
        <div className="rounded-md h-full">
            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-sitemap-layout">
                <ResizablePanel defaultSize={20} minSize={13}>
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
                <ResizablePanel defaultSize={80} minSize={20} />
            </ResizablePanelGroup>
        </div>
    );
}