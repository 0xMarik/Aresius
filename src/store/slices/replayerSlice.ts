import { ReplayerCollection, ReplayerHistoryItem } from "@/types/replayer.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { deleteProject } from "./projectSlice";

interface ReplayerState {
    collections: ReplayerCollection[];
    selectedCollectionIndex: number;
    receivedSession: number;
}

const defaultReplayerState = (): ReplayerState => ({
    collections: [
        {
            sessions: [],
            selectedSessionIndex: null,
        },
    ],
    selectedCollectionIndex: 0,
    receivedSession: 0,
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
            if (collection.selectedSessionIndex !== null) {
                collection.sessions[collection.selectedSessionIndex].requestTmp = rawRequest;
            }
        },
        setReaplayerURL: (state, action: PayloadAction<{ url: string; urlIsValid: boolean; projectId: string }>) => {
            const { url, urlIsValid, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                session.url = url;
                session.urlIsValid = urlIsValid;
            }
        },
        addReplayerHistory: (state, action: PayloadAction<{ historyItem: ReplayerHistoryItem; projectId: string }>) => {
            const { historyItem, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                session.requestTmp = historyItem.requestRaw;
                session.history = [historyItem, ...session.history];
            }
        },
        selectedHisotryIndex: (state, action: PayloadAction<{ historyIndex: number; projectId: string }>) => {
            const { historyIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[bucket.selectedCollectionIndex];
            if (collection.selectedSessionIndex !== null) {
                const session = collection.sessions[collection.selectedSessionIndex];
                session.requestTmp = session.history[historyIndex].requestRaw;
                session.selectedHistoryIndex = historyIndex;
            }
        },
        addCollection: (state, action: PayloadAction<string>) => {
            const bucket = getBucket(state, action.payload);
            bucket.collections.push({
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
            });
        },
        selectColSess: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number; projectId: string }>) => {
            const { collectionIndex, sessionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            bucket.selectedCollectionIndex = collectionIndex;
            bucket.collections[collectionIndex].selectedSessionIndex = sessionIndex;
        },
        addSessionToCollection: (state, action: PayloadAction<{ collectionIndex: number; isItReplayerPage: boolean; projectId: string }>) => {
            const { collectionIndex, isItReplayerPage, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[collectionIndex];
            collection.sessions.push({
                history: [],
                requestTmp: 'GET / HTTP/1.1\r\n\r\n',
                url: 'https://',
                selectedHistoryIndex: null,
                urlIsValid: false,
            });
            bucket.receivedSession = !isItReplayerPage ? bucket.receivedSession + 1 : bucket.receivedSession;
        },
        resetReplayerReceivedSession: (state, action: PayloadAction<string>) => {
            getBucket(state, action.payload).receivedSession = 0;
        },
        removeCollection: (state, action: PayloadAction<{ collectionIndex: number; projectId: string }>) => {
            const { collectionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (collectionIndex >= 0 && collectionIndex < bucket.collections.length) {
                bucket.collections.splice(collectionIndex, 1);
                if (bucket.collections.length === 0) {
                    bucket.collections.push({ sessions: [], selectedSessionIndex: null });
                    bucket.selectedCollectionIndex = 0;
                } else if (bucket.selectedCollectionIndex >= bucket.collections.length) {
                    bucket.selectedCollectionIndex = bucket.collections.length - 1;
                }
            }
        },
        removeSession: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number; projectId: string }>) => {
            const { collectionIndex, sessionIndex, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            const collection = bucket.collections[collectionIndex];
            if (collection && sessionIndex >= 0 && sessionIndex < collection.sessions.length) {
                collection.sessions.splice(sessionIndex, 1);
                if (collection.selectedSessionIndex === sessionIndex) {
                    collection.selectedSessionIndex = collection.sessions.length > 0
                        ? Math.min(sessionIndex, collection.sessions.length - 1)
                        : null;
                } else if (collection.selectedSessionIndex !== null && collection.selectedSessionIndex > sessionIndex) {
                    collection.selectedSessionIndex -= 1;
                }
            }
        },
        renameCollection: (state, action: PayloadAction<{ collectionIndex: number; name: string; projectId: string }>) => {
            const { collectionIndex, name, projectId } = action.payload;
            const bucket = getBucket(state, projectId);
            if (bucket.collections[collectionIndex]) {
                bucket.collections[collectionIndex].name = name;
            }
        },
        renameSession: (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number; name: string; projectId: string }>) => {
            const { collectionIndex, sessionIndex, name, projectId } = action.payload;
            const collection = getBucket(state, projectId).collections[collectionIndex];
            if (collection?.sessions[sessionIndex]) {
                collection.sessions[sessionIndex].name = name;
            }
        },
    },
    extraReducers: (builder) => {
        builder.addCase(deleteProject, (state, action) => {
            delete state[action.payload];
        });
    },
});

export const {
    setReaplayerContent,
    setReaplayerURL,
    addReplayerHistory,
    selectedHisotryIndex,
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

export const selectReplayerState = (projectId: string | null) => (state: RootState): ReplayerState =>
    projectId ? (state.replayerstate[projectId] ?? defaultReplayerState()) : defaultReplayerState();

export default replayerSlice.reducer;