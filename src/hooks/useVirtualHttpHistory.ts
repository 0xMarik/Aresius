import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SortingState } from '@tanstack/react-table';
import {
    HttpHistory,
    HttpHistorySummaryRow,
    HttpTransaction,
    stateFromCode,
} from '@/types/http.type';
import { Scope } from '@/store/slices/scopeSlice';

export interface UseVirtualHttpHistoryOptions {
    projectId: string | null;
    searchQuery?: string;
    initialLimit?: number;
    activeScope?: Scope | null;
    scopeFilter?: 'all' | 'in' | 'out';
}

export function adaptSummaryRow(item: HttpHistorySummaryRow): HttpTransaction {
    return {
        id: Number(item.id),
        projectId: item.projectId,
        host: item.host,
        method: item.method,
        path: item.path,
        query: item.query ?? null,
        extension: item.extension ?? null,
        statusCode: Number(item.statusCode),
        responseLength: Number(item.responseLength),
        responseTimeMs: Number(item.responseTimeMs),
        sentAtMs: Number(item.sentAtMs),
        state: stateFromCode(Number(item.statusCode)),
        isHttps: item.isHttps ?? false,
        requestAutoPatch: item.requestAutoPatch ?? null,
        requestManualPatch: item.requestManualPatch ?? null,
        responseAutoPatch: item.responseAutoPatch ?? null,
        responseManualPatch: item.responseManualPatch ?? null,
        requestEditType: item.requestEditType ?? null,
        responseEditType: item.responseEditType ?? null,
    };
}

