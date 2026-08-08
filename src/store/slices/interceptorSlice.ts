import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { deleteProject } from "./projectSlice";

export type InterceptItemType = 'request' | 'response';

export interface InterceptItem {
    id: string;
    itemType: InterceptItemType;
    host: string;
    methodOrStatus: string;
    rawMessage: string;
    timestamp: number;
    isHttps: boolean;
}

export interface ActiveScopeRule {
    id: string;
    pattern: string;
}

export interface ActiveScopePayload {
    id: string;
    name: string;
    color: string;
    allow: ActiveScopeRule[];
    deny: ActiveScopeRule[];
}

export interface InterceptSettings {
    requestsEnabled: boolean;
    responsesEnabled: boolean;
    scopeFilterEnabled: boolean;
    activeScope: ActiveScopePayload | null;
}

interface InterceptorState {
    queue: InterceptItem[];
    settings: InterceptSettings;
    selectedId: string | null;
    pollIntervalMs: number;
    isPolling: boolean;
}

// ─── Per-project map ────────────────────────────────────────────────────────────

type InterceptorByProject = Record<string, InterceptorState>

const defaultInterceptorState = (): InterceptorState => ({
    queue: [],
    settings: {
        requestsEnabled: false,
        responsesEnabled: false,
        scopeFilterEnabled: false,
        activeScope: null,
    },
    selectedId: null,
    pollIntervalMs: 500,
    isPolling: true,
});

const initialState: InterceptorByProject = {};

function getBucket(state: InterceptorByProject, projectId: string): InterceptorState {
    if (!state[projectId]) state[projectId] = defaultInterceptorState();
    return state[projectId];
}

const interceptorSlice = createSlice({
    name: 'interceptor',
    initialState,
    reducers: {
        setQueue: (state, action: PayloadAction<{ items: InterceptItem[]; projectId: string }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.queue = action.payload.items;
            if (bucket.queue.length > 0) {
                if (!bucket.selectedId || !bucket.queue.some(i => i.id === bucket.selectedId)) {
                    bucket.selectedId = bucket.queue[0].id;
                }
            } else {
                bucket.selectedId = null;
            }
        },
        setSettings: (state, action: PayloadAction<{ settings: InterceptSettings; projectId: string }>) => {
            getBucket(state, action.payload.projectId).settings = action.payload.settings;
        },
        toggleRequestsIntercept: (state, action: PayloadAction<string>) => {
            const bucket = getBucket(state, action.payload);
            bucket.settings.requestsEnabled = !bucket.settings.requestsEnabled;
        },
        toggleResponsesIntercept: (state, action: PayloadAction<string>) => {
            const bucket = getBucket(state, action.payload);
            bucket.settings.responsesEnabled = !bucket.settings.responsesEnabled;
        },
        setSelectedId: (state, action: PayloadAction<{ id: string | null; projectId: string }>) => {
            getBucket(state, action.payload.projectId).selectedId = action.payload.id;
        },
        setPollIntervalMs: (state, action: PayloadAction<{ ms: number; projectId: string }>) => {
            getBucket(state, action.payload.projectId).pollIntervalMs = action.payload.ms;
        },
        setIsPolling: (state, action: PayloadAction<{ polling: boolean; projectId: string }>) => {
            getBucket(state, action.payload.projectId).isPolling = action.payload.polling;
        },
        removeQueueItem: (state, action: PayloadAction<{ id: string; projectId: string }>) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.queue = bucket.queue.filter(item => item.id !== action.payload.id);
            if (bucket.selectedId === action.payload.id) {
                bucket.selectedId = bucket.queue.length > 0 ? bucket.queue[0].id : null;
            }
        },
        clearQueue: (state, action: PayloadAction<string>) => {
            const bucket = getBucket(state, action.payload);
            bucket.queue = [];
            bucket.selectedId = null;
        },
    },
    extraReducers: (builder) => {
        builder.addCase(deleteProject, (state, action) => {
            delete state[action.payload];
        });
    },
});

export const {
    setQueue,
    setSettings,
    toggleRequestsIntercept,
    toggleResponsesIntercept,
    setSelectedId,
    setPollIntervalMs,
    setIsPolling,
    removeQueueItem,
    clearQueue,
} = interceptorSlice.actions;

// ─── Selectors ─────────────────────────────────────────────────────────────────

const DEFAULT_INTERCEPTOR_STATE = defaultInterceptorState();

const interceptorSelectorsCache = new Map<string | null, (state: RootState) => InterceptorState>();

export const selectInterceptor = (projectId: string | null) => {
    if (!interceptorSelectorsCache.has(projectId)) {
        interceptorSelectorsCache.set(
            projectId,
            (state: RootState): InterceptorState =>
                projectId && state.interceptor[projectId] ? state.interceptor[projectId] : DEFAULT_INTERCEPTOR_STATE
        );
    }
    return interceptorSelectorsCache.get(projectId)!;
};

export default interceptorSlice.reducer;
