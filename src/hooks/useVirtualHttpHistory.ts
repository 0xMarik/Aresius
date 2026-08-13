import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { HttpHistorySummaryRow, HttpTransaction, stateFromCode } from '@/types/http.type';

export interface UseVirtualHttpHistoryOptions {
    projectId: string | null;
    searchQuery?: string;
    pageSize?: number;
}

export function adaptSummaryRow(item: HttpHistorySummaryRow): HttpTransaction {
    return {
        id: Number(item.id),
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
        rawRequest: '', // Loaded lazily on selection
        rawResponse: '', // Loaded lazily on selection
    };
}

export function useVirtualHttpHistory({
    projectId,
    searchQuery = '',
    pageSize = 50,
}: UseVirtualHttpHistoryOptions) {
    const [totalCount, setTotalCount] = useState<number>(0);
    const [rowMap, setRowMap] = useState<Map<number, HttpTransaction>>(new Map());
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
    const [selectedEntity, setSelectedEntity] = useState<HttpTransaction | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

    const pendingPagesRef = useRef<Set<number>>(new Set());

    // 1. Fetch total count whenever project or search query changes
    const fetchTotalCount = useCallback(async () => {
        if (!projectId) {
            setTotalCount(0);
            setRowMap(new Map());
            return;
        }
        try {
            const count = await invoke<number>('get_http_history_count', {
                projectId,
                search: searchQuery || null,
            });
            setTotalCount(count);
            // Reset row map when query changes
            setRowMap(new Map());
            pendingPagesRef.current.clear();
        } catch (err) {
            console.error('Failed to fetch http history count:', err);
        }
    }, [projectId, searchQuery]);

    useEffect(() => {
        fetchTotalCount();
    }, [fetchTotalCount]);

    // 2. Fetch page window from backend
    const fetchPage = useCallback(
        async (pageIndex: number) => {
            if (!projectId || pendingPagesRef.current.has(pageIndex)) return;
            pendingPagesRef.current.add(pageIndex);

            try {
                const offset = pageIndex * pageSize;
                const summaries = await invoke<HttpHistorySummaryRow[]>('get_http_history_page', {
                    projectId,
                    offset,
                    limit: pageSize,
                    search: searchQuery || null,
                });

                setRowMap((prev) => {
                    const next = new Map(prev);
                    summaries.forEach((sum, idx) => {
                        const index = offset + idx;
                        next.set(index, adaptSummaryRow(sum));
                    });
                    return next;
                });
            } catch (err) {
                console.error(`Failed to fetch page ${pageIndex}:`, err);
            } finally {
                pendingPagesRef.current.delete(pageIndex);
            }
        },
        [projectId, pageSize, searchQuery]
    );

    // 3. Callback for table view range
    const ensureRange = useCallback(
        (startIndex: number, stopIndex: number) => {
            const startPage = Math.floor(startIndex / pageSize);
            const stopPage = Math.floor(stopIndex / pageSize);

            for (let page = startPage; page <= stopPage; page++) {
                const firstRowInPage = page * pageSize;
                if (!rowMap.has(firstRowInPage)) {
                    fetchPage(page);
                }
            }
        },
        [pageSize, rowMap, fetchPage]
    );

    // 4. Lazy fetch full request/response payload when a row is selected
    useEffect(() => {
        if (selectedRequest === null) {
            setSelectedEntity(null);
            return;
        }

        let isCancelled = false;
        setIsLoadingDetails(true);

        invoke<{
            id: number;
            host: string;
            method: string;
            path: string;
            query: string | null;
            extension: string | null;
            statusCode: number;
            responseLength: number;
            responseTimeMs: number;
            sentAtMs: number;
            state: string;
            isHttps: boolean;
            rawRequest: string;
            rawResponse: string;
        } | null>('get_http_history_item', { id: selectedRequest })
            .then((fullItem) => {
                if (isCancelled) return;
                if (fullItem) {
                    setSelectedEntity({
                        id: Number(fullItem.id),
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
                        isHttps: (fullItem as any).isHttps ?? false,
                        rawRequest: fullItem.rawRequest,
                        rawResponse: fullItem.rawResponse,
                    });
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

    // 5. Listen for real-time live proxy updates
    useEffect(() => {
        if (!projectId) return;

        const unlistenPromise = listen('http_history', () => {
            // Increment count and trigger refresh if needed
            setTotalCount((prev) => prev + 1);
        });

        return () => {
            unlistenPromise.then((f) => f());
        };
    }, [projectId]);

    return {
        totalCount,
        rowMap,
        ensureRange,
        selectedRequest,
        setSelectedRequest,
        selectedEntity,
        isLoadingDetails,
        refresh: fetchTotalCount,
    };
}
