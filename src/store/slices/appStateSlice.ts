import { AppState } from '@/types/project.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { invoke } from '@tauri-apps/api/core';

const initialState: AppState = {
  sidebarCollapsed: false,
  activeProjectId: null,
  lastPage: '/projects',
};

const appStateSlice = createSlice({
  name: 'appState',
  initialState,
  reducers: {
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
    },
    setActiveProjectId(state, action: PayloadAction<string | null>) {
      state.activeProjectId = action.payload;
    },
    setLastPage(state, action: PayloadAction<string>) {
      state.lastPage = action.payload;
    },
    /** Hydrate all fields at once (used on startup). */
    hydrateAppState(_state, action: PayloadAction<AppState>) {
      return action.payload;
    },
  },
});

export const {
  setSidebarCollapsed,
  setActiveProjectId,
  setLastPage,
  hydrateAppState,
} = appStateSlice.actions;

/** Persist the full app-state to the catalog DB. */
export function persistAppState(state: AppState) {
  invoke('save_app_state', { state }).catch((err) =>
    console.warn('[appState] Failed to persist app state:', err),
  );
}

export default appStateSlice.reducer;
