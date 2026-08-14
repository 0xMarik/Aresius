import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { deleteProject } from "./projectSlice";
import { ReplayerHistoryItem } from "@/types/replayer.type";

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

export interface ReplayerSessionCacheItem {
    requestTmp: string;
    url: string;
    urlIsValid: boolean;
    history: ReplayerHistoryItem[];
    selectedHistoryIndex: number | null;
}

export interface ActiveSessionDraft {
    sessionId: string | null;
    collectionId: string | null;
    name: string;
    url: string;
    urlIsValid: boolean;
    requestTmp: string;
}

export interface ReplayerProjectState {
    isLoaded: boolean;
    isLoading: boolean;
    collections: ReplayerCollectionMeta[];
    selectedCollectionId: string | null;
    selectedSessionId: string | null;
    expandedIds: string[];
    sessionCache: Record<string, ReplayerSessionCacheItem>;
    pendingSessions: Record<string, string>; // sessionId -> reqId
    receivedSession: number;
}

export const defaultReplayerProjectState = (): ReplayerProjectState => ({
    isLoaded: false,
    isLoading: false,
    collections: [],
    selectedCollectionId: null,
    selectedSessionId: null,
    expandedIds: [],
    sessionCache: {},
    pendingSessions: {},
    receivedSession: 0,
});

export type ReplayerStateByProject = Record<string, ReplayerProjectState>;

const initialState: ReplayerStateByProject = {};

function getBucket(state: ReplayerStateByProject, projectId: string): ReplayerProjectState {
    if (!state[projectId]) {
        state[projectId] = defaultReplayerProjectState();
    }
    return state[projectId];
}

