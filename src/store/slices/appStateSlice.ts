import {
  AppState,
  defaultAppState,
  defaultFuzzerSettings,
  FuzzerSettings,
} from '@/types/settings.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { invoke } from '@tauri-apps/api/core';

export function applyFontScaleToDOM(scale: number) {
  if (typeof document !== 'undefined' && document.documentElement) {
    const clampedScale = Math.min(1.75, Math.max(0.75, scale));
    document.documentElement.style.setProperty('--font-scale', clampedScale.toFixed(2));
    document.documentElement.style.fontSize = `${(14 * clampedScale).toFixed(2)}px`;
  }
}

interface AppStateSliceState extends AppState {
  fuzzerSettings: FuzzerSettings;
}

const initialState: AppStateSliceState = {
  ...defaultAppState,
  fuzzerSettings: defaultFuzzerSettings,
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
    setFontSizeScale(state, action: PayloadAction<number>) {
      const scale = Math.min(1.75, Math.max(0.75, Number(action.payload.toFixed(2))));
      state.fontSizeScale = scale;
      applyFontScaleToDOM(scale);
    },
    increaseFontSize(state, action: PayloadAction<number | undefined>) {
      const step = action.payload ?? 0.05;
      const current = state.fontSizeScale ?? 1.0;
      const scale = Math.min(1.75, Math.max(0.75, Number((current + step).toFixed(2))));
      state.fontSizeScale = scale;
      applyFontScaleToDOM(scale);
    },
    decreaseFontSize(state, action: PayloadAction<number | undefined>) {
      const step = action.payload ?? 0.05;
      const current = state.fontSizeScale ?? 1.0;
      const scale = Math.min(1.75, Math.max(0.75, Number((current - step).toFixed(2))));
      state.fontSizeScale = scale;
      applyFontScaleToDOM(scale);
    },
    resetFontSize(state) {
      state.fontSizeScale = 1.0;
      applyFontScaleToDOM(1.0);
    },
    setFuzzerSettings(state, action: PayloadAction<FuzzerSettings>) {
      state.fuzzerSettings = action.payload;
    },
    /** Hydrate all fields at once (used on startup). */
    hydrateAppState(state, action: PayloadAction<AppState>) {
      const scale = action.payload.fontSizeScale ?? 1.0;
      applyFontScaleToDOM(scale);
      return {
        ...state,
        ...action.payload,
        fontSizeScale: scale,
      };
    },
  },
});

export const {
  setSidebarCollapsed,
  setActiveProjectId,
  setLastPage,
  setFontSizeScale,
  increaseFontSize,
  decreaseFontSize,
  resetFontSize,
  setFuzzerSettings,
  hydrateAppState,
} = appStateSlice.actions;

/** Persist the app-state (UI state) to the settings DB. */
export function persistAppState(state: AppState) {
  invoke('save_app_state', { state }).catch((err) =>
    console.warn('[appState] Failed to persist app state:', err),
  );
}

export default appStateSlice.reducer;
