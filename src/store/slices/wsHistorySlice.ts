import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { invoke } from '@tauri-apps/api/core';
import { WsStream, WsMessage, WsStreamClosedEvent } from '@/types/ws.type';
import { RootState } from '../index';

export interface WsHistoryProjectState {
  streams: WsStream[];
  selectedStreamId: number | null;
  messages: Record<number, WsMessage[]>;
  selectedMessageId: number | null;
  isLoaded: boolean;
  loading: boolean;
  error: string | null;
}

type WsHistoryByProject = Record<string, WsHistoryProjectState>;

const initialState: WsHistoryByProject = {};

function defaultWsHistoryState(): WsHistoryProjectState {
  return {
    streams: [],
    selectedStreamId: null,
    messages: {},
    selectedMessageId: null,
    isLoaded: false,
    loading: false,
    error: null,
  };
}

function getBucket(state: WsHistoryByProject, projectId: string): WsHistoryProjectState {
  if (!state[projectId]) {
    state[projectId] = defaultWsHistoryState();
  }
  return state[projectId];
}

// ---------------------------------------------------------------------------
// Async Thunks
// ---------------------------------------------------------------------------

export const fetchWsStreams = createAsyncThunk(
  'wsHistory/fetchWsStreams',
  async (projectId: string, { rejectWithValue }) => {
    try {
      const streams = await invoke<WsStream[]>('get_ws_streams', { projectId });
      return { projectId, streams };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const fetchWsMessages = createAsyncThunk(
  'wsHistory/fetchWsMessages',
  async ({ projectId, streamId }: { projectId: string; streamId: number }, { rejectWithValue }) => {
    try {
      const messages = await invoke<WsMessage[]>('get_ws_messages', { streamId });
      return { projectId, streamId, messages };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const clearWsHistory = createAsyncThunk(
  'wsHistory/clearWsHistory',
  async (projectId: string, { rejectWithValue }) => {
    try {
      await invoke('clear_ws_history', { projectId });
      return { projectId };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const deleteWsMessage = createAsyncThunk(
  'wsHistory/deleteWsMessage',
  async (
    { projectId, streamId, messageId }: { projectId: string; streamId: number; messageId: number },
    { rejectWithValue }
  ) => {
    try {
      await invoke('delete_ws_message', { messageId });
      return { projectId, streamId, messageId };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const clearStreamMessages = createAsyncThunk(
  'wsHistory/clearStreamMessages',
  async (
    { projectId, streamId }: { projectId: string; streamId: number },
    { rejectWithValue }
  ) => {
    try {
      await invoke('clear_stream_messages', { streamId });
      return { projectId, streamId };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const wsHistorySlice = createSlice({
  name: 'wsHistory',
  initialState,
  reducers: {
    setSelectedStreamId: (
      state,
      action: PayloadAction<{ projectId: string; streamId: number | null }>
    ) => {
      const bucket = getBucket(state, action.payload.projectId);
      bucket.selectedStreamId = action.payload.streamId;
      bucket.selectedMessageId = null;
    },
    setSelectedMessageId: (
      state,
      action: PayloadAction<{ projectId: string; messageId: number | null }>
    ) => {
      const bucket = getBucket(state, action.payload.projectId);
      bucket.selectedMessageId = action.payload.messageId;
    },
    onWsStreamCreated: (
      state,
      action: PayloadAction<{ projectId: string; stream: WsStream }>
    ) => {
      const bucket = getBucket(state, action.payload.projectId);
      const exists = bucket.streams.some((s) => s.id === action.payload.stream.id);
      if (!exists) {
        bucket.streams.unshift(action.payload.stream);
      }
    },
    onWsStreamClosed: (
      state,
      action: PayloadAction<{ projectId: string; event: WsStreamClosedEvent }>
    ) => {
      const bucket = getBucket(state, action.payload.projectId);
      const stream = bucket.streams.find((s) => s.id === action.payload.event.streamId);
      if (stream) {
        stream.status = (action.payload.event.status as any) ?? 'closed';
        stream.closedAt = action.payload.event.closedAt;
      }
    },
    onWsMessageReceived: (
      state,
      action: PayloadAction<{ projectId: string; message: WsMessage }>
    ) => {
      const { projectId, message } = action.payload;
      const bucket = getBucket(state, projectId);
      const stream = bucket.streams.find((s) => s.id === message.streamId);
      if (stream) {
        stream.messageCount = (stream.messageCount || 0) + 1;
      }
      if (!bucket.messages[message.streamId]) {
        bucket.messages[message.streamId] = [];
      }
      const exists = bucket.messages[message.streamId].some((m) => m.id === message.id);
      if (!exists) {
        bucket.messages[message.streamId].push(message);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWsStreams.pending, (state, action) => {
        const bucket = getBucket(state, action.meta.arg);
        bucket.loading = true;
        bucket.error = null;
      })
      .addCase(fetchWsStreams.fulfilled, (state, action) => {
        const bucket = getBucket(state, action.payload.projectId);
        bucket.loading = false;
        bucket.isLoaded = true;
        bucket.streams = action.payload.streams;
      })
      .addCase(fetchWsStreams.rejected, (state, action) => {
        const bucket = getBucket(state, action.meta.arg);
        bucket.loading = false;
        bucket.isLoaded = true;
        bucket.error = action.payload as string;
      })
      .addCase(fetchWsMessages.fulfilled, (state, action) => {
        const bucket = getBucket(state, action.payload.projectId);
        bucket.messages[action.payload.streamId] = action.payload.messages;
      })
      .addCase(clearWsHistory.fulfilled, (state, action) => {
        const bucket = getBucket(state, action.payload.projectId);
        bucket.streams = [];
        bucket.messages = {};
        bucket.selectedStreamId = null;
        bucket.selectedMessageId = null;
      })
      .addCase(deleteWsMessage.fulfilled, (state, action) => {
        const { projectId, streamId, messageId } = action.payload;
        const bucket = getBucket(state, projectId);
        if (bucket.messages[streamId]) {
          bucket.messages[streamId] = bucket.messages[streamId].filter((m) => m.id !== messageId);
        }
        if (bucket.selectedMessageId === messageId) {
          bucket.selectedMessageId = null;
        }
        const stream = bucket.streams.find((s) => s.id === streamId);
        if (stream && stream.messageCount > 0) {
          stream.messageCount -= 1;
        }
      })
      .addCase(clearStreamMessages.fulfilled, (state, action) => {
        const { projectId, streamId } = action.payload;
        const bucket = getBucket(state, projectId);
        bucket.messages[streamId] = [];
        bucket.selectedMessageId = null;
        const stream = bucket.streams.find((s) => s.id === streamId);
        if (stream) {
          stream.messageCount = 0;
        }
      });
  },
});

export const {
  setSelectedStreamId,
  setSelectedMessageId,
  onWsStreamCreated,
  onWsStreamClosed,
  onWsMessageReceived,
} = wsHistorySlice.actions;

export const selectWsHistoryState = (projectId: string | null) => (state: RootState) =>
  projectId ? state.wsHistory[projectId] ?? defaultWsHistoryState() : defaultWsHistoryState();

export const selectWsStreams = (projectId: string | null) => (state: RootState) =>
  selectWsHistoryState(projectId)(state).streams;

export const selectSelectedStreamId = (projectId: string | null) => (state: RootState) =>
  selectWsHistoryState(projectId)(state).selectedStreamId;

export const selectSelectedStream = (projectId: string | null) => (state: RootState) => {
  const wsState = selectWsHistoryState(projectId)(state);
  return wsState.streams.find((s) => s.id === wsState.selectedStreamId) ?? null;
};

export const selectWsMessagesForStream =
  (projectId: string | null, streamId: number | null) => (state: RootState) => {
    if (!projectId || streamId === null) return [];
    return selectWsHistoryState(projectId)(state).messages[streamId] ?? [];
  };

export const selectSelectedMessageId = (projectId: string | null) => (state: RootState) =>
  selectWsHistoryState(projectId)(state).selectedMessageId;

export default wsHistorySlice.reducer;
