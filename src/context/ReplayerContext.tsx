import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProjectId } from '@/hooks/useProjectId';
import { parseResponse } from '@/components/utils';
import { stripPath } from '@/components/ValidateUrlInput';
import { ReplayerHistoryItem, ReplayerFullData } from '@/types/replayer.type';

export interface ReplayerSessionMeta {
    id: string;
    name: string;
    url: string;
    urlIsValid: boolean;
}

export interface ReplayerCollectionMeta {
    id: string;
    name: string;
    isExpanded: boolean;
    sessions: ReplayerSessionMeta[];
}

export interface ActiveSessionDraft {
    sessionId: string | null;
    collectionId: string | null;
    name: string;
    url: string;
    urlIsValid: boolean;
    requestTmp: string;
}

// ─── 1. Tree Context (Only tree metadata, zero editor/response coupling) ─────

interface ReplayerTreeContextType {
    collections: ReplayerCollectionMeta[];
    expandedIds: string[];
    selectedCollectionId: string | null;
    selectedSessionId: string | null;
    isLoaded: boolean;

    selectSession: (collectionId: string, sessionId: string) => void;
    toggleExpand: (collectionId: string) => void;
    setExpandedIdsList: (newIds: string[]) => void;
    createCollection: () => Promise<void>;
    createSession: (collectionId: string, initialData?: { name?: string; request?: string; url?: string; urlIsValid?: boolean }) => Promise<void>;
    renameCollection: (collectionId: string, name: string) => Promise<void>;
    renameSession: (collectionId: string, sessionId: string, name: string) => Promise<void>;
    deleteCollection: (collectionId: string) => Promise<void>;
    deleteSession: (collectionId: string, sessionId: string) => Promise<void>;
}

const ReplayerTreeContext = createContext<ReplayerTreeContextType | null>(null);

export const useReplayerTree = () => {
    const context = useContext(ReplayerTreeContext);
    if (!context) {
        throw new Error('useReplayerTree must be used within a ReplayerProvider');
    }
    return context;
};

// ─── 2. Editor & History Context (Isolated from Tree) ─────────────────────────

interface ReplayerEditorContextType {
    selectedSessionId: string | null;
    selectedCollectionId: string | null;
    activeDraft: ActiveSessionDraft | null;
    history: ReplayerHistoryItem[];
    selectedHistoryIndex: number | null;
    responseLoading: boolean;
    activeHistoryItem: ReplayerHistoryItem | null;
    activeStatus: string;
    hasError: boolean;
    errorMessage: string | null;

    updateDraftContent: (requestTmp: string) => void;
    updateDraftUrl: (url: string, urlIsValid: boolean) => void;
    selectHistoryIndex: (index: number) => void;
    triggerReplay: () => Promise<void>;
    cancelReplay: () => Promise<void>;
}

const ReplayerEditorContext = createContext<ReplayerEditorContextType | null>(null);

export const useReplayerEditor = () => {
    const context = useContext(ReplayerEditorContext);
    if (!context) {
        throw new Error('useReplayerEditor must be used within a ReplayerProvider');
    }
    return context;
};

// Internal cache for session drafts and histories to avoid re-fetching on every switch
interface SessionDataCache {
    [sessionId: string]: {
        requestTmp: string;
        url: string;
        urlIsValid: boolean;
        history: ReplayerHistoryItem[];
        selectedHistoryIndex: number | null;
    };
}

