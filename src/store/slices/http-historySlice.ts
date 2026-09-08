import { HttpHistory } from '@/types/http.type';
import { createEntityAdapter, createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject } from './projectSlice';

import { invoke } from '@tauri-apps/api/core';

export interface HttpHistoryUiState {
  httpqlQuery: string;
  scopeFilter: 'all' | 'in' | 'out';
  selectedRequestId: number | null;
  applyInterceptionFilters: boolean;
  columnVisibility?: Record<string, boolean>;
}

// Per-project bucket using entity adapter state shape
type ProjectHistoryState = ReturnType<typeof historyAdapter.getInitialState> & {
  uiState?: HttpHistoryUiState;
};
type HttpHistoryByProject = Record<string, ProjectHistoryState>;

const historyAdapter = createEntityAdapter<HttpHistory>();

const initialState: HttpHistoryByProject = {};

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
      const prevUiState = state[projectId]?.uiState;
      state[projectId] = historyAdapter.setAll(
        historyAdapter.getInitialState(),
        items
      );
      if (prevUiState) {
        state[projectId].uiState = prevUiState;
      }
    },
    setHttpHistoryUiState: (
      state,
      action: PayloadAction<{ projectId: string; uiState: Partial<HttpHistoryUiState> }>
    ) => {
      const { projectId, uiState } = action.payload;
      if (!state[projectId]) {
        state[projectId] = {
          ...historyAdapter.getInitialState(),
          uiState: {
            httpqlQuery: '',
            scopeFilter: 'all',
            selectedRequestId: null,
            applyInterceptionFilters: true,
            columnVisibility: {},
            ...uiState,
          },
        };
      } else {
        state[projectId].uiState = {
          ...(state[projectId].uiState || {
            httpqlQuery: '',
            scopeFilter: 'all',
            selectedRequestId: null,
            applyInterceptionFilters: true,
            columnVisibility: {},
          }),
          ...uiState,
        };
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  },
});

export const { addToHttpHistory, setHistoryBulk, setHttpHistoryUiState } = HttpHistorySlice.actions;

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

export const selectHttpHistoryUiState = (projectId: string | null) => (state: RootState): HttpHistoryUiState | undefined => {
  if (!projectId || !state.httpHistory[projectId]) return undefined;
  return state.httpHistory[projectId].uiState;
};

export const fetchHttpHistoryUiState = (projectId: string) => async (dispatch: any) => {
  try {
    const data = await invoke<any>('get_http_history_state_db', { projectId });
    if (data && data.uiState) {
      const parsed: HttpHistoryUiState = JSON.parse(data.uiState);
      dispatch(setHttpHistoryUiState({ projectId, uiState: parsed }));
      return parsed;
    }
  } catch (err) {
    console.error('Failed to fetch http history ui state:', err);
  }
  return null;
};

let httpHistoryUiStateSaveTimers: Record<string, NodeJS.Timeout> = {};

export const persistHttpHistoryUiState = (projectId: string, uiState: HttpHistoryUiState) => async (dispatch: any) => {
  dispatch(setHttpHistoryUiState({ projectId, uiState }));
  if (httpHistoryUiStateSaveTimers[projectId]) {
    clearTimeout(httpHistoryUiStateSaveTimers[projectId]);
  }
  httpHistoryUiStateSaveTimers[projectId] = setTimeout(async () => {
    try {
      await invoke('save_http_history_state_db', {
        projectId,
        uiState: JSON.stringify(uiState),
      });
    } catch (err) {
      console.error('Failed to save http history ui state to DB:', err);
    }
  }, 400);
};

export default HttpHistorySlice.reducer;