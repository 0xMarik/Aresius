import { getDomainLabel, getRegistrableDomain } from './publicSuffix';
import { splitPathSegments, templatePathSegments } from './pathTemplating';
import { parseRequestLine, parseBodyFieldNames, parseHostname } from './requestParsing';
import type { HttpHistory } from '@/types/http.type';
import type { SitemapKind, SitemapNodeData, TreeNode } from '@/types/sitemap.type';

export type { SitemapKind, SitemapNodeData, TreeNode };

export interface BuildSitemapOptions {
    /**
     * Determines whether a host is considered in-scope. Defaults to
     * "everything in scope" if not provided, since HttpHistory alone
     * doesn't carry scope info.
     */
    isInScope?: (hostname: string) => boolean;
}

// ---- Internal mutable node used while merging, converted to TreeNode[] at the end ----

interface MutableNode {
    id: string;
    label: string;
    kind: SitemapKind;
    hitCount: number;
    methods?: Set<string>;
    inScope?: boolean;
    requestIds?: string[];
    children: Map<string, MutableNode>; // keyed by child label (or method+params key for variants)
}

function createNode(id: string, label: string, kind: SitemapKind): MutableNode {
    return { id, label, kind, hitCount: 0, children: new Map() };
}

function getOrCreateChild(parent: MutableNode, key: string, id: string, label: string, kind: SitemapKind): MutableNode {
    let child = parent.children.get(key);
    if (!child) {
        child = createNode(id, label, kind);
        parent.children.set(key, child);
    }
    return child;
}

/**
 * Builds (or merges into) a sitemap TreeNode[] from a list of HTTP history
 * entries.
 *
 * Tree shape: domain -> host -> folder(s) -> endpoint -> variant
 *   - domain: grouped by eTLD+1 (e.g. "*.example.com")
 *   - host: exact hostname (e.g. "api.example.com")
 *   - folder: one node per static path segment (dynamic segments are
 *     templated to "{id}" and folded together, per the v1 path-templating
 *     requirement)
 *   - endpoint: the final path segment, aggregating all HTTP methods seen
 *     for that path
 *   - variant: one node per (method, sorted query param names, sorted body
 *     field names) combination seen for that endpoint
 *
 * Existing entries with the same path/host merge (hit counts increment)
 * rather than duplicating nodes.
 */
export function buildSitemap(entries: HttpHistory[], options: BuildSitemapOptions = {}): TreeNode[] {
    const root = createNode('root', 'root', 'domain'); // synthetic root, discarded at the end
    root.kind = 'domain'; // placeholder, never emitted

    for (const entry of entries) {
        try {
            mergeEntry(root, entry, options);
        } catch {
            // A single malformed entry shouldn't break the whole sitemap build.
            continue;
        }
    }

    return Array.from(root.children.values())
        .map((child) => toTreeNode(child))
        .sort(byLabel);
}

function mergeEntry(root: MutableNode, entry: HttpHistory, options: BuildSitemapOptions): void {
    const hostname = parseHostname(entry.host);
    const { method, path, queryParams } = parseRequestLine(entry.rawRequest);
    const bodyFields = parseBodyFieldNames(entry.rawRequest, method);

    // ---- domain node ----
    const registrableDomain = getRegistrableDomain(hostname);
    const domainLabel = getDomainLabel(hostname);
    const domainId = `domain:${registrableDomain}`;
    const domainNode = getOrCreateChild(root, domainId, domainId, domainLabel, 'domain');
    domainNode.hitCount += 1;

    // ---- host node ----
    const hostId = `host:${hostname}`;
    const hostNode = getOrCreateChild(domainNode, hostId, hostId, hostname, 'host');
    hostNode.hitCount += 1;
    if (options.isInScope) {
        hostNode.inScope = options.isInScope(hostname);
    } else if (hostNode.inScope === undefined) {
        hostNode.inScope = true;
    }

    // ---- folder segments + endpoint ----
    const rawSegments = splitPathSegments(path);
    const segments = templatePathSegments(rawSegments);

    let currentParent = hostNode;
    let idPathPrefix = `h:${hostname}`;

    if (segments.length === 0) {
        // Root path "/" -- treat as its own endpoint directly under the host.
        mergeEndpoint(currentParent, idPathPrefix, '/', method, queryParams, bodyFields, String(entry.id));
        return;
    }

    // All segments except the last are folders; the last is the endpoint name.
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        idPathPrefix += `/${seg}`;
        const folderId = `folder:${idPathPrefix}`;
        currentParent = getOrCreateChild(currentParent, folderId, folderId, seg, 'folder');
        currentParent.hitCount += 1;
    }

    const endpointSeg = segments[segments.length - 1];
    idPathPrefix += `/${endpointSeg}`;
    mergeEndpoint(currentParent, idPathPrefix, endpointSeg, method, queryParams, bodyFields, String(entry.id));
}

