import { Middleware } from '@reduxjs/toolkit';
import { setcurrentProjectId } from './slices/projectSlice';

/**
 * Middleware that intercepts project changes (setcurrentProjectId)
 * to perform transient state cleanup or side effects when switching projects.
 */
export const projectDataMiddleware: Middleware = (_store) => (next) => (action) => {
  if (setcurrentProjectId.match(action)) {
    // Currently setcurrentProjectId updates workspaceState.currentProjectId.
    // Slices maintain per-project buckets so no data is destroyed on project switch.
  }
  return next(action);
};
