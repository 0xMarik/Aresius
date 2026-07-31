export type SitemapKind = 'domain' | 'host' | 'folder' | 'endpoint' | 'variant';

export interface SitemapNodeData {
    kind: SitemapKind;
    hitCount: number;
    methods?: string[];
    inScope?: boolean;
}

export interface TreeNode {
    id: string;
    label: string;
    children?: TreeNode[];
    data?: SitemapNodeData;
}