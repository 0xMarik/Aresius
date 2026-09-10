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
  setShowSplashscreen,
  setStartupProjectMode,
  setStartupProjectSpecificId,
  setStartupProjectSettings,
} from './slices/appStateSlice';

/**
 * Middleware that intercepts project changes (setcurrentProjectId, deleteProject)
 * and app state updates (font size / zoom / splashscreen / startup settings) to perform side effects and persist to catalog DB.
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

    // Persist to DB (includes sidebar + lastPage + font size scale + splashscreen + startup settings)
    const s = store.getState() as any;
    persistAppState({
      sidebarCollapsed: s.appState.sidebarCollapsed,
      activeProjectId: projectId,
      lastPage: s.appState.lastPage,
      fontSizeScale: s.appState.fontSizeScale,
      showSplashscreen: s.appState.showSplashscreen ?? true,
      startupProjectMode: s.appState.startupProjectMode ?? 'last_used',
      startupProjectSpecificId: s.appState.startupProjectSpecificId ?? null,
    });
  } else if (deleteProject.match(action)) {
    const s = store.getState() as any;
    const deletedId = action.payload;
    const isCurrentDeleted = s.workspacestate.currentProjectId === null && s.appState.activeProjectId === deletedId;
    const isSpecificDeleted = s.appState.startupProjectSpecificId === deletedId;

    if (isCurrentDeleted) {
      (store.dispatch as any)(setActiveProjectId(null));
    }
    if (isSpecificDeleted) {
      (store.dispatch as any)(setStartupProjectSpecificId(null));
    }

    if (isCurrentDeleted || isSpecificDeleted) {
      const nextState = store.getState() as any;
      persistAppState({
        sidebarCollapsed: nextState.appState.sidebarCollapsed,
        activeProjectId: nextState.appState.activeProjectId,
        lastPage: nextState.appState.lastPage,
        fontSizeScale: nextState.appState.fontSizeScale,
        showSplashscreen: nextState.appState.showSplashscreen ?? true,
        startupProjectMode: nextState.appState.startupProjectMode ?? 'last_used',
        startupProjectSpecificId: nextState.appState.startupProjectSpecificId ?? null,
      });
    }
  } else if (
    setFontSizeScale.match(action) ||
    increaseFontSize.match(action) ||
    decreaseFontSize.match(action) ||
    resetFontSize.match(action) ||
    setShowSplashscreen.match(action) ||
    setStartupProjectMode.match(action) ||
    setStartupProjectSpecificId.match(action) ||
    setStartupProjectSettings.match(action)
  ) {
    const s = store.getState() as any;
    persistAppState({
      sidebarCollapsed: s.appState.sidebarCollapsed,
      activeProjectId: s.appState.activeProjectId,
      lastPage: s.appState.lastPage,
      fontSizeScale: s.appState.fontSizeScale,
      showSplashscreen: s.appState.showSplashscreen ?? true,
      startupProjectMode: s.appState.startupProjectMode ?? 'last_used',
      startupProjectSpecificId: s.appState.startupProjectSpecificId ?? null,
    });
  }
  return result;
};

