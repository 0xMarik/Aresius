import { createSlice, PayloadAction } from "@reduxjs/toolkit";

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

export interface InterceptSettings {
    requestsEnabled: boolean;
    responsesEnabled: boolean;
}

interface InterceptorState {
    queue: InterceptItem[];
    settings: InterceptSettings;
    selectedId: string | null;
    pollIntervalMs: number;
    isPolling: boolean;
}

const initialState: InterceptorState = {
    queue: [],
    settings: {
        requestsEnabled: false,
        responsesEnabled: false,
    },
    selectedId: null,
    pollIntervalMs: 500,
    isPolling: true,
};

const interceptorSlice = createSlice({
    name: 'interceptor',
    initialState,
    reducers: {
        setQueue: (state, action: PayloadAction<InterceptItem[]>) => {
            state.queue = action.payload;
            // Auto-select first item if current selection is invalid or null
            if (state.queue.length > 0) {
                if (!state.selectedId || !state.queue.some(i => i.id === state.selectedId)) {
                    state.selectedId = state.queue[0].id;
                }
            } else {
                state.selectedId = null;
            }
        },
        setSettings: (state, action: PayloadAction<InterceptSettings>) => {
            state.settings = action.payload;
        },
        toggleRequestsIntercept: (state) => {
            state.settings.requestsEnabled = !state.settings.requestsEnabled;
        },
        toggleResponsesIntercept: (state) => {
            state.settings.responsesEnabled = !state.settings.responsesEnabled;
        },
        setSelectedId: (state, action: PayloadAction<string | null>) => {
            state.selectedId = action.payload;
        },
        setPollIntervalMs: (state, action: PayloadAction<number>) => {
            state.pollIntervalMs = action.payload;
        },
        setIsPolling: (state, action: PayloadAction<boolean>) => {
            state.isPolling = action.payload;
        },
        removeQueueItem: (state, action: PayloadAction<string>) => {
            state.queue = state.queue.filter(item => item.id !== action.payload);
            if (state.selectedId === action.payload) {
                state.selectedId = state.queue.length > 0 ? state.queue[0].id : null;
            }
        },
        clearQueue: (state) => {
            state.queue = [];
            state.selectedId = null;
        }
    }
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

export default interceptorSlice.reducer;
