import React, { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProjectId } from '@/hooks/useProjectId';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { parseResponse } from '@/components/utils';
import { stripPath, isDnsResolutionError } from '@/components/ValidateUrlInput';
import { toast } from 'sonner';
import { ReplayerHistoryItem } from '@/types/replayer.type';
import {
    ReplayerCollectionMeta,
    ReplayerSessionMeta,
    ActiveSessionDraft,
    selectReplayerProjectState,
    setSelection,
    setSelectedSessionId,
    setExpandedIds,
    toggleCollectionExpand,
    setSessionDraftContent,
    setSessionDraftUrl,
    setSessionSelectedHistoryIndex,
    addSessionHistoryItem,
    setPendingSession,
    clearPendingSession,
    createCollectionSuccess,
    createSessionSuccess,
    renameCollectionSuccess,
    renameSessionSuccess,
    deleteCollectionSuccess,
    deleteSessionSuccess,
    fetchReplayerDataForProject,
} from '@/store/slices/replayerSlice';

export type { ReplayerCollectionMeta, ReplayerSessionMeta, ActiveSessionDraft };

// ─── 1. Tree Context (Tree hierarchy & mutations only) ────────────────────────

interface ReplayerTreeContextType {
    collections: ReplayerCollectionMeta[];
    expandedIds: string[];
    selectedCollectionId: string | null;
    selectedSessionId: string | null;
    isLoaded: boolean;

    selectSession: (collectionId: string, sessionId: string) => void;
    deselectSession: () => void;
    toggleExpand: (collectionId: string) => void;
    setExpandedIdsList: (newIds: string[]) => void;
    createCollection: () => Promise<string | null>;
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

export const ReplayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const projectId = useProjectId();
    const dispatch = useAppDispatch();

    const projectReplayer = useAppSelector(selectReplayerProjectState(projectId));
    const {
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        sessionCache,
        pendingSessions,
        isLoaded,
        isLoading,
    } = projectReplayer;

    const activeRequestsRef = useRef<Map<string, string>>(new Map());
    const debounceDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Dynamic responseLoading scoped strictly to the currently selected session
    const responseLoading = Boolean(selectedSessionId && pendingSessions[selectedSessionId]);

    // Active session cache & draft derived directly from Redux state
    const activeCache = selectedSessionId ? sessionCache[selectedSessionId] : null;
    const activeCol = collections.find(c => c.sessions.some(s => s.id === selectedSessionId));
    const activeSessMeta = activeCol?.sessions.find(s => s.id === selectedSessionId);

    const activeDraft: ActiveSessionDraft | null = useMemo(() => {
        if (!selectedSessionId || !activeCache) return null;
        return {
            sessionId: selectedSessionId,
            collectionId: activeCol?.id || null,
            name: activeSessMeta?.name || 'Session',
            url: activeCache.url,
            urlIsValid: activeCache.urlIsValid,
            requestTmp: activeCache.requestTmp || 'GET / HTTP/1.1\r\n\r\n',
        };
    }, [selectedSessionId, activeCache, activeCol, activeSessMeta]);

    const history = useMemo(() => activeCache?.history || [], [activeCache?.history]);
    const selectedHistoryIndex = activeCache?.selectedHistoryIndex ?? null;

    // Fallback load if not already loaded upon project selection
    useEffect(() => {
        if (!projectId || isLoaded || isLoading) return;
        dispatch(fetchReplayerDataForProject(projectId));
    }, [dispatch, isLoaded, isLoading, projectId]);

    // Select a session
    const selectSession = useCallback((collectionId: string, sessionId: string) => {
        if (!projectId) return;
        dispatch(setSelection({ projectId, collectionId, sessionId }));
        invoke('set_replayer_active_selection', { projectId, collectionId, sessionId }).catch(console.error);
    }, [dispatch, projectId]);

    // Deselect active session
    const deselectSession = useCallback(() => {
        if (!projectId) return;
        dispatch(setSelectedSessionId({ projectId, sessionId: null }));
        invoke('set_replayer_active_selection', {
            projectId,
            collectionId: selectedCollectionId || '',
            sessionId: '',
        }).catch(console.error);
    }, [dispatch, projectId, selectedCollectionId]);