/**
 * Stores only the latest (most-recently-seen) request ID on a node.
 * Older IDs for the same endpoint+query variant are replaced so the
 * sitemap table always shows exactly one row per unique variant.
 */
function pushRequestId(node: { requestIds?: string[] }, requestId: string): void {
    // Replace — not append — so only the last request for this variant is kept.
    node.requestIds = [requestId];
}

function mergeEndpoint(
    parent: MutableNode,
    idPathPrefix: string,
    label: string,
    method: string,
    queryParams: string[],
    bodyFields: string[],
    requestId: string,
): void {
    const endpointId = `endpoint:${idPathPrefix}`;
    const endpointNode = getOrCreateChild(parent, endpointId, endpointId, label, 'endpoint');
    endpointNode.hitCount += 1;
    if (!endpointNode.methods) endpointNode.methods = new Set();
    endpointNode.methods.add(method);

    // ---- variant node: keyed by method + sorted query param names + sorted body field names ----
    const variantParamParts = [...queryParams.map((p) => `q:${p}`), ...bodyFields.map((f) => `b:${f}`)];
    const variantKey = `${method}:${variantParamParts.join(',')}`;
    const variantId = `variant:${idPathPrefix}:${variantKey}`;

    const variantLabelParams = variantParamParts.length > 0 ? ` ?${[...queryParams, ...bodyFields].join(',')}` : '';
    const variantLabel = `${method}${variantLabelParams}`;

    const variantNode = getOrCreateChild(endpointNode, variantId, variantId, variantLabel, 'variant');
    variantNode.hitCount += 1;
    pushRequestId(variantNode, requestId);
}

function toTreeNode(node: MutableNode): TreeNode {
    const data: SitemapNodeData = {
        kind: node.kind,
        hitCount: node.hitCount,
    };
    if (node.methods && node.methods.size > 0) {
        data.methods = Array.from(node.methods).sort();
    }
    if (node.inScope !== undefined) {
        data.inScope = node.inScope;
    }
    if (node.kind === 'variant' && node.requestIds && node.requestIds.length > 0) {
        data.requestIds = node.requestIds;
    }

    const children = Array.from(node.children.values())
        .map(toTreeNode)
        .sort(byLabel);

    const treeNode: TreeNode = {
        id: node.id,
        label: node.label,
        data,
    };
    if (children.length > 0) {
        treeNode.children = children;
    }
    return treeNode;
}

// Fixed kind ordering used to break ties when two sibling nodes share the
// same label (e.g. an "endpoint" node and a "folder" node both named
// "users", since /users and /users/{id} coexist). Using a fixed order here
// -- rather than relying on Map/array insertion order -- keeps sibling
// ordering deterministic regardless of what order entries are processed in,
// which matters because insertHttpHistoryEntry must produce byte-identical
// trees to buildSitemap no matter how the same entries are streamed in.
const KIND_ORDER: Record<SitemapKind, number> = {
    domain: 0,
    host: 1,
    folder: 2,
    endpoint: 3,
    variant: 4,
};

function compareNodes(a: { label: string; data?: { kind: SitemapKind } }, b: { label: string; data?: { kind: SitemapKind } }): number {
    const labelCmp = a.label.localeCompare(b.label);
    if (labelCmp !== 0) return labelCmp;
    const aKind = a.data?.kind;
    const bKind = b.data?.kind;
    if (aKind && bKind && aKind !== bKind) {
        return KIND_ORDER[aKind] - KIND_ORDER[bKind];
    }
    return 0;
}

function byLabel(a: TreeNode, b: TreeNode): number {
    return compareNodes(a, b);
}

// ---------------------------------------------------------------------------
// Incremental single-entry insert -- mutates a live TreeNode[] in place
// instead of rebuilding the whole tree from the full HttpHistory[] list.
// ---------------------------------------------------------------------------