export function useVirtualHttpHistory({
    projectId,
    searchQuery = '',
    initialLimit = 250,
    activeScope = null,
    scopeFilter = 'in',
}: UseVirtualHttpHistoryOptions) {
    const BUFFER = 100;
    const THRESHOLD = 30;

    const [windowState, setWindowState] = useState<{
        offset: number;
        limit: number;
        items: HttpTransaction[];
        total: number;
    }>({
        offset: 0,
        limit: initialLimit,
        items: [],
        total: 0,
    });

    const [sorting, setSorting] = useState<SortingState>([]);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
    const [selectedEntity, setSelectedEntity] = useState<HttpHistory | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

    // In-memory cache for lazily fetched full payloads
    const detailCacheRef = useRef<Map<number, HttpHistory>>(new Map());

    // Refs to avoid stale closures in throttled live listeners
    const windowStateRef = useRef(windowState);
    windowStateRef.current = windowState;
    const sortingRef = useRef(sorting);
    sortingRef.current = sorting;
    const liveUpdateTimerRef = useRef<number | null>(null);
    const pendingLiveCountRef = useRef<number>(0);

    const handleSortingChange = useCallback((updater: any) => {
        setSorting(updater);
        setWindowState((prev) => ({ ...prev, offset: 0 }));
    }, []);

    const handleScrollWindowChange = useCallback((startIdx: number, count: number) => {
        setWindowState((prev) => {
            const currentOffset = prev.offset;
            const currentLimit = prev.limit;
            const currentEnd = currentOffset + currentLimit;
            const visibleEnd = startIdx + count;

            const distFromTop = startIdx - currentOffset;
            const distFromBottom = currentEnd - visibleEnd;

            if (prev.items.length > 0 && distFromTop >= THRESHOLD && distFromBottom >= THRESHOLD) {
                return prev;
            }

            const newOffset = Math.max(0, startIdx - BUFFER);
            const newTargetEnd = startIdx + count + BUFFER;
            const newLimit = newTargetEnd - newOffset;

            if (newOffset === prev.offset && newLimit === prev.limit && prev.items.length > 0) {
                return prev;
            }

            return { ...prev, offset: newOffset, limit: newLimit };
        });
    }, []);

    // Main fetcher function
    const fetchWindow = useCallback(
        async (
            offset: number,
            limit: number,
            currentSorting: SortingState,
            search: string,
            currentScope: Scope | null,
            currentFilter: 'all' | 'in' | 'out'
        ) => {
            if (!projectId) {
                setWindowState({ offset: 0, limit, items: [], total: 0 });
                return;
            }

            const sortBy = currentSorting[0]?.id ?? null;
            const sortOrder = currentSorting[0]?.desc ? 'desc' : 'asc';

            try {
                const res = await invoke<{ total: number; items: HttpHistorySummaryRow[] }>(
                    'get_http_history_window',
                    {
                        projectId,
                        offset,
                        limit,
                        sortBy,
                        sortOrder,
                        search: search.trim() || null,
                        scope: currentScope ? {
                            id: currentScope.id,
                            name: currentScope.name,
                            color: currentScope.color,
                            allow: currentScope.allow || [],
                            deny: currentScope.deny || [],
                        } : null,
                        scopeFilter: currentFilter || 'all',
                    }
                );

                if (res) {
                    const adaptedItems = (res.items || []).map(adaptSummaryRow);
                    setWindowState({
                        offset,
                        limit,
                        items: adaptedItems,
                        total: res.total,
                    });
                }
            } catch (err) {
                console.error('Failed to fetch http history window:', err);
            }
        },
        [projectId]
    );

    const prevScopeFilterRef = useRef(scopeFilter);
    const prevActiveScopeIdRef = useRef(activeScope?.id);
    const prevSearchQueryRef = useRef(searchQuery);

    useEffect(() => {
        if (
            prevScopeFilterRef.current !== scopeFilter ||
            prevActiveScopeIdRef.current !== activeScope?.id ||
            prevSearchQueryRef.current !== searchQuery
        ) {
            prevScopeFilterRef.current = scopeFilter;
            prevActiveScopeIdRef.current = activeScope?.id;
            prevSearchQueryRef.current = searchQuery;
            setWindowState((prev) => ({ ...prev, offset: 0 }));
        }
    }, [scopeFilter, activeScope?.id, searchQuery]);

    // Trigger fetch on parameter change
    useEffect(() => {
        let isCancelled = false;
        setIsLoading(true);

        fetchWindow(
            windowState.offset,
            windowState.limit,
            sorting,
            searchQuery,
            activeScope,
            scopeFilter
        ).finally(() => {
            if (!isCancelled) setIsLoading(false);
        });

        return () => {
            isCancelled = true;
        };
    }, [fetchWindow, windowState.offset, windowState.limit, sorting, searchQuery, activeScope, scopeFilter]);

    // Live Proxy Traffic Listener with 100ms throttle
    useEffect(() => {
        if (!projectId) return;

        const handleLiveTraffic = () => {
            pendingLiveCountRef.current += 1;

            if (liveUpdateTimerRef.current !== null) {
                return;
            }

            liveUpdateTimerRef.current = window.setTimeout(() => {
                liveUpdateTimerRef.current = null;
                const newEventsCount = pendingLiveCountRef.current;
                pendingLiveCountRef.current = 0;

                const curOffset = windowStateRef.current.offset;
                const curLimit = windowStateRef.current.limit;
                const curSorting = sortingRef.current;
                const curSortId = curSorting[0]?.id;
                const isDesc = curSorting[0]?.desc;

                // When user is viewing the live edge:
                // Refresh visible window to show latest captured traffic in real time.
                const isSortedDesc = isDesc && (curSortId === 'id' || curSortId === 'sentAtMs' || curSortId === 'sentAt');
                const isAtTop = curOffset === 0;

                if (isSortedDesc && isAtTop) {
                    fetchWindow(0, curLimit, curSorting, searchQuery, activeScope, scopeFilter);
                } else {
                    // Otherwise update total count smoothly without disrupting scroll position
                    setWindowState((prev) => ({
                        ...prev,
                        total: prev.total + newEventsCount,
                    }));
                }
            }, 100);
        };

        const unlistenPromise = listen('http_history', () => {
            handleLiveTraffic();
        });

        return () => {
            if (liveUpdateTimerRef.current !== null) {
                clearTimeout(liveUpdateTimerRef.current);
                liveUpdateTimerRef.current = null;
            }
            unlistenPromise.then((unlisten) => unlisten());
        };
    }, [projectId, fetchWindow, searchQuery, activeScope, scopeFilter]);

    // Lazy fetch full request/response payload when a row is selected
    useEffect(() => {
        if (selectedRequest === null) {
            setSelectedEntity(null);
            return;
        }

        // Check cache first
        const cached = detailCacheRef.current.get(selectedRequest);
        if (cached) {
            setSelectedEntity(cached);
            return;
        }

        let isCancelled = false;
        setIsLoadingDetails(true);

        invoke<HttpHistory | null>('get_http_history_item', { id: selectedRequest })
            .then((fullItem) => {
                if (isCancelled) return;
                if (fullItem) {
                    const normalized: HttpHistory = {
                        id: Number(fullItem.id),
                        projectId: fullItem.projectId,
                        host: fullItem.host,
                        method: fullItem.method,
                        path: fullItem.path,
                        query: fullItem.query ?? null,
                        extension: fullItem.extension ?? null,
                        statusCode: Number(fullItem.statusCode),
                        responseLength: Number(fullItem.responseLength),
                        responseTimeMs: Number(fullItem.responseTimeMs),
                        sentAtMs: Number(fullItem.sentAtMs),
                        state: stateFromCode(Number(fullItem.statusCode)),
                        isHttps: fullItem.isHttps ?? false,
                        rawRequest: fullItem.rawRequest || '',
                        rawResponse: fullItem.rawResponse || '',
                        requestAutoPatch: fullItem.requestAutoPatch ?? null,
                        requestManualPatch: fullItem.requestManualPatch ?? null,
                        responseAutoPatch: fullItem.responseAutoPatch ?? null,
                        responseManualPatch: fullItem.responseManualPatch ?? null,
                        requestEditType: fullItem.requestEditType ?? null,
                        responseEditType: fullItem.responseEditType ?? null,
                    };

                    detailCacheRef.current.set(selectedRequest, normalized);
                    setSelectedEntity(normalized);
                }
            })
            .catch((err) => {
                console.error('Failed to load item details:', err);
            })
            .finally(() => {
                if (!isCancelled) setIsLoadingDetails(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedRequest]);

    // Remove rows helper
    const removeRows = useCallback(
        async (ids: number[]) => {
            if (!ids.length) return;
            try {
                await invoke('delete_http_history_items', { ids });
                // Evict deleted items from detail cache
                ids.forEach((id) => detailCacheRef.current.delete(id));
                // Refresh current window
                fetchWindow(windowState.offset, windowState.limit, sorting, searchQuery, activeScope, scopeFilter);
                if (selectedRequest && ids.includes(selectedRequest)) {
                    setSelectedRequest(null);
                    setSelectedEntity(null);
                }
            } catch (err) {
                console.error('Failed to delete history items:', err);
            }
        },
        [fetchWindow, windowState.offset, windowState.limit, sorting, searchQuery, activeScope, scopeFilter, selectedRequest]
    );

    return {
        windowState,
        items: windowState.items,
        total: windowState.total,
        offset: windowState.offset,
        limit: windowState.limit,
        sorting,
        handleSortingChange,
        handleScrollWindowChange,
        selectedRequest,
        setSelectedRequest,
        selectedEntity,
        isLoading,
        isLoadingDetails,
        removeRows,
        refresh: () => fetchWindow(windowState.offset, windowState.limit, sorting, searchQuery, activeScope, scopeFilter),
    };
}
