import { HttpHistory } from '@/types/http.type';
import { createEntityAdapter, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject } from './projectSlice';

// Per-project bucket using entity adapter state shape
type ProjectHistoryState = ReturnType<typeof historyAdapter.getInitialState>
type HttpHistoryByProject = Record<string, ProjectHistoryState>

const historyAdapter = createEntityAdapter<HttpHistory>();

const initialState: HttpHistoryByProject = {}

const HttpHistorySlice = createSlice({
  name: 'http-history',
  initialState,
  reducers: {
    addToHttpHistory: (
      state,
      action: PayloadAction<{ historyItem: HttpHistory; projectId: string }>
    ) => {
      const { historyItem, projectId } = action.payload;
      if (!state[projectId]) {
        state[projectId] = historyAdapter.getInitialState();
      }
      historyAdapter.addOne(state[projectId], historyItem);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  },
});

export const { addToHttpHistory } = HttpHistorySlice.actions;

/** Returns entity adapter selectors scoped to a specific project */
export const getHistorySelectors = (projectId: string | null) => {
  const emptyState = historyAdapter.getInitialState();
  return {
    selectAll: (state: RootState): HttpHistory[] => {
      if (!projectId) return [];
      const bucket = state.httpHistory[projectId] ?? emptyState;
      return historyAdapter.getSelectors().selectAll(bucket);
    },
    selectById: (state: RootState, id: number | string): HttpHistory | undefined => {
      if (!projectId) return undefined;
      const bucket = state.httpHistory[projectId] ?? emptyState;
      const numId = typeof id === 'number' ? id : Number(id);
      return isNaN(numId) ? undefined : historyAdapter.getSelectors().selectById(bucket, numId);
    },
    selectEntities: (state: RootState) => {
      if (!projectId) return emptyState.entities;
      const bucket = state.httpHistory[projectId] ?? emptyState;
      return historyAdapter.getSelectors().selectEntities(bucket);
    },
  };
};

// Legacy selector kept for backward-compat — requires projectId
export const historySelectors = historyAdapter.getSelectors<RootState>(
  (state) => state.httpHistory['__legacy__'] ?? historyAdapter.getInitialState()
);

export default HttpHistorySlice.reducer;