/**
 * Inserts a single HttpHistory entry into an existing sitemap TreeNode[],
 * mutating it in place and returning the same array reference.
 *
 * Unlike `buildSitemap`, this does NOT rebuild the tree from scratch --
 * it walks the live tree from the root, finds-or-creates each node along
 * the domain -> host -> folder(s) -> endpoint -> variant path, and bumps
 * hit counts. Nodes that already exist keep their identity (same object
 * reference) so this is safe to use with React state that relies on
 * referential stability for unrelated branches (e.g. React.memo'd rows) --
 * only the branch touched by this entry gets new object references, from
 * the domain node down to the variant.
 *
 * Children arrays are kept sorted by label (same order buildSitemap
 * produces), using binary search insertion so this stays cheap even with
 * many siblings.
 *
 * @param tree The current sitemap tree (array of top-level domain nodes).
 *             Mutated in place.
 * @param entry The new HTTP history entry to fold into the tree.
 * @param options Same options as buildSitemap (e.g. isInScope).
 * @returns The same `tree` array reference, for convenience chaining
 *          (e.g. `tree = insertHttpHistoryEntry(tree, entry)`).
 */
export function insertHttpHistoryEntry(
    tree: TreeNode[],
    entry: HttpHistory,
    options: BuildSitemapOptions = {},
): TreeNode[] {
    const hostname = parseHostname(entry.host);
    const { method, path, queryParams } = parseRequestLine(entry.rawRequest);
    const bodyFields = parseBodyFieldNames(entry.rawRequest, method);

    // ---- domain node ----
    const registrableDomain = getRegistrableDomain(hostname);
    const domainLabel = getDomainLabel(hostname);
    const domainId = `domain:${registrableDomain}`;
    const domainNode = findOrInsertChild(tree, domainId, domainLabel, 'domain');
    domainNode.data!.hitCount += 1;

    // ---- host node ----
    const hostId = `host:${hostname}`;
    const hostChildren = ensureChildren(domainNode);
    const hostNode = findOrInsertChild(hostChildren, hostId, hostname, 'host');
    hostNode.data!.hitCount += 1;
    if (options.isInScope) {
        hostNode.data!.inScope = options.isInScope(hostname);
    } else if (hostNode.data!.inScope === undefined) {
        hostNode.data!.inScope = true;
    }

    // ---- folder segments + endpoint ----
    const rawSegments = splitPathSegments(path);
    const segments = templatePathSegments(rawSegments);

    let currentParent = hostNode;
    let idPathPrefix = `h:${hostname}`;

    if (segments.length === 0) {
        // Root path "/" -- treat as its own endpoint directly under the host.
        insertEndpoint(currentParent, idPathPrefix, '/', method, queryParams, bodyFields, String(entry.id));
        return tree;
    }

    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        idPathPrefix += `/${seg}`;
        const folderId = `folder:${idPathPrefix}`;
        const siblings = ensureChildren(currentParent);
        currentParent = findOrInsertChild(siblings, folderId, seg, 'folder');
        currentParent.data!.hitCount += 1;
    }

    const endpointSeg = segments[segments.length - 1];
    idPathPrefix += `/${endpointSeg}`;
    insertEndpoint(currentParent, idPathPrefix, endpointSeg, method, queryParams, bodyFields, String(entry.id));

    return tree;
}

function insertEndpoint(
    parent: TreeNode,
    idPathPrefix: string,
    label: string,
    method: string,
    queryParams: string[],
    bodyFields: string[],
    requestId: string,
): void {
    const endpointId = `endpoint:${idPathPrefix}`;
    const endpointChildren = ensureChildren(parent);
    const endpointNode = findOrInsertChild(endpointChildren, endpointId, label, 'endpoint');
    endpointNode.data!.hitCount += 1;

    const methods = new Set(endpointNode.data!.methods ?? []);
    methods.add(method);
    endpointNode.data!.methods = Array.from(methods).sort();

    // ---- variant node ----
    const variantParamParts = [...queryParams.map((p) => `q:${p}`), ...bodyFields.map((f) => `b:${f}`)];
    const variantKey = `${method}:${variantParamParts.join(',')}`;
    const variantId = `variant:${idPathPrefix}:${variantKey}`;

    const variantLabelParams = variantParamParts.length > 0 ? ` ?${[...queryParams, ...bodyFields].join(',')}` : '';
    const variantLabel = `${method}${variantLabelParams}`;

    const variantChildren = ensureChildren(endpointNode);
    const variantNode = findOrInsertChild(variantChildren, variantId, variantLabel, 'variant');
    variantNode.data!.hitCount += 1;
    // Always replace with the latest request ID — one row per variant in the table.
    variantNode.data!.requestIds = [requestId];
}

