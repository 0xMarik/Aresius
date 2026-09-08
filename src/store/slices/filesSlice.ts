import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { invoke } from '@tauri-apps/api/core';
import { ProjectFileSummary } from '@/types/files.type';
import { RootState } from '../index';

export interface ProjectFilesState {
  files: ProjectFileSummary[];
  selectedFileId: string | null;
  previewLines: string[];
  isLoaded: boolean;
  loading: boolean;
  error: string | null;
}

type FilesByProject = Record<string, ProjectFilesState>;

const initialState: FilesByProject = {};

function defaultProjectFilesState(): ProjectFilesState {
  return {
    files: [],
    selectedFileId: null,
    previewLines: [],
    isLoaded: false,
    loading: false,
    error: null,
  };
}

function getBucket(state: FilesByProject, projectId: string): ProjectFilesState {
  if (!state[projectId]) {
    state[projectId] = defaultProjectFilesState();
  }
  return state[projectId];
}

// ---------------------------------------------------------------------------
// Async Thunks
// ---------------------------------------------------------------------------

export const fetchProjectFiles = createAsyncThunk(
  'files/fetchProjectFiles',
  async (projectId: string, { rejectWithValue }) => {
    try {
      const files = await invoke<ProjectFileSummary[]>('list_project_files_db', { projectId });
      return { projectId, files };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const importProjectFile = createAsyncThunk(
  'files/importProjectFile',
  async (
    payload: { projectId: string; name: string; content: string; path?: string },
    { rejectWithValue }
  ) => {
    try {
      const created = await invoke<ProjectFileSummary>('create_project_file_db', {
        projectId: payload.projectId,
        name: payload.name,
        path: payload.path || '',
        content: payload.content,
      });
      return { projectId: payload.projectId, file: created };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const deleteProjectFile = createAsyncThunk(
  'files/deleteProjectFile',
  async (payload: { fileId: string; projectId: string }, { rejectWithValue }) => {
    try {
      await invoke('delete_project_file_db', { fileId: payload.fileId });
      return payload;
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const renameProjectFile = createAsyncThunk(
  'files/renameProjectFile',
  async (payload: { fileId: string; newName: string; projectId: string }, { rejectWithValue }) => {
    try {
      await invoke('rename_project_file_db', { fileId: payload.fileId, newName: payload.newName });
      return payload;
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

export const loadProjectFilePreview = createAsyncThunk(
  'files/loadProjectFilePreview',
  async (payload: { fileId: string; projectId: string; limit?: number }, { rejectWithValue }) => {
    try {
      const lines = await invoke<string[]>('get_project_file_preview_db', {
        fileId: payload.fileId,
        limit: payload.limit || 500,
      });
      return { projectId: payload.projectId, fileId: payload.fileId, lines };
    } catch (err: any) {
      return rejectWithValue(err.toString());
    }
  }
);

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    setSelectedFileId: (state, action: PayloadAction<{ projectId: string; fileId: string | null }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      bucket.selectedFileId = action.payload.fileId;
      if (action.payload.fileId === null) {
        bucket.previewLines = [];
      }
    },
    clearFilePreview: (state, action: PayloadAction<{ projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      bucket.previewLines = [];
    },
  },
  extraReducers: (builder) => {
    // Fetch
    builder.addCase(fetchProjectFiles.pending, (state, action) => {
      const bucket = getBucket(state, action.meta.arg);
      bucket.loading = true;
      bucket.error = null;
    });
    builder.addCase(fetchProjectFiles.fulfilled, (state, action) => {
      const { projectId, files } = action.payload;
      const bucket = getBucket(state, projectId);
      bucket.loading = false;
      bucket.files = files;
      bucket.isLoaded = true;
      if (bucket.selectedFileId && !files.some((f) => f.id === bucket.selectedFileId)) {
        bucket.selectedFileId = files.length > 0 ? files[0].id : null;
      }
    });
    builder.addCase(fetchProjectFiles.rejected, (state, action) => {
      const bucket = getBucket(state, action.meta.arg);
      bucket.loading = false;
      bucket.error = action.payload as string;
    });

    // Import
    builder.addCase(importProjectFile.fulfilled, (state, action) => {
      const { projectId, file } = action.payload;
      const bucket = getBucket(state, projectId);
      // Insert at the beginning of the list
      bucket.files.unshift(file);
      bucket.selectedFileId = file.id;
    });

    // Delete
    builder.addCase(deleteProjectFile.fulfilled, (state, action) => {
      const { projectId, fileId } = action.payload;
      const bucket = getBucket(state, projectId);
      bucket.files = bucket.files.filter((f) => f.id !== fileId);
      if (bucket.selectedFileId === fileId) {
        bucket.selectedFileId = bucket.files.length > 0 ? bucket.files[0].id : null;
        bucket.previewLines = [];
      }
    });

    // Rename
    builder.addCase(renameProjectFile.fulfilled, (state, action) => {
      const { projectId, fileId, newName } = action.payload;
      const bucket = getBucket(state, projectId);
      const target = bucket.files.find((f) => f.id === fileId);
      if (target) {
        target.name = newName;
        target.updatedAt = Date.now();
      }
    });

    // Preview
    builder.addCase(loadProjectFilePreview.fulfilled, (state, action) => {
      const { projectId, fileId, lines } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.selectedFileId === fileId) {
        bucket.previewLines = lines;
      }
    });
  },
});

export const { setSelectedFileId, clearFilePreview } = filesSlice.actions;

// Selectors
export const selectProjectFilesState = (projectId?: string | null) => (state: RootState) =>
  projectId ? (state.files?.[projectId] ?? defaultProjectFilesState()) : defaultProjectFilesState();

export const selectAllProjectFiles = (projectId?: string | null) => (state: RootState) =>
  projectId ? (state.files?.[projectId]?.files ?? []) : [];

export const selectSelectedProjectFile = (projectId?: string | null) => (state: RootState) => {
  if (!projectId || !state.files?.[projectId]) return null;
  const bucket = state.files[projectId];
  return bucket.files.find((f) => f.id === bucket.selectedFileId) ?? null;
};

export const selectProjectFilePreview = (projectId?: string | null) => (state: RootState) =>
  projectId ? (state.files?.[projectId]?.previewLines ?? []) : [];

export default filesSlice.reducer;