export const ReplayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const projectId = useProjectId();

    // 1. Tree Metadata State
    const [collections, setCollections] = useState<ReplayerCollectionMeta[]>([]);
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState<boolean>(false);

    // 2. Editor & History State (isolated)
    const [activeDraft, setActiveDraft] = useState<ActiveSessionDraft | null>(null);
    const [history, setHistory] = useState<ReplayerHistoryItem[]>([]);
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
    const [responseLoading, setResponseLoading] = useState<boolean>(false);

    // Internal cache
    const sessionCacheRef = useRef<SessionDataCache>({});
    const activeRequestIdRef = useRef<string | null>(null);
    const debounceDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load full data from SQLite on project change
    const loadData = useCallback(async () => {
        if (!projectId) return;

        try {
            const data = await invoke<ReplayerFullData>('get_replayer_data', { projectId });
            if (!data || !data.collections || data.collections.length === 0) {
                setIsLoaded(true);
                return;
            }

            const cache: SessionDataCache = {};
            const treeCols: ReplayerCollectionMeta[] = [];

            let activeColId: string | null = null;
            let activeSessId: string | null = null;

            data.collections.forEach((c, cIdx) => {
                const isColSelected = data.selectedCollectionIndex === cIdx;
                if (isColSelected) activeColId = c.id;

                const sessMetas: ReplayerSessionMeta[] = [];

                c.sessions.forEach((s, sIdx) => {
                    const isSessSelected = isColSelected && c.selectedSessionIndex === sIdx;
                    if (isSessSelected) {
                        activeSessId = s.id;
                    }

                    sessMetas.push({
                        id: s.id,
                        name: s.name,
                        url: s.url,
                        urlIsValid: s.urlIsValid,
                    });

                    cache[s.id] = {
                        requestTmp: s.requestTmp,
                        url: s.url,
                        urlIsValid: s.urlIsValid,
                        history: s.history.map((h) => ({
                            id: h.id,
                            requestRaw: h.requestRaw,
                            responseRaw: h.responseRaw,
                            responseTime: h.responseTime,
                            requestTime: h.responseTime,
                            createdAt: h.createdAt,
                            status: h.status,
                            errorMessage: h.errorMessage,
                            baseUrl: s.url,
                        })),
                        selectedHistoryIndex: s.history.length > 0 ? 0 : null,
                    };
                });

                treeCols.push({
                    id: c.id,
                    name: c.name,
                    isExpanded: c.isExpanded !== false,
                    sessions: sessMetas,
                });
            });

            sessionCacheRef.current = cache;
            setCollections(treeCols);
            setExpandedIds(data.expandedIds || treeCols.filter(c => c.isExpanded).map(c => c.id));

            // Set active selection from SQLite
            if (!activeColId && treeCols.length > 0) {
                activeColId = treeCols[0].id;
            }
            if (activeColId) {
                setSelectedCollectionId(activeColId);
                const col = treeCols.find(c => c.id === activeColId);
                if (col && col.sessions.length > 0) {
                    if (!activeSessId || !col.sessions.some(s => s.id === activeSessId)) {
                        activeSessId = col.sessions[0].id;
                    }
                }
            }

            setSelectedSessionId(activeSessId);

            if (activeSessId && cache[activeSessId]) {
                const sCache = cache[activeSessId];
                const col = treeCols.find(c => c.sessions.some(s => s.id === activeSessId));
                const sessMeta = col?.sessions.find(s => s.id === activeSessId);

                setActiveDraft({
                    sessionId: activeSessId,
                    collectionId: col?.id || null,
                    name: sessMeta?.name || 'Session',
                    url: sCache.url,
                    urlIsValid: sCache.urlIsValid,
                    requestTmp: sCache.requestTmp,
                });
                setHistory(sCache.history);
                setSelectedHistoryIndex(sCache.selectedHistoryIndex);
            } else {
                setActiveDraft(null);
                setHistory([]);
                setSelectedHistoryIndex(null);
            }
            setIsLoaded(true);
        } catch (err) {
            console.error('Failed to load replayer data from SQLite:', err);
            setIsLoaded(true);
        }
    }, [projectId]);

    useEffect(() => {
        setIsLoaded(false);
        loadData();
    }, [loadData]);

    // Select a session
    const selectSession = useCallback((collectionId: string, sessionId: string) => {
        setSelectedCollectionId(collectionId);
        setSelectedSessionId(sessionId);

        // Persist active selection to SQLite in background
        if (projectId) {
            invoke('set_replayer_active_selection', {
                projectId,
                collectionId,
                sessionId,
            }).catch(console.error);
        }

        // Load active draft and history from cache
        const sCache = sessionCacheRef.current[sessionId];
        const col = collections.find(c => c.id === collectionId);
        const sessMeta = col?.sessions.find(s => s.id === sessionId);

        if (sCache) {
            setActiveDraft({
                sessionId,
                collectionId,
                name: sessMeta?.name || 'Session',
                url: sCache.url,
                urlIsValid: sCache.urlIsValid,
                requestTmp: sCache.requestTmp,
            });
            setHistory(sCache.history);
            setSelectedHistoryIndex(sCache.selectedHistoryIndex);
        } else {
            setActiveDraft({
                sessionId,
                collectionId,
                name: sessMeta?.name || 'Session',
                url: sessMeta?.url || 'https://',
                urlIsValid: sessMeta?.urlIsValid || false,
                requestTmp: 'GET / HTTP/1.1\r\n\r\n',
            });
            setHistory([]);
            setSelectedHistoryIndex(null);
        }
    }, [collections, projectId]);

    // Toggle expansion
    const toggleExpand = useCallback((collectionId: string) => {
        setExpandedIds((prev) => {
            const isExpanded = prev.includes(collectionId);
            const next = isExpanded ? prev.filter(id => id !== collectionId) : [...prev, collectionId];

            if (projectId) {
                invoke('set_replayer_expanded_ids', { projectId, expandedIds: next }).catch(console.error);
            }
            return next;
        });
    }, [projectId]);

    const setExpandedIdsList = useCallback((newIds: string[]) => {
        setExpandedIds(newIds);
        if (projectId) {
            invoke('set_replayer_expanded_ids', { projectId, expandedIds: newIds }).catch(console.error);
        }
    }, [projectId]);

    // Create Collection
    const createCollection = useCallback(async () => {
        if (!projectId) return;
        const newColId = crypto.randomUUID();
        const newName = `Collection ${collections.length + 1}`;
        const sortOrder = collections.length;

        try {
            await invoke('create_replayer_collection', {
                projectId,
                collectionId: newColId,
                name: newName,
                sortOrder,
            });

            setCollections(prev => [
                ...prev,
                {
                    id: newColId,
                    name: newName,
                    isExpanded: true,
                    sessions: [],
                },
            ]);
            setExpandedIds(prev => Array.from(new Set([...prev, newColId])));
            setSelectedCollectionId(newColId);
        } catch (err) {
            console.error('Failed to create collection:', err);
        }
    }, [collections.length, projectId]);

    // Create Session
    const createSession = useCallback(async (collectionId: string, initialData?: { name?: string; request?: string; url?: string; urlIsValid?: boolean }) => {
        if (!projectId) return;
        const col = collections.find(c => c.id === collectionId);
        const colIdx = collections.findIndex(c => c.id === collectionId);
        if (!col) return;

        const newSessId = crypto.randomUUID();
        const sessionCount = col.sessions.length;
        const name = initialData?.name || `Session ${sessionCount + 1}`;
        const url = initialData?.url || 'https://';
        const requestTmp = initialData?.request || 'GET / HTTP/1.1\r\n\r\n';
        const urlIsValid = initialData?.urlIsValid !== undefined ? initialData.urlIsValid : (!url.startsWith('https://') || url.length > 8);

        try {
            await invoke('create_replayer_session', {
                collectionId,
                sessionId: newSessId,
                name,
                baseUrl: url,
                requestTmp,
                sortOrder: sessionCount,
            });

            sessionCacheRef.current[newSessId] = {
                requestTmp,
                url,
                urlIsValid,
                history: [],
                selectedHistoryIndex: null,
            };

            setCollections(prev => {
                const next = [...prev];
                if (next[colIdx]) {
                    next[colIdx] = {
                        ...next[colIdx],
                        isExpanded: true,
                        sessions: [
                            ...next[colIdx].sessions,
                            { id: newSessId, name, url, urlIsValid },
                        ],
                    };
                }
                return next;
            });

            setExpandedIds(prev => Array.from(new Set([...prev, collectionId])));
            setSelectedCollectionId(collectionId);
            setSelectedSessionId(newSessId);

            setActiveDraft({
                sessionId: newSessId,
                collectionId,
                name,
                url,
                urlIsValid,
                requestTmp,
            });
            setHistory([]);
            setSelectedHistoryIndex(null);
        } catch (err) {
            console.error('Failed to create session:', err);
        }
    }, [collections, projectId]);

    // Rename Collection
    const renameCollection = useCallback(async (collectionId: string, name: string) => {
        setCollections(prev => prev.map(c => c.id === collectionId ? { ...c, name } : c));
        try {
            await invoke('rename_replayer_collection', { collectionId, name });
        } catch (err) {
            console.error('Failed to rename collection:', err);
        }
    }, []);

    // Rename Session
    const renameSession = useCallback(async (collectionId: string, sessionId: string, name: string) => {
        setCollections(prev => prev.map(c => {
            if (c.id !== collectionId) return c;
            return {
                ...c,
                sessions: c.sessions.map(s => s.id === sessionId ? { ...s, name } : s),
            };
        }));
        if (activeDraft?.sessionId === sessionId) {
            setActiveDraft(prev => prev ? { ...prev, name } : null);
        }
        try {
            await invoke('rename_replayer_session', { sessionId, name });
        } catch (err) {
            console.error('Failed to rename session:', err);
        }
    }, [activeDraft?.sessionId]);

    // Delete Collection
    const deleteCollection = useCallback(async (collectionId: string) => {
        const remainingCols = collections.filter(c => c.id !== collectionId);
        setCollections(remainingCols);

        if (selectedCollectionId === collectionId) {
            const nextCol = remainingCols[0] || null;
            setSelectedCollectionId(nextCol?.id || null);
            const nextSess = nextCol?.sessions[0] || null;
            setSelectedSessionId(nextSess?.id || null);

            if (nextSess && sessionCacheRef.current[nextSess.id]) {
                const sCache = sessionCacheRef.current[nextSess.id];
                setActiveDraft({
                    sessionId: nextSess.id,
                    collectionId: nextCol.id,
                    name: nextSess.name,
                    url: sCache.url,
                    urlIsValid: sCache.urlIsValid,
                    requestTmp: sCache.requestTmp,
                });
                setHistory(sCache.history);
                setSelectedHistoryIndex(sCache.selectedHistoryIndex);
            } else {
                setActiveDraft(null);
                setHistory([]);
                setSelectedHistoryIndex(null);
            }
        }

        try {
            await invoke('delete_replayer_collection', { collectionId });
        } catch (err) {
            console.error('Failed to delete collection:', err);
        }
    }, [collections, selectedCollectionId]);

    // Delete Session
    const deleteSession = useCallback(async (collectionId: string, sessionId: string) => {
        let nextSelectedSessId: string | null = null;

        setCollections(prev => prev.map(c => {
            if (c.id !== collectionId) return c;
            const remainingSessions = c.sessions.filter(s => s.id !== sessionId);
            if (selectedSessionId === sessionId) {
                nextSelectedSessId = remainingSessions[0]?.id || null;
            }
            return {
                ...c,
                sessions: remainingSessions,
            };
        }));

        delete sessionCacheRef.current[sessionId];

        if (selectedSessionId === sessionId) {
            setSelectedSessionId(nextSelectedSessId);
            if (nextSelectedSessId && sessionCacheRef.current[nextSelectedSessId]) {
                const sCache = sessionCacheRef.current[nextSelectedSessId];
                const col = collections.find(c => c.id === collectionId);
                const nextSess = col?.sessions.find(s => s.id === nextSelectedSessId);
                setActiveDraft({
                    sessionId: nextSelectedSessId,
                    collectionId,
                    name: nextSess?.name || 'Session',
                    url: sCache.url,
                    urlIsValid: sCache.urlIsValid,
                    requestTmp: sCache.requestTmp,
                });
                setHistory(sCache.history);
                setSelectedHistoryIndex(sCache.selectedHistoryIndex);
            } else {
                setActiveDraft(null);
                setHistory([]);
                setSelectedHistoryIndex(null);
            }
        }

        try {
            await invoke('delete_replayer_session', { sessionId });
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    }, [collections, selectedSessionId]);

    // Update Draft Content (Keystrokes in CodeMirror)
    const updateDraftContent = useCallback((newRequestTmp: string) => {
        if (!activeDraft?.sessionId) return;
        const sessId = activeDraft.sessionId;

        setActiveDraft(prev => prev ? { ...prev, requestTmp: newRequestTmp } : null);
        if (sessionCacheRef.current[sessId]) {
            sessionCacheRef.current[sessId].requestTmp = newRequestTmp;
        }

        if (debounceDraftTimerRef.current) {
            clearTimeout(debounceDraftTimerRef.current);
        }
        debounceDraftTimerRef.current = setTimeout(() => {
            invoke('update_replayer_session_draft', {
                sessionId: sessId,
                requestTmp: newRequestTmp,
                baseUrl: null,
            }).catch(console.error);
        }, 300);
    }, [activeDraft?.sessionId]);

    // Update URL
    const updateDraftUrl = useCallback((url: string, urlIsValid: boolean) => {
        if (!activeDraft?.sessionId) return;
        const sessId = activeDraft.sessionId;

        setActiveDraft(prev => prev ? { ...prev, url, urlIsValid } : null);
        if (sessionCacheRef.current[sessId]) {
            sessionCacheRef.current[sessId].url = url;
            sessionCacheRef.current[sessId].urlIsValid = urlIsValid;
        }

        setCollections(prev => prev.map(c => ({
            ...c,
            sessions: c.sessions.map(s => s.id === sessId ? { ...s, url, urlIsValid } : s),
        })));

        invoke('update_replayer_session_draft', {
            sessionId: sessId,
            requestTmp: null,
            baseUrl: url,
        }).catch(console.error);
    }, [activeDraft?.sessionId]);

    // Select History Item
    const selectHistoryIndex = useCallback((index: number) => {
        setSelectedHistoryIndex(index);
        if (activeDraft?.sessionId && sessionCacheRef.current[activeDraft.sessionId]) {
            sessionCacheRef.current[activeDraft.sessionId].selectedHistoryIndex = index;
        }

        if (history[index]) {
            const hItem = history[index];
            setActiveDraft(prev => prev ? { ...prev, requestTmp: hItem.requestRaw } : null);
            if (activeDraft?.sessionId) {
                invoke('update_replayer_session_draft', {
                    sessionId: activeDraft.sessionId,
                    requestRaw: hItem.requestRaw,
                    baseUrl: null,
                }).catch(console.error);
            }
        }
    }, [activeDraft?.sessionId, history]);

    // Trigger Replay
    const triggerReplay = useCallback(async () => {
        if (!activeDraft?.sessionId || !projectId) return;

        const reqId = crypto.randomUUID();
        activeRequestIdRef.current = reqId;
        setResponseLoading(true);

        const stripedUrl = stripPath(activeDraft.url);
        updateDraftUrl(stripedUrl, true);

        const currentRequestTmp = activeDraft.requestTmp;
        const sessId = activeDraft.sessionId;

        try {
            const response = await invoke<ReplayerHistoryItem>('replay_request', {
                requestTmp: currentRequestTmp,
                url: stripedUrl,
                reqId,
            });

            if (activeRequestIdRef.current === reqId) {
                setResponseLoading(false);
                activeRequestIdRef.current = null;

                const parsed = parseResponse(response.responseRaw);
                const statusCodeStr = parsed.statusCode
                    ? `${parsed.statusCode}${parsed.statusText ? ' ' + parsed.statusText : ''}`
                    : '200 OK';

                const historyId = response.id || crypto.randomUUID();
                const createdAt = response.createdAt || new Date().toISOString();
                const responseTime = response.responseTime ?? response.requestTime ?? 0;

                const newHistoryItem: ReplayerHistoryItem = {
                    ...response,
                    id: historyId,
                    createdAt,
                    responseTime,
                    requestTime: responseTime,
                    status: statusCodeStr,
                    errorMessage: null,
                    baseUrl: stripedUrl,
                };

                setHistory(prev => [newHistoryItem, ...prev]);
                setSelectedHistoryIndex(0);

                if (sessionCacheRef.current[sessId]) {
                    sessionCacheRef.current[sessId].history = [newHistoryItem, ...sessionCacheRef.current[sessId].history];
                    sessionCacheRef.current[sessId].selectedHistoryIndex = 0;
                }

                // Persist to SQLite
                invoke('add_replayer_history_entry', {
                    sessionId: sessId,
                    historyId,
                    requestRaw: currentRequestTmp,
                    responseRaw: response.responseRaw,
                    responseTime,
                    createdAt,
                    status: statusCodeStr,
                    errorMessage: null,
                }).catch(console.error);
            }
        } catch (error) {
            if (activeRequestIdRef.current === reqId) {
                console.error('Error replaying request:', error);
                setResponseLoading(false);
                activeRequestIdRef.current = null;

                const errStr = typeof error === 'string' ? error : (error as any)?.message || 'Request failed';
                const isCanceled = errStr.toLowerCase().includes('cancel');
                const historyId = crypto.randomUUID();
                const createdAt = new Date().toISOString();

                const errorItem: ReplayerHistoryItem = {
                    id: historyId,
                    requestRaw: currentRequestTmp,
                    responseRaw: '',
                    baseUrl: stripedUrl,
                    responseTime: 0,
                    createdAt,
                    status: isCanceled ? 'Canceled' : 'Error',
                    errorMessage: isCanceled ? null : errStr,
                };

                setHistory(prev => [errorItem, ...prev]);
                setSelectedHistoryIndex(0);

                if (sessionCacheRef.current[sessId]) {
                    sessionCacheRef.current[sessId].history = [errorItem, ...sessionCacheRef.current[sessId].history];
                    sessionCacheRef.current[sessId].selectedHistoryIndex = 0;
                }

                invoke('add_replayer_history_entry', {
                    sessionId: sessId,
                    historyId,
                    requestRaw: currentRequestTmp,
                    responseRaw: '',
                    responseTime: 0,
                    createdAt,
                    status: isCanceled ? 'Canceled' : 'Error',
                    errorMessage: isCanceled ? null : errStr,
                }).catch(console.error);
            }
        }
    }, [activeDraft, projectId, updateDraftUrl]);

    // Cancel Replay
    const cancelReplay = useCallback(async () => {
        const reqId = activeRequestIdRef.current;
        activeRequestIdRef.current = null;
        setResponseLoading(false);

        if (reqId && activeDraft?.sessionId) {
            try {
                await invoke('cancel_replayer_request', { reqId });
            } catch (e) {
                console.error('Failed to cancel replayer request:', e);
            }

            const historyId = crypto.randomUUID();
            const createdAt = new Date().toISOString();
            const cancelItem: ReplayerHistoryItem = {
                id: historyId,
                requestRaw: activeDraft.requestTmp,
                responseRaw: '',
                baseUrl: stripPath(activeDraft.url),
                responseTime: 0,
                createdAt,
                status: 'Canceled',
                errorMessage: null,
            };

            setHistory(prev => [cancelItem, ...prev]);
            setSelectedHistoryIndex(0);

            if (sessionCacheRef.current[activeDraft.sessionId]) {
                sessionCacheRef.current[activeDraft.sessionId].history = [cancelItem, ...sessionCacheRef.current[activeDraft.sessionId].history];
                sessionCacheRef.current[activeDraft.sessionId].selectedHistoryIndex = 0;
            }

            invoke('add_replayer_history_entry', {
                sessionId: activeDraft.sessionId,
                historyId,
                requestRaw: activeDraft.requestTmp,
                responseRaw: '',
                responseTime: 0,
                createdAt,
                status: 'Canceled',
                errorMessage: null,
            }).catch(console.error);
        }
    }, [activeDraft]);

    // Derived active item & status
    const activeHistoryItem = useMemo(() => {
        if (selectedHistoryIndex === null || !history[selectedHistoryIndex]) return null;
        return history[selectedHistoryIndex];
    }, [history, selectedHistoryIndex]);

    const activeStatus = useMemo(() => {
        if (responseLoading) return 'pending';
        if (!activeHistoryItem) return '';
        if (activeHistoryItem.status) return activeHistoryItem.status;
        if (activeHistoryItem.responseRaw) {
            const parsed = parseResponse(activeHistoryItem.responseRaw);
            return parsed.statusCode ? String(parsed.statusCode) : '';
        }
        return '';
    }, [responseLoading, activeHistoryItem]);

    const hasError = useMemo(() => {
        return !responseLoading && (activeHistoryItem?.status === 'Error' || !!activeHistoryItem?.errorMessage);
    }, [responseLoading, activeHistoryItem]);

    const errorMessage = useMemo(() => {
        return activeHistoryItem?.errorMessage || null;
    }, [activeHistoryItem]);

    // Tree Context Value (only tree metadata - changes ONLY on collection/session tree mutations!)
    const treeValue = useMemo<ReplayerTreeContextType>(() => ({
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        isLoaded,

        selectSession,
        toggleExpand,
        setExpandedIdsList,
        createCollection,
        createSession,
        renameCollection,
        renameSession,
        deleteCollection,
        deleteSession,
    }), [
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        isLoaded,
        selectSession,
        toggleExpand,
        setExpandedIdsList,
        createCollection,
        createSession,
        renameCollection,
        renameSession,
        deleteCollection,
        deleteSession,
    ]);

    // Editor Context Value (changes on typing, replaying, loading)
    const editorValue = useMemo<ReplayerEditorContextType>(() => ({
        selectedSessionId,
        selectedCollectionId,
        activeDraft,
        history,
        selectedHistoryIndex,
        responseLoading,
        activeHistoryItem,
        activeStatus,
        hasError,
        errorMessage,

        updateDraftContent,
        updateDraftUrl,
        selectHistoryIndex,
        triggerReplay,
        cancelReplay,
    }), [
        selectedSessionId,
        selectedCollectionId,
        activeDraft,
        history,
        selectedHistoryIndex,
        responseLoading,
        activeHistoryItem,
        activeStatus,
        hasError,
        errorMessage,
        updateDraftContent,
        updateDraftUrl,
        selectHistoryIndex,
        triggerReplay,
        cancelReplay,
    ]);

    return (
        <ReplayerTreeContext.Provider value={treeValue}>
            <ReplayerEditorContext.Provider value={editorValue}>
                {children}
            </ReplayerEditorContext.Provider>
        </ReplayerTreeContext.Provider>
    );
};
