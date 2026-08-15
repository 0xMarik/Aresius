import { Middleware } from '@reduxjs/toolkit';
import { setcurrentProjectId } from './slices/projectSlice';
import { fetchReplayerDataForProject } from './slices/replayerSlice';
import { fetchFuzzerDataForProject } from './slices/fuzzerSlice';

/**
 * Middleware that intercepts project changes (setcurrentProjectId)
 * to perform transient state cleanup or side effects when switching projects.
 * Immediately pre-loads Replayer and Fuzzer data for the selected project into Redux.
 */
export const projectDataMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  if (setcurrentProjectId.match(action)) {
    const projectId = action.payload;
    if (projectId) {
      (store.dispatch as any)(fetchReplayerDataForProject(projectId));
      (store.dispatch as any)(fetchFuzzerDataForProject(projectId));
    }
  }
  return result;
};
