import { configureStore } from '@reduxjs/toolkit';
import ProjectsReducer from './slices/projectSlice';
import FuzzerReducer from './slices/fuzzerSlice';
import ReplayerReducer from './slices/replayerSlice';
import HttpHistoryReducer from './slices/http-historySlice';
import { Middleware } from '@reduxjs/toolkit'
import interceptorReducer from './slices/interceptorSlice';
import SiteMapReducer from './slices/sitemapSlice'
import scopeReducer from './slices/scopeSlice'
import matchReplaceReducer from './slices/matchReplaceSlice'
import filtersReducer from './slices/filtersSlice'

import { projectDataMiddleware } from './projectDataMiddleware';

export const loggerMiddleware: Middleware = store => next => action => {
  // if((action as any).type !== "http-history/addToHttpHistory"){
    // }
      console.log('[Logger] Dispatching:', action)
  const result = next(action); // Call next for ALL actions
  console.log('[Logger] Next state:', store.getState())
  // if((action as any).type !== "http-history/addToHttpHistory"){
  // }
  return result;
}

const store = configureStore({
  reducer: {
    workspacestate: ProjectsReducer,
    fuzzerstate: FuzzerReducer,
    replayerstate: ReplayerReducer,
    httpHistory: HttpHistoryReducer,
    interceptor: interceptorReducer,
    sitemap: SiteMapReducer,
    scope: scopeReducer,
    matchReplace: matchReplaceReducer,
    filters: filtersReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false,
    }).concat(loggerMiddleware, projectDataMiddleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store;