import { configureStore } from '@reduxjs/toolkit';
import ProjectsReducer from './slices/projectSlice';
import FuzzerReducer from './slices/fuzzerSlice';
// src/middleware/logger.ts
import { Middleware } from '@reduxjs/toolkit'

export const loggerMiddleware: Middleware = store => next => action => {
  console.log('[Logger] Dispatching:', action)
  const result = next(action)
  console.log('[Logger] Next state:', store.getState())
  return result
}

const store = configureStore({
  reducer: {
    workspacestate: ProjectsReducer,
    fuzzerstate: FuzzerReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(loggerMiddleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store;