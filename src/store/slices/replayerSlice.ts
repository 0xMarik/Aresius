import { ReplayerCollection, ReplayerFullData, ReplayerHistoryItem } from "@/types/replayer.type";
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { deleteProject } from "./projectSlice";
import { invoke } from "@tauri-apps/api/core";

export const fetchReplayerData = createAsyncThunk(
    'replayer/fetchReplayerData',
    async (projectId: string) => {
        try {
            const data = await invoke<ReplayerFullData>('get_replayer_data', { projectId });
            return { projectId, data };
        } catch (err) {
            console.error('Failed to fetch replayer data:', err);
            return { projectId, data: null };
        }
    }
);

interface ReplayerState {
    collections: ReplayerCollection[];
    selectedCollectionIndex: number;
    receivedSession: number;
    expandedIds: string[];
}

const defaultReplayerState = (): ReplayerState => ({
    collections: [
        {
            sessions: [
                {
                    history: [],
                    requestTmp: 'GET / HTTP/1.1\r\n\r\n',
                    url: 'https://',
                    selectedHistoryIndex: null,
                    urlIsValid: false,
                }
            ],
            selectedSessionIndex: 0,
            isExpanded: true,
        },
    ],
    selectedCollectionIndex: 0,
    receivedSession: 0,
    expandedIds: ['0'],
});

// ─── Per-project map ────────────────────────────────────────────────────────────

type ReplayerByProject = Record<string, ReplayerState>

const initialState: ReplayerByProject = {};

function getBucket(state: ReplayerByProject, projectId: string): ReplayerState {
    if (!state[projectId]) state[projectId] = defaultReplayerState();
    return state[projectId];
}