    // Toggle expansion
    const toggleExpand = useCallback((collectionId: string) => {
        if (!projectId) return;
        dispatch(toggleCollectionExpand({ projectId, collectionId }));
        const next = expandedIds.includes(collectionId)
            ? expandedIds.filter(id => id !== collectionId)
            : [...expandedIds, collectionId];
        invoke('set_replayer_expanded_ids', { projectId, expandedIds: next }).catch(console.error);
    }, [dispatch, expandedIds, projectId]);

    const setExpandedIdsList = useCallback((newIds: string[]) => {
        if (!projectId) return;
        dispatch(setExpandedIds({ projectId, expandedIds: newIds }));
        invoke('set_replayer_expanded_ids', { projectId, expandedIds: newIds }).catch(console.error);
    }, [dispatch, projectId]);

    useEffect(() => {
        return () => {
            if (debounceDraftTimerRef.current) {
                clearTimeout(debounceDraftTimerRef.current);
            }
        };
    }, []);

    // Create Collection
    const createCollection = useCallback(async (): Promise<string | null> => {
        if (!projectId) return null;
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

            dispatch(createCollectionSuccess({
                projectId,
                collection: { id: newColId, name: newName, isExpanded: true, sessions: [] },
            }));
            return newColId;
        } catch (err) {
            console.error('Failed to create collection:', err);
            return null;
        }
    }, [collections.length, dispatch, projectId]);

    // Create Session
    const createSession = useCallback(async (collectionId: string, initialData?: { name?: string; request?: string; url?: string; urlIsValid?: boolean }) => {
        if (!projectId) return;
        const col = collections.find(c => c.id === collectionId);
        if (!col) return;

        const newSessId = crypto.randomUUID();
        const sessionCount = col.sessions.length;
        const name = initialData?.name || `Session ${sessionCount + 1}`;
        const rawUrl = initialData?.url || 'https://';
        const url = rawUrl !== 'https://' && rawUrl.trim() && !rawUrl.includes('://') ? `https://${rawUrl}` : rawUrl;
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

            dispatch(createSessionSuccess({
                projectId,
                collectionId,
                session: { id: newSessId, name, url, urlIsValid },
                cacheItem: {
                    requestTmp,
                    url,
                    urlIsValid,
                    history: [],
                    selectedHistoryIndex: null,
                },
            }));

            invoke('set_replayer_active_selection', {
                projectId,
                collectionId,
                sessionId: newSessId,
            }).catch(console.error);
        } catch (err) {
            console.error('Failed to create session:', err);
        }
    }, [collections, dispatch, projectId]);

    // Rename Collection
    const renameCollection = useCallback(async (collectionId: string, name: string) => {
        if (!projectId) return;
        dispatch(renameCollectionSuccess({ projectId, collectionId, name }));
        invoke('rename_replayer_collection', { collectionId, name }).catch(console.error);
    }, [dispatch, projectId]);

    // Rename Session
    const renameSession = useCallback(async (collectionId: string, sessionId: string, name: string) => {
        if (!projectId) return;
        dispatch(renameSessionSuccess({ projectId, collectionId, sessionId, name }));
        invoke('rename_replayer_session', { sessionId, name }).catch(console.error);
    }, [dispatch, projectId]);

    // Delete Collection (guarded against default collection 0)
    const deleteCollection = useCallback(async (collectionId: string) => {
        if (!projectId) return;
        const colIndex = collections.findIndex(c => c.id === collectionId);
        if (colIndex === 0 || collections.length <= 1) return;

        dispatch(deleteCollectionSuccess({ projectId, collectionId }));

        if (selectedCollectionId === collectionId) {
            const remainingCols = collections.filter(c => c.id !== collectionId);
            const nextCol = remainingCols[0] || null;
            invoke('set_replayer_active_selection', {
                projectId,
                collectionId: nextCol?.id || '',
                sessionId: '',
            }).catch(console.error);
        }

        invoke('delete_replayer_collection', { collectionId }).catch(console.error);
    }, [collections, dispatch, projectId, selectedCollectionId]);

    // Delete Session (clears active selection to show EmptyState if deleted session was active)
    const deleteSession = useCallback(async (collectionId: string, sessionId: string) => {
        if (!projectId) return;
        const reqId = activeRequestsRef.current.get(sessionId);
        if (reqId) {
            activeRequestsRef.current.delete(sessionId);
            invoke('cancel_replayer_request', { reqId }).catch(console.error);
        }

        dispatch(deleteSessionSuccess({ projectId, collectionId, sessionId }));

        if (selectedSessionId === sessionId) {
            invoke('set_replayer_active_selection', {
                projectId,
                collectionId,
                sessionId: '',
            }).catch(console.error);
        }

        invoke('delete_replayer_session', { sessionId }).catch(console.error);
    }, [dispatch, projectId, selectedSessionId]);

    // Update Draft Content (Keystrokes in CodeMirror)
    const updateDraftContent = useCallback((newRequestTmp: string) => {
        if (!projectId || !selectedSessionId) return;
        const sessId = selectedSessionId;

        dispatch(setSessionDraftContent({ projectId, sessionId: sessId, requestTmp: newRequestTmp }));

        if (debounceDraftTimerRef.current) {
            clearTimeout(debounceDraftTimerRef.current);
        }
        debounceDraftTimerRef.current = setTimeout(() => {
            invoke('update_replayer_session_draft', {
                sessionId: sessId,
                requestTmp: newRequestTmp,
                baseUrl: null,
                selectedHistoryIndex: null,
            }).catch(console.error);
        }, 300);
    }, [dispatch, projectId, selectedSessionId]);

    // Update URL
    const updateDraftUrl = useCallback((url: string, urlIsValid: boolean) => {
        if (!projectId || !selectedSessionId) return;
        const sessId = selectedSessionId;

        dispatch(setSessionDraftUrl({ projectId, sessionId: sessId, url, urlIsValid }));

        invoke('update_replayer_session_draft', {
            sessionId: sessId,
            requestTmp: null,
            baseUrl: url,
            selectedHistoryIndex: null,
        }).catch(console.error);
    }, [dispatch, projectId, selectedSessionId]);

    // Select History Item (restores requestTmp, baseUrl, and selectedHistoryIndex)
    const selectHistoryIndex = useCallback((index: number) => {
        if (!projectId || !selectedSessionId) return;
        const sessId = selectedSessionId;

        dispatch(setSessionSelectedHistoryIndex({ projectId, sessionId: sessId, index }));

        const hItem = history[index];
        if (hItem) {
            const targetUrl = hItem.baseUrl && hItem.baseUrl.trim() !== '' ? hItem.baseUrl : (activeDraft?.url || 'https://');
            invoke('update_replayer_session_draft', {
                sessionId: sessId,
                requestTmp: hItem.requestRaw,
                baseUrl: targetUrl,
                selectedHistoryIndex: index,
            }).catch(console.error);
        }
    }, [activeDraft?.url, dispatch, history, projectId, selectedSessionId]);

    // Trigger Replay (scoped per sessionId)
    const triggerReplay = useCallback(async () => {
        if (!projectId || !selectedSessionId || !activeDraft) return;

        const sessId = selectedSessionId;
        const reqId = crypto.randomUUID();

        activeRequestsRef.current.set(sessId, reqId);
        dispatch(setPendingSession({ projectId, sessionId: sessId, reqId }));

        const stripedUrl = stripPath(activeDraft.url);
        updateDraftUrl(stripedUrl, true);

        const currentRequestTmp = activeDraft.requestTmp;

        try {
            const response = await invoke<ReplayerHistoryItem>('replay_request', {
                requestTmp: currentRequestTmp,
                url: stripedUrl,
                reqId,
            });

            if (activeRequestsRef.current.get(sessId) === reqId) {
                activeRequestsRef.current.delete(sessId);
                dispatch(clearPendingSession({ projectId, sessionId: sessId }));

                const parsed = parseResponse(response.responseRaw);
                const statusCodeStr = parsed.statusCode
                    ? `${parsed.statusCode}${parsed.statusText ? ' ' + parsed.statusText : ''}`
                    : '200 OK';

                const historyId = response.id || crypto.randomUUID();
                const createdAt = response.createdAt || new Date().toISOString();
                const responseTime = response.responseTime ?? response.requestTime ?? 0;

                const fullItem: ReplayerHistoryItem = {
                    ...response,
                    id: historyId,
                    createdAt,
                    responseTime,
                    requestTime: responseTime,
                    status: statusCodeStr,
                    errorMessage: null,
                    baseUrl: stripedUrl,
                };

                dispatch(addSessionHistoryItem({ projectId, sessionId: sessId, item: fullItem }));

                invoke('add_replayer_history_entry', {
                    sessionId: sessId,
                    historyId: fullItem.id,
                    requestRaw: fullItem.requestRaw,
                    responseRaw: fullItem.responseRaw,
                    responseTime: fullItem.responseTime,
                    createdAt: fullItem.createdAt,
                    status: fullItem.status,
                    errorMessage: fullItem.errorMessage,
                    baseUrl: fullItem.baseUrl || null,
                }).catch(console.error);

                invoke('update_replayer_session_draft', {
                    sessionId: sessId,
                    requestTmp: fullItem.requestRaw,
                    baseUrl: fullItem.baseUrl || null,
                    selectedHistoryIndex: 0,
                }).catch(console.error);
            }
        } catch (error) {
            if (activeRequestsRef.current.get(sessId) === reqId) {
                console.error('Error replaying request:', error);
                activeRequestsRef.current.delete(sessId);
                dispatch(clearPendingSession({ projectId, sessionId: sessId }));

                const errStr = typeof error === 'string' ? error : (error as any)?.message || 'Request failed';
                const isCanceled = errStr.toLowerCase().includes('cancel');

                if (!isCanceled && isDnsResolutionError(errStr)) {
                    toast.error(errStr, { position: 'top-center' });
                    return;
                }

                const errItem: ReplayerHistoryItem = {
                    id: crypto.randomUUID(),
                    requestRaw: currentRequestTmp,
                    responseRaw: '',
                    baseUrl: stripedUrl,
                    responseTime: 0,
                    createdAt: new Date().toISOString(),
                    status: isCanceled ? 'Canceled' : 'Error',
                    errorMessage: isCanceled ? null : errStr,
                };

                dispatch(addSessionHistoryItem({ projectId, sessionId: sessId, item: errItem }));

                invoke('add_replayer_history_entry', {
                    sessionId: sessId,
                    historyId: errItem.id,
                    requestRaw: errItem.requestRaw,
                    responseRaw: errItem.responseRaw,
                    responseTime: errItem.responseTime,
                    createdAt: errItem.createdAt,
                    status: errItem.status,
                    errorMessage: errItem.errorMessage,
                    baseUrl: errItem.baseUrl || null,
                }).catch(console.error);
            }
        }
    }, [activeDraft, dispatch, projectId, selectedSessionId, updateDraftUrl]);

    // Cancel Replay (scoped per sessionId)
    const cancelReplay = useCallback(async () => {
        if (!projectId || !selectedSessionId || !activeDraft) return;
        const sessId = selectedSessionId;
        const reqId = activeRequestsRef.current.get(sessId);

        if (reqId) {
            activeRequestsRef.current.delete(sessId);
            dispatch(clearPendingSession({ projectId, sessionId: sessId }));

            try {
                await invoke('cancel_replayer_request', { reqId });
            } catch (e) {
                console.error('Failed to cancel replayer request:', e);
            }

            const canceledItem: ReplayerHistoryItem = {
                id: crypto.randomUUID(),
                requestRaw: activeDraft.requestTmp,
                responseRaw: '',
                baseUrl: stripPath(activeDraft.url),
                responseTime: 0,
                createdAt: new Date().toISOString(),
                status: 'Canceled',
                errorMessage: null,
            };

            dispatch(addSessionHistoryItem({ projectId, sessionId: sessId, item: canceledItem }));

            invoke('add_replayer_history_entry', {
                sessionId: sessId,
                historyId: canceledItem.id,
                requestRaw: canceledItem.requestRaw,
                responseRaw: canceledItem.responseRaw,
                responseTime: canceledItem.responseTime,
                createdAt: canceledItem.createdAt,
                status: canceledItem.status,
                errorMessage: canceledItem.errorMessage,
                baseUrl: canceledItem.baseUrl || null,
            }).catch(console.error);
        }
    }, [activeDraft, dispatch, projectId, selectedSessionId]);

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

    // Tree Context Value (only changes on tree structure / selection mutations)
    const treeValue = useMemo<ReplayerTreeContextType>(() => ({
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        isLoaded,

        selectSession,
        deselectSession,
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
        deselectSession,
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
