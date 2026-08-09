import { HttpHistory } from '@/types/http.type';
import { createEntityAdapter, createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
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
    setHistoryBulk: (
      state,
      action: PayloadAction<{ items: HttpHistory[]; projectId: string }>
    ) => {
      const { items, projectId } = action.payload;
      state[projectId] = historyAdapter.setAll(
        historyAdapter.getInitialState(),
        items
      );
    },
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  },
});

export const { addToHttpHistory, setHistoryBulk } = HttpHistorySlice.actions;

const EMPTY_HISTORY: HttpHistory[] = [];
const emptyState = historyAdapter.getInitialState();

const historySelectorsCache = new Map<string | null, {
  selectAll: (state: RootState) => HttpHistory[];
  selectById: (state: RootState, id: number | string) => HttpHistory | undefined;
  selectEntities: (state: RootState) => Record<string | number, HttpHistory>;
}>();

/** Returns entity adapter selectors scoped to a specific project (memoized per projectId) */
export const getHistorySelectors = (projectId: string | null) => {
  if (!historySelectorsCache.has(projectId)) {
    const selectBucket = (state: RootState) => (projectId ? state.httpHistory[projectId] : undefined);
    const selectAll = createSelector(
      [selectBucket],
      (bucket) => (bucket ? historyAdapter.getSelectors().selectAll(bucket) : EMPTY_HISTORY)
    );
    const selectEntities = createSelector(
      [selectBucket],
      (bucket) => (bucket ? historyAdapter.getSelectors().selectEntities(bucket) : emptyState.entities)
    );
    const selectById = (state: RootState, id: number | string): HttpHistory | undefined => {
      if (!projectId || !state.httpHistory[projectId]) return undefined;
      const numId = typeof id === 'number' ? id : Number(id);
      return isNaN(numId) ? undefined : state.httpHistory[projectId].entities[numId];
    };

    historySelectorsCache.set(projectId, {
      selectAll,
      selectById,
      selectEntities,
    });
  }
  return historySelectorsCache.get(projectId)!;
};

// Legacy selector kept for backward-compat — requires projectId
export const historySelectors = historyAdapter.getSelectors<RootState>(
  (state) => state.httpHistory['__legacy__'] ?? historyAdapter.getInitialState()
);

export default HttpHistorySlice.reducer;