const replayerSlice = createSlice({
    name: 'replayer',
    initialState,
    reducers: {
        setReaplayerContent: (state, action: PayloadAction<{ rawRequest: string; projectId: string }>) => {
            const { rawRequest, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection && collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                session.requestTmp = rawRequest;
                if (session.id) {
                    invoke('update_replayer_session_draft', { sessionId: session.id, requestTmp: rawRequest, baseUrl: null }).catch(console.error);
                }
            }
        },
        setReaplayerURL: (state, action: PayloadAction<{ url: string; urlIsValid: boolean; projectId: string }>) => {
            const { url, urlIsValid, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection && collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                session.url = url;
                session.urlIsValid = urlIsValid;
                if (session.id) {
                    invoke('update_replayer_session_draft', { sessionId: session.id, requestTmp: null, baseUrl: url }).catch(console.error);
                }
            }
        },
        addReplayerHistory: (state, action: PayloadAction<{ historyItem: ReplayerHistoryItem; projectId: string }>) => {
            const { historyItem, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection && collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                const historyId = historyItem.id || crypto.randomUUID();
                const createdAt = historyItem.createdAt || new Date().toISOString();
                const responseTime = historyItem.responseTime ?? historyItem.requestTime ?? 0;
                const baseUrl = historyItem.baseUrl || session.url || '';
                const status = historyItem.status || '';
                const errorMessage = historyItem.errorMessage ?? null;
                const itemWithId: ReplayerHistoryItem = {
                    ...historyItem,
                    id: historyId,
                    createdAt,
                    responseTime,
                    requestTime: responseTime,
                    baseUrl,
                    status,
                    errorMessage,
                };
                session.requestTmp = historyItem.requestRaw;
                session.history = [itemWithId, ...session.history];
                session.selectedHistoryIndex = 0;

                if (session.id) {
                    invoke('add_replayer_history_entry', {
                        sessionId: session.id,
                        historyId,
                        requestRaw: historyItem.requestRaw,
                        responseRaw: historyItem.responseRaw,
                        responseTime,
                        createdAt,
                        status: status || null,
                        errorMessage: errorMessage || null,
                    }).catch(console.error);

                    invoke('update_replayer_session_draft', { sessionId: session.id, requestTmp: historyItem.requestRaw, baseUrl: null }).catch(console.error);
                }
            }
        },
        selectedHisotryIndex: (state, action: PayloadAction<{ historyIndex: number; projectId: string }>) => {
            const { historyIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection && collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                if (session.history[historyIndex]) {
                    session.requestTmp = session.history[historyIndex].requestRaw;
                    session.selectedHistoryIndex = historyIndex;
                    if (session.id) {
                        invoke('update_replayer_session_draft', { sessionId: session.id, requestTmp: session.history[historyIndex].requestRaw, baseUrl: null }).catch(console.error);
                    }
                }
            }
        },
        setExpandedIds: (state, action: PayloadAction<{ expandedIds: string[]; projectId: string }>) => {
            const { expandedIds, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.expandedIds = expandedIds;
            if (projectId) {
                invoke('set_replayer_expanded_ids', { projectId, expandedIds }).catch(console.error);
            }
        },
        toggleCollectionExpanded: (state, action: PayloadAction<{ collectionId: string; isExpanded: boolean; projectId: string }>) => {
            const { collectionId, isExpanded, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (isExpanded) {
                if (!bucket.expandedIds.includes(collectionId)) {
                    bucket.expandedIds.push(collectionId);
                }
            } else {
                bucket.expandedIds = bucket.expandedIds.filter(id => id !== collectionId);
            }
            if (projectId) {
                invoke('set_replayer_collection_expanded', { collectionId, isExpanded }).catch(console.error);
            }
        },
        addCollection: (state, action: PayloadAction<string | { projectId: string; isItReplayerPage?: boolean; initialRequest?: string; initialUrl?: string; initialUrlIsValid?: boolean }>) => {
            const payload = typeof action.payload === 'string'
                ? { projectId: action.payload, isItReplayerPage: true }
                : action.payload;
            const { projectId, isItReplayerPage = false, initialRequest, initialUrl, initialUrlIsValid } = payload;
            const bucket = getBucket(state, projectId);
            const newColIndex = bucket.collections.length;
            const colId = crypto.randomUUID();
            const sessId = crypto.randomUUID();
            const colName = `Collection ${newColIndex + 1}`;
            const sessName = 'Session 1';
            const req = initialRequest ?? 'GET / HTTP/1.1\r\n\r\n';
            const url = initialUrl ?? 'https://';
            const isValid = initialUrlIsValid ?? (url !== 'https://');

            bucket.collections.push({
                id: colId,
                name: colName,
                isExpanded: true,
                sessions: [
                    {
                        id: sessId,
                        name: sessName,
                        history: [],
                        requestTmp: req,
                        url: url,
                        selectedHistoryIndex: null,
                        urlIsValid: isValid,
                    }
                ],
                selectedSessionIndex: 0,
            });
            bucket.selectedCollectionIndex = newColIndex;
            if (!bucket.expandedIds.includes(colId)) {
                bucket.expandedIds.push(colId);
            }

            if (!isItReplayerPage) {
                bucket.receivedSession += 1;
            }

            if (projectId) {
                invoke('create_replayer_collection', {
                    projectId,
                    collectionId: colId,
                    name: colName,
                    sortOrder: newColIndex,
                }).then(() => {
                    invoke('create_replayer_session', {
                        collectionId: colId,
                        sessionId: sessId,
                        name: sessName,
                        baseUrl: url,
                        requestTmp: req,
                        sortOrder: 0,
                    }).catch(console.error);
                }).catch(console.error);
            }
        },
        selectColSess: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number | null; projectId: string }>) => {
            const { collectionIndex, sessionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (collectionIndex >= 0 && collectionIndex < bucket.collections.length) {
                bucket.selectedCollectionIndex = collectionIndex;
                const col = bucket.collections[collectionIndex];
                col.selectedSessionIndex = sessionIndex;

                if (projectId && col.id) {
                    const sessId = (sessionIndex !== null && sessionIndex >= 0 && sessionIndex < col.sessions.length)
                        ? col.sessions[sessionIndex]?.id ?? null
                        : null;
                    invoke('set_replayer_active_selection', {
                        projectId,
                        collectionId: col.id,
                        sessionId: sessId,
                    }).catch(console.error);
                }
            }
        },
        addSessionToCollection: (state, action: PayloadAction<{ collectionIndex: number; isItReplayerPage: boolean; projectId: string; initialRequest?: string; initialUrl?: string; initialUrlIsValid?: boolean }>) => {
            const { collectionIndex, isItReplayerPage, projectId, initialRequest, initialUrl, initialUrlIsValid } = action.payload;
            const bucket = getBucket(state, projectId);
            const targetColIndex = (collectionIndex >= 0 && collectionIndex < bucket.collections.length)
                ? collectionIndex
                : bucket.selectedCollectionIndex;
            const collection = bucket.collections[targetColIndex];
            if (collection) {
                const newSessionIndex = collection.sessions.length;
                const sessId = crypto.randomUUID();
                const sessName = `Session ${newSessionIndex + 1}`;
                const req = initialRequest ?? 'GET / HTTP/1.1\r\n\r\n';
                const url = initialUrl ?? 'https://';
                const isValid = initialUrlIsValid ?? (url !== 'https://');

                collection.sessions.push({
                    id: sessId,
                    name: sessName,
                    history: [],
                    requestTmp: req,
                    url: url,
                    selectedHistoryIndex: null,
                    urlIsValid: isValid,
                });
                collection.selectedSessionIndex = newSessionIndex;
                bucket.selectedCollectionIndex = targetColIndex;

                if (collection.id && !bucket.expandedIds.includes(collection.id)) {
                    bucket.expandedIds.push(collection.id);
                }

                if (collection.id) {
                    invoke('create_replayer_session', {
                        collectionId: collection.id,
                        sessionId: sessId,
                        name: sessName,
                        baseUrl: url,
                        requestTmp: req,
                        sortOrder: newSessionIndex,
                    }).catch(console.error);
                }
            }
            bucket.receivedSession = !isItReplayerPage ? bucket.receivedSession + 1 : bucket.receivedSession;
        },
        resetReplayerReceivedSession: (state, action: PayloadAction<string>) => {
            getBucket(state, action.payload).receivedSession = 0;
        },
        removeCollection: (state, action: PayloadAction<{ collectionIndex: number; projectId: string }>) => {
            const { collectionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (collectionIndex >= 0 && collectionIndex < bucket.collections.length) {
                const removed = bucket.collections.splice(collectionIndex, 1)[0];
                if (removed?.id) {
                    bucket.expandedIds = bucket.expandedIds.filter(id => id !== removed.id);
                    invoke('delete_replayer_collection', { collectionId: removed.id }).catch(console.error);
                }
                if (bucket.collections.length === 0) {
                    bucket.collections.push({ sessions: [], selectedSessionIndex: null, isExpanded: true });
                    bucket.selectedCollectionIndex = 0;
                } else if (bucket.selectedCollectionIndex >= bucket.collections.length) {
                    bucket.selectedCollectionIndex = bucket.collections.length - 1;
                }

                const activeCol = bucket.collections[bucket.selectedCollectionIndex];
                if (projectId && activeCol?.id) {
                    const activeSess = (activeCol.selectedSessionIndex !== null && activeCol.selectedSessionIndex >= 0 && activeCol.selectedSessionIndex < activeCol.sessions.length)
                        ? activeCol.sessions[activeCol.selectedSessionIndex]?.id ?? null
                        : null;
                    invoke('set_replayer_active_selection', {
                        projectId,
                        collectionId: activeCol.id,
                        sessionId: activeSess,
                    }).catch(console.error);
                }
            }
        },
        removeSession: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number; projectId: string }>) => {
            const { collectionIndex, sessionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[collectionIndex];
            if (collection && sessionIndex >= 0 && sessionIndex < collection.sessions.length) {
                const removed = collection.sessions.splice(sessionIndex, 1)[0];
                if (removed?.id) {
                    invoke('delete_replayer_session', { sessionId: removed.id }).catch(console.error);
                }
                if (collection.selectedSessionIndex === sessionIndex) {
                    collection.selectedSessionIndex = collection.sessions.length > 0
                        ? Math.min(sessionIndex, collection.sessions.length - 1)
                        : null;
                } else if (collection.selectedSessionIndex !== null && collection.selectedSessionIndex > sessionIndex) {
                    collection.selectedSessionIndex -= 1;
                }

                if (projectId && collection.id) {
                    const activeSess = (collection.selectedSessionIndex !== null && collection.selectedSessionIndex >= 0 && collection.selectedSessionIndex < collection.sessions.length)
                        ? collection.sessions[collection.selectedSessionIndex]?.id ?? null
                        : null;
                    invoke('set_replayer_active_selection', {
                        projectId,
                        collectionId: collection.id,
                        sessionId: activeSess,
                    }).catch(console.error);
                }
            }
        },
        renameCollection: (state, action: PayloadAction<{ collectionIndex: number; name: string; projectId: string }>) => {
            const { collectionIndex, name, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[collectionIndex];
            if (collection) {
                collection.name = name;
                if (collection.id) {
                    invoke('rename_replayer_collection', { collectionId: collection.id, name }).catch(console.error);
                }
            }
        },
        renameSession: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number; name: string; projectId: string }>) => {
            const { collectionIndex, sessionIndex, name, projectId } = action.payload;
            const collection = getBucket(state, projectId).collections[collectionIndex];
            const session = collection?.sessions[sessionIndex];
            if (session) {
                session.name = name;
                if (session.id) {
                    invoke('rename_replayer_session', { sessionId: session.id, name }).catch(console.error);
                }
            }
        },
    },
    extraReducers: (builder) => {
        builder.addCase(deleteProject, (state, action) => {
            delete state[action.payload];
        });
        builder.addCase(fetchReplayerData.fulfilled, (state, action) => {
            const { projectId, data } = action.payload;
            if (!data || !projectId) return;
            const bucket = getBucket(state, projectId);
            if (data.collections && data.collections.length > 0) {
                bucket.collections = data.collections.map((c) => ({
                    id: c.id,
                    name: c.name,
                    isExpanded: c.isExpanded,
                    selectedSessionIndex: c.selectedSessionIndex ?? (c.sessions.length > 0 ? 0 : null),
                    sessions: c.sessions.map((s) => ({
                        id: s.id,
                        name: s.name,
                        url: s.url,
                        requestTmp: s.requestTmp,
                        selectedHistoryIndex: s.selectedHistoryIndex ?? (s.history.length > 0 ? 0 : null),
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
                    })),
                }));
                bucket.selectedCollectionIndex = (data.selectedCollectionIndex !== undefined && data.selectedCollectionIndex < data.collections.length)
                    ? data.selectedCollectionIndex
                    : 0;
                bucket.expandedIds = data.expandedIds ?? data.collections.filter(c => c.isExpanded !== false).map(c => c.id);
            }
        });
    },
});

export const {
    setReaplayerContent,
    setReaplayerURL,
    addReplayerHistory,
    selectedHisotryIndex,
    setExpandedIds,
    toggleCollectionExpanded,
    addCollection,
    selectColSess,
    addSessionToCollection,
    resetReplayerReceivedSession,
    removeCollection,
    removeSession,
    renameCollection,
    renameSession,
} = replayerSlice.actions;

// ─── Selectors ─────────────────────────────────────────────────────────────────

const DEFAULT_REPLAYER_STATE = defaultReplayerState();

const replayerSelectorsCache = new Map<string | null, (state: RootState) => ReplayerState>();

export const selectReplayerState = (projectId: string | null) => {
    if (!replayerSelectorsCache.has(projectId)) {
        replayerSelectorsCache.set(
            projectId,
            (state: RootState): ReplayerState =>
                projectId && state.replayerstate[projectId] ? state.replayerstate[projectId] : DEFAULT_REPLAYER_STATE
        );
    }
    return replayerSelectorsCache.get(projectId)!;
};

export default replayerSlice.reducer;