/** Ensures a node has a `children` array, creating one if absent, and returns it. */
function ensureChildren(node: TreeNode): TreeNode[] {
    if (!node.children) {
        node.children = [];
    }
    return node.children;
}

/**
 * Finds a child by id in a sorted-by-label TreeNode[] array; if not found,
 * creates it and inserts it at the correct sorted position (binary search),
 * keeping the array's label ordering intact without a full re-sort.
 */
function findOrInsertChild(siblings: TreeNode[], id: string, label: string, kind: SitemapKind): TreeNode {
    // Existing nodes are looked up by id (stable identity), not label, since
    // two different ids could coincidentally share a label in edge cases.
    // Linear scan for the id match is fine here -- this is bounded by the
    // sibling count -- but we still use the label's sorted position to know
    // where to splice in a genuinely new node.
    const existingIndex = siblings.findIndex((n) => n.id === id);
    if (existingIndex !== -1) {
        return siblings[existingIndex];
    }

    const newNode: TreeNode = {
        id,
        label,
        data: { kind, hitCount: 0 },
    };

    const insertAt = lowerBound(siblings, newNode);
    siblings.splice(insertAt, 0, newNode);
    return newNode;
}

/**
 * Binary search: returns the index of the first sibling that is >= `node`
 * under the same (label, kind) ordering used by buildSitemap's final sort,
 * so incremental inserts and full rebuilds always agree on sibling order.
 */
