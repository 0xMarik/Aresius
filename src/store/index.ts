import { configureStore } from '@reduxjs/toolkit';
import ProjectsReducer from './slices/projectSlice';

const store = configureStore({
  reducer: {
    projects: ProjectsReducer
  },
});

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store;