const replayerSlice = createSlice({
    name: 'replayer',
    initialState,
    reducers: {
        setReplayerLoading: (state, action: PayloadAction<{ projectId: string; isLoading: boolean }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.isLoading = action.payload.isLoading;
        },

        setReplayerLoadedData: (state, action: PayloadAction<{
            projectId: string;
            collections: ReplayerCollectionMeta[];
            selectedCollectionId: string | null;
            selectedSessionId: string | null;
            expandedIds: string[];
            sessionCache: Record<string, ReplayerSessionCacheItem>;
        }>) => {
            const { projectId, collections, selectedCollectionId, selectedSessionId, expandedIds, sessionCache } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.collections = collections;
            bucket.selectedCollectionId = selectedCollectionId;
            bucket.selectedSessionId = selectedSessionId;
            bucket.expandedIds = expandedIds;
            bucket.sessionCache = sessionCache;
            bucket.isLoaded = true;
            bucket.isLoading = false;
        },

        setSelectedCollectionId: (state, action: PayloadAction<{ projectId: string; collectionId: string | null }>) => {
            const { projectId, collectionId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.selectedCollectionId = collectionId;
        },

        setSelectedSessionId: (state, action: PayloadAction<{ projectId: string; sessionId: string | null }>) => {
            const { projectId, sessionId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.selectedSessionId = sessionId;
        },

        setSelection: (state, action: PayloadAction<{ projectId: string; collectionId: string | null; sessionId: string | null }>) => {
            const { projectId, collectionId, sessionId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.selectedCollectionId = collectionId;
            bucket.selectedSessionId = sessionId;
        },

        setExpandedIds: (state, action: PayloadAction<{ projectId: string; expandedIds: string[] }>) => {
            const { projectId, expandedIds } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.expandedIds = expandedIds;
        },

        toggleCollectionExpand: (state, action: PayloadAction<{ projectId: string; collectionId: string }>) => {
            const { projectId, collectionId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (bucket.expandedIds.includes(collectionId)) {
                bucket.expandedIds = bucket.expandedIds.filter(id => id !== collectionId);
            } else {
                bucket.expandedIds.push(collectionId);
            }
        },

        setSessionDraftContent: (state, action: PayloadAction<{ projectId: string; sessionId: string; requestTmp: string }>) => {
            const { projectId, sessionId, requestTmp } = action.payload;
            const bucket = getBucket(state, projectId);
            if (bucket.sessionCache[sessionId]) {
                bucket.sessionCache[sessionId].requestTmp = requestTmp;
            }
        },

        setSessionDraftUrl: (state, action: PayloadAction<{ projectId: string; sessionId: string; url: string; urlIsValid: boolean }>) => {
            const { projectId, sessionId, url, urlIsValid } = action.payload;
            const bucket = getBucket(state, projectId);
            if (bucket.sessionCache[sessionId]) {
                bucket.sessionCache[sessionId].url = url;
                bucket.sessionCache[sessionId].urlIsValid = urlIsValid;
            }
            bucket.collections = bucket.collections.map(c => ({
                ...c,
                sessions: c.sessions.map(s => s.id === sessionId ? { ...s, url, urlIsValid } : s),
            }));
        },

        setSessionSelectedHistoryIndex: (state, action: PayloadAction<{ projectId: string; sessionId: string; index: number }>) => {
            const { projectId, sessionId, index } = action.payload;
            const bucket = getBucket(state, projectId);
            const cache = bucket.sessionCache[sessionId];
            if (cache) {
                cache.selectedHistoryIndex = index;
                const hItem = cache.history[index];
                if (hItem) {
                    cache.requestTmp = hItem.requestRaw;
                    if (hItem.baseUrl && hItem.baseUrl.trim() !== '') {
                        cache.url = hItem.baseUrl;
                        cache.urlIsValid = !hItem.baseUrl.startsWith('https://') || hItem.baseUrl.length > 8;
                    }
                }
            }
        },

        addSessionHistoryItem: (state, action: PayloadAction<{ projectId: string; sessionId: string; item: ReplayerHistoryItem }>) => {
            const { projectId, sessionId, item } = action.payload;
            const bucket = getBucket(state, projectId);
            const cache = bucket.sessionCache[sessionId];
            if (cache) {
                cache.history = [item, ...cache.history];
                cache.selectedHistoryIndex = 0;
                cache.requestTmp = item.requestRaw;
                if (item.baseUrl) {
                    cache.url = item.baseUrl;
                    cache.urlIsValid = !item.baseUrl.startsWith('https://') || item.baseUrl.length > 8;
                }
            }
        },

        setPendingSession: (state, action: PayloadAction<{ projectId: string; sessionId: string; reqId: string }>) => {
            const { projectId, sessionId, reqId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.pendingSessions[sessionId] = reqId;
        },

        clearPendingSession: (state, action: PayloadAction<{ projectId: string; sessionId: string }>) => {
            const { projectId, sessionId } = action.payload;
            const bucket = getBucket(state, projectId);
            delete bucket.pendingSessions[sessionId];
        },

        createCollectionSuccess: (state, action: PayloadAction<{ projectId: string; collection: ReplayerCollectionMeta }>) => {
            const { projectId, collection } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.collections.push(collection);
            if (!bucket.expandedIds.includes(collection.id)) {
                bucket.expandedIds.push(collection.id);
            }
            bucket.selectedCollectionId = collection.id;
        },

        createSessionSuccess: (state, action: PayloadAction<{
            projectId: string;
            collectionId: string;
            session: ReplayerSessionMeta;
            cacheItem: ReplayerSessionCacheItem;
        }>) => {
            const { projectId, collectionId, session, cacheItem } = action.payload;
            const bucket = getBucket(state, projectId);
            const col = bucket.collections.find(c => c.id === collectionId);
            if (col) {
                col.sessions.push(session);
                col.isExpanded = true;
            }
            if (!bucket.expandedIds.includes(collectionId)) {
                bucket.expandedIds.push(collectionId);
            }
            bucket.sessionCache[session.id] = cacheItem;
            bucket.selectedCollectionId = collectionId;
            bucket.selectedSessionId = session.id;
        },

        renameCollectionSuccess: (state, action: PayloadAction<{ projectId: string; collectionId: string; name: string }>) => {
            const { projectId, collectionId, name } = action.payload;
            const bucket = getBucket(state, projectId);
            const col = bucket.collections.find(c => c.id === collectionId);
            if (col) {
                col.name = name;
            }
        },

        renameSessionSuccess: (state, action: PayloadAction<{ projectId: string; collectionId: string; sessionId: string; name: string }>) => {
            const { projectId, collectionId, sessionId, name } = action.payload;
            const bucket = getBucket(state, projectId);
            const col = bucket.collections.find(c => c.id === collectionId);
            if (col) {
                const sess = col.sessions.find(s => s.id === sessionId);
                if (sess) {
                    sess.name = name;
                }
            }
        },

        deleteCollectionSuccess: (state, action: PayloadAction<{ projectId: string; collectionId: string }>) => {
            const { projectId, collectionId } = action.payload;
            const bucket = getBucket(state, projectId);
            const deletedCol = bucket.collections.find(c => c.id === collectionId);
            if (deletedCol) {
                for (const s of deletedCol.sessions) {
                    delete bucket.sessionCache[s.id];
                    delete bucket.pendingSessions[s.id];
                }
            }
            const remaining = bucket.collections.filter(c => c.id !== collectionId);
            bucket.collections = remaining;

            if (bucket.selectedCollectionId === collectionId) {
                const nextCol = remaining[0] || null;
                bucket.selectedCollectionId = nextCol?.id || null;
                bucket.selectedSessionId = null;
            }
        },

        deleteSessionSuccess: (state, action: PayloadAction<{ projectId: string; collectionId: string; sessionId: string }>) => {
            const { projectId, collectionId, sessionId } = action.payload;
            const bucket = getBucket(state, projectId);
            const col = bucket.collections.find(c => c.id === collectionId);
            if (col) {
                col.sessions = col.sessions.filter(s => s.id !== sessionId);
            }
            delete bucket.sessionCache[sessionId];
            delete bucket.pendingSessions[sessionId];

            if (bucket.selectedSessionId === sessionId) {
                bucket.selectedSessionId = null;
            }
        },

        incrementReplayerReceivedSession: (state, action: PayloadAction<{ projectId: string }>) => {
            const { projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.receivedSession += 1;
        },

        resetReplayerReceivedSession: (state, action: PayloadAction<string>) => {
            const projectId = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.receivedSession = 0;
        },
    },
    extraReducers: (builder) => {
        builder.addCase(deleteProject, (state, action) => {
            delete state[action.payload];
        });
    },
});

export const {
    setReplayerLoading,
    setReplayerLoadedData,
    setSelectedCollectionId,
    setSelectedSessionId,
    setSelection,
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
    incrementReplayerReceivedSession,
    resetReplayerReceivedSession,
} = replayerSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectReplayerState = (projectId: string | null) => (state: RootState): ReplayerProjectState => {
    if (!projectId || !state.replayerstate[projectId]) {
        return defaultReplayerProjectState();
    }
    return state.replayerstate[projectId];
};

export const selectReplayerProjectState = selectReplayerState;

export const selectReplayerCollections = (projectId: string | null) => (state: RootState): ReplayerCollectionMeta[] => {
    if (!projectId || !state.replayerstate[projectId]) return [];
    return state.replayerstate[projectId].collections;
};

export const selectReplayerExpandedIds = (projectId: string | null) => (state: RootState): string[] => {
    if (!projectId || !state.replayerstate[projectId]) return [];
    return state.replayerstate[projectId].expandedIds;
};

export const selectReplayerSelectedSessionId = (projectId: string | null) => (state: RootState): string | null => {
    if (!projectId || !state.replayerstate[projectId]) return null;
    return state.replayerstate[projectId].selectedSessionId;
};

export const selectReplayerSelectedCollectionId = (projectId: string | null) => (state: RootState): string | null => {
    if (!projectId || !state.replayerstate[projectId]) return null;
    return state.replayerstate[projectId].selectedCollectionId;
};

export const selectReplayerIsLoaded = (projectId: string | null) => (state: RootState): boolean => {
    if (!projectId || !state.replayerstate[projectId]) return false;
    return state.replayerstate[projectId].isLoaded;
};

export const selectReplayerReceivedSession = (projectId: string | null) => (state: RootState): number => {
    if (!projectId || !state.replayerstate[projectId]) return 0;
    return state.replayerstate[projectId].receivedSession;
};

export default replayerSlice.reducer;