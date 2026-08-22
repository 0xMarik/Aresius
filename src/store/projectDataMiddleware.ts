import { Middleware } from '@reduxjs/toolkit';
import { deleteProject, setcurrentProjectId } from './slices/projectSlice';
import { fetchReplayerDataForProject } from './slices/replayerSlice';
import { fetchFuzzerDataForProject } from './slices/fuzzerSlice';
import { fetchFiltersForProject } from './slices/filtersSlice';
import {
  persistAppState,
  setActiveProjectId,
  setFontSizeScale,
  increaseFontSize,
  decreaseFontSize,
  resetFontSize,
} from './slices/appStateSlice';

/**
 * Middleware that intercepts project changes (setcurrentProjectId, deleteProject)
 * and app state updates (font size / zoom) to perform side effects and persist to catalog DB.
 */
export const projectDataMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  if (setcurrentProjectId.match(action)) {
    const projectId = action.payload;
    // Sync the appState slice so it always mirrors workspacestate.currentProjectId
    (store.dispatch as any)(setActiveProjectId(projectId));

    if (projectId) {
      (store.dispatch as any)(fetchReplayerDataForProject(projectId));
      (store.dispatch as any)(fetchFuzzerDataForProject(projectId));
      (store.dispatch as any)(fetchFiltersForProject(projectId));
    }

    // Persist to DB (includes sidebar + lastPage + font size scale)
    const s = store.getState() as any;
    persistAppState({
      sidebarCollapsed: s.appState.sidebarCollapsed,
      activeProjectId: projectId,
      lastPage: s.appState.lastPage,
      fontSizeScale: s.appState.fontSizeScale,
    });
  } else if (deleteProject.match(action)) {
    const s = store.getState() as any;
    // If the active project was deleted, workspacestate.currentProjectId became null
    if (s.workspacestate.currentProjectId === null && s.appState.activeProjectId === action.payload) {
      (store.dispatch as any)(setActiveProjectId(null));
      persistAppState({
        sidebarCollapsed: s.appState.sidebarCollapsed,
        activeProjectId: null,
        lastPage: s.appState.lastPage,
        fontSizeScale: s.appState.fontSizeScale,
      });
    }
  } else if (
    setFontSizeScale.match(action) ||
    increaseFontSize.match(action) ||
    decreaseFontSize.match(action) ||
    resetFontSize.match(action)
  ) {
    const s = store.getState() as any;
    persistAppState({
      sidebarCollapsed: s.appState.sidebarCollapsed,
      activeProjectId: s.appState.activeProjectId,
      lastPage: s.appState.lastPage,
      fontSizeScale: s.appState.fontSizeScale,
    });
  }
  return result;
};

