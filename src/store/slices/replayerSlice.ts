import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { deleteProject } from "./projectSlice";

interface ReplayerMetaState {
    receivedSession: number;
}

const defaultReplayerMetaState = (): ReplayerMetaState => ({
    receivedSession: 0,
});

type ReplayerMetaByProject = Record<string, ReplayerMetaState>;

const initialState: ReplayerMetaByProject = {};

function getBucket(state: ReplayerMetaByProject, projectId: string): ReplayerMetaState {
    if (!state[projectId]) state[projectId] = defaultReplayerMetaState();
    return state[projectId];
}

const replayerSlice = createSlice({
    name: 'replayer',
    initialState,
    reducers: {
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
    incrementReplayerReceivedSession,
    resetReplayerReceivedSession,
} = replayerSlice.actions;

export const selectReplayerState = (projectId: string | null) => (state: RootState) => {
    if (!projectId || !state.replayerstate[projectId]) {
        return defaultReplayerMetaState();
    }
    return state.replayerstate[projectId];
};

export default replayerSlice.reducer;