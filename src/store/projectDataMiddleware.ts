import { Middleware } from '@reduxjs/toolkit';
import { deleteProject, setcurrentProjectId } from './slices/projectSlice';
import { fetchReplayerDataForProject } from './slices/replayerSlice';
import { fetchFuzzerDataForProject } from './slices/fuzzerSlice';
import { fetchFiltersForProject } from './slices/filtersSlice';
import { persistAppState, setActiveProjectId } from './slices/appStateSlice';

/**
 * Middleware that intercepts project changes (setcurrentProjectId, deleteProject)
 * to perform transient state cleanup or side effects when switching or deleting projects.
 * Immediately pre-loads Replayer, Fuzzer, and Preset Filters data for the selected project into Redux.
 * Also persists the new activeProjectId to the catalog DB.
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

    // Persist to DB (includes sidebar + lastPage from current state)
    const s = store.getState() as any;
    persistAppState({
      sidebarCollapsed: s.appState.sidebarCollapsed,
      activeProjectId: projectId,
      lastPage: s.appState.lastPage,
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
      });
    }
  }
  return result;
};