function lowerBound(siblings: TreeNode[], node: TreeNode): number {
    let lo = 0;
    let hi = siblings.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compareNodes(siblings[mid], node) < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/** Returns every request id stored on variant nodes in this node's subtree. */
export function collectRequestIds(node: TreeNode): string[] {
    if (node.data?.kind === 'variant') {
        return node.data.requestIds ?? [];
    }
    return (node.children ?? []).flatMap(collectRequestIds);
}

/** Defensive dedup — not load-bearing; the tree shape makes duplicates structurally impossible. */
export function collectRequestIdsDeduped(node: TreeNode): string[] {
    return Array.from(new Set(collectRequestIds(node)));
}

/**
 * Returns the number of unique requests visible under a node — i.e. the count
 * of deduplicated variant-level request IDs in its subtree.  This is what the
 * tree badge should display so it always matches the row count in the table.
 */
export function countUniqueRequests(node: TreeNode): number {
    return collectRequestIdsDeduped(node).length;
}

/** Flat index of node id -> node, built once per tree reference. */
export function buildSitemapNodeIndex(tree: TreeNode[]): Map<string, TreeNode> {
    const index = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => {
        for (const node of nodes) {
            index.set(node.id, node);
            if (node.children) walk(node.children);
        }
    };
    walk(tree);
    return index;
}

/** Recursively removes a node by id from a sitemap tree, returning a new tree. */
export function removeNodeFromTree(tree: TreeNode[], nodeId: string): TreeNode[] {
    return tree
        .filter((node) => node.id !== nodeId)
        .map((node) => {
            if (!node.children || node.children.length === 0) return node;
            return {
                ...node,
                children: removeNodeFromTree(node.children, nodeId),
            };
        });
}

export interface NodeTargetInfo {
    host: string;
    path: string;
    url: string;
    scopeAllowPattern: string;
    scopeDenyPattern: string;
}

/** Extracts target host, path, URL, and scope patterns from a tree node. */
export function getNodeTargetInfo(node: TreeNode): NodeTargetInfo {
    const id = node.id;
    let host = '';
    let path = '/';

    if (id.startsWith('domain:')) {
        const domain = id.slice('domain:'.length);
        return {
            host: domain,
            path: '/',
            url: `https://${domain}`,
            scopeAllowPattern: `*.${domain}/*`,
            scopeDenyPattern: `*.${domain}/*`,
        };
    }

    if (id.startsWith('host:')) {
        host = id.slice('host:'.length);
        return {
            host,
            path: '/',
            url: `https://${host}`,
            scopeAllowPattern: `${host}/*`,
            scopeDenyPattern: `${host}/*`,
        };
    }

    // folder:h:hostname/seg1/seg2 or endpoint:h:hostname/seg1 or variant:h:hostname/path:variantKey
    let cleanId = id;
    if (cleanId.startsWith('folder:')) cleanId = cleanId.slice('folder:'.length);
    else if (cleanId.startsWith('endpoint:')) cleanId = cleanId.slice('endpoint:'.length);
    else if (cleanId.startsWith('variant:')) cleanId = cleanId.slice('variant:'.length);

    if (cleanId.startsWith('h:')) {
        cleanId = cleanId.slice(2);
        const firstSlash = cleanId.indexOf('/');
        if (firstSlash !== -1) {
            host = cleanId.slice(0, firstSlash);
            const remainder = cleanId.slice(firstSlash);
            const colonIdx = remainder.indexOf(':');
            path = colonIdx !== -1 ? remainder.slice(0, colonIdx) : remainder;
        } else {
            const colonIdx = cleanId.indexOf(':');
            host = colonIdx !== -1 ? cleanId.slice(0, colonIdx) : cleanId;
            path = '/';
        }
    } else {
        host = node.label;
    }

    const cleanPath = path || '/';
    const scopePattern = cleanPath.endsWith('/') ? `${host}${cleanPath}*` : `${host}${cleanPath}/*`;

    return {
        host,
        path: cleanPath,
        url: `https://${host}${cleanPath}`,
        scopeAllowPattern: scopePattern,
        scopeDenyPattern: scopePattern,
    };
}

export interface FilterTreeResult {
    filteredTree: TreeNode[];
    matchingIds: Set<string>;
}

/** Filters a sitemap tree based on search query and active scope. */
export function filterSitemapTree(
    tree: TreeNode[],
    query: string,
    activeScope: import('@/store/slices/scopeSlice').Scope | null,
    scopeFilter: 'all' | 'in' | 'out',
    isInScopeFn?: (scope: import('@/store/slices/scopeSlice').Scope, host: string, path?: string) => boolean
): FilterTreeResult {
    const q = query.trim().toLowerCase();
    const matchingIds = new Set<string>();

    function evaluateNode(node: TreeNode): { keep: boolean; filteredNode: TreeNode | null; isMatch: boolean } {
        const targetInfo = getNodeTargetInfo(node);
        let passesScope = true;

        if (activeScope && scopeFilter !== 'all' && isInScopeFn) {
            const inScope = isInScopeFn(activeScope, targetInfo.host, targetInfo.path);
            passesScope = scopeFilter === 'in' ? inScope : !inScope;
        }

        const labelMatch = !q || node.label.toLowerCase().includes(q);
        const methodMatch = !q || (node.data?.methods && node.data.methods.some((m) => m.toLowerCase().includes(q)));
        const pathMatch = !q || targetInfo.path.toLowerCase().includes(q);
        const isSelfMatch = passesScope && (labelMatch || !!methodMatch || pathMatch);

        let filteredChildren: TreeNode[] = [];
        let hasMatchingChild = false;

        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const childResult = evaluateNode(child);
                if (childResult.keep && childResult.filteredNode) {
                    filteredChildren.push(childResult.filteredNode);
                    hasMatchingChild = true;
                }
            }
        }

        const keep = isSelfMatch || hasMatchingChild;
        if (isSelfMatch) {
            matchingIds.add(node.id);
        }

        if (!keep) {
            return { keep: false, filteredNode: null, isMatch: false };
        }

        const filteredNode: TreeNode = {
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : (isSelfMatch ? node.children : undefined),
        };

        return { keep: true, filteredNode, isMatch: isSelfMatch || hasMatchingChild };
    }

    const filteredTree: TreeNode[] = [];
    for (const rootNode of tree) {
        const res = evaluateNode(rootNode);
        if (res.keep && res.filteredNode) {
            filteredTree.push(res.filteredNode);
        }
    }

    return { filteredTree, matchingIds };
}

/** Standard URL encode for key characters (e.g. spaces, symbols, query chars). */
export function urlEncodeKeyChars(text: string): string {
    return encodeURIComponent(text);
}

/** Complete URL encode converting every character to %XX hex format (Burp Suite style). */
export function urlEncodeAllChars(text: string): string {
    if (!text) return '';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    return Array.from(bytes)
        .map((b) => '%' + b.toString(16).padStart(2, '0').toUpperCase())
        .join('');
}

// Re-export shared HTTP utilities from @/components/utils
export {
    splitHttpMessage,
    tryFormatJson,
    formatXmlHtml,
    formatUrlEncoded,
    formatHttpMessagePretty,
    rawRequestToCurl,
    saveStringToFile,
} from '@/components/utils';


