import { createSlice, createSelector, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { invoke } from '@tauri-apps/api/core';
import { deleteProject } from './projectSlice';

export interface PresetFilter {
    id: string;
    projectId: string;
    name: string;
    alias: string;
    expression: string;
    description: string;
    badge: string;
    applyInInterception: boolean;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
}

export interface ProjectFiltersState {
    filters: PresetFilter[];
    selectedFilterId: string | null;
    isLoaded: boolean;
    applyInterceptionInHistory: boolean;
}

type FiltersByProject = Record<string, ProjectFiltersState>;

const initialState: FiltersByProject = {};

const defaultProjectFiltersState = (projectId?: string): ProjectFiltersState => {
    let initialApply = true;
    if (projectId) {
        try {
            const saved = localStorage.getItem(`aresius_apply_filter_history_${projectId}`);
            if (saved !== null) {
                initialApply = saved === 'true';
            }
        } catch {}
    }
    return {
        filters: [],
        selectedFilterId: null,
        isLoaded: false,
        applyInterceptionInHistory: initialApply,
    };
};

function getBucket(state: FiltersByProject, projectId: string): ProjectFiltersState {
    if (!state[projectId]) {
        state[projectId] = defaultProjectFiltersState(projectId);
    }
    return state[projectId];
}

// ─── Async Thunks ─────────────────────────────────────────────────────────────

export const fetchFiltersForProject = createAsyncThunk<
    { projectId: string; filters: PresetFilter[] },
    string,
    { rejectValue: string }
>('filters/fetchForProject', async (projectId, { rejectWithValue }) => {
    try {
        const filters = await invoke<PresetFilter[]>('get_preset_filters_db', { projectId });
        return { projectId, filters: filters || [] };
    } catch (err: any) {
        console.error('Failed to fetch preset filters:', err);
        return rejectWithValue(typeof err === 'string' ? err : err.message || 'Failed to fetch filters');
    }
});

export const saveFilterToDb = createAsyncThunk<
    { projectId: string; filter: PresetFilter },
    { projectId: string; filter: PresetFilter },
    { rejectValue: string }
>('filters/saveToDb', async ({ projectId, filter }, { rejectWithValue }) => {
    try {
        const saved = await invoke<PresetFilter>('save_preset_filter_db', { filter });
        return { projectId, filter: saved };
    } catch (err: any) {
        console.error('Failed to save preset filter:', err);
        return rejectWithValue(typeof err === 'string' ? err : err.message || 'Failed to save filter');
    }
});

export const togglePresetInterception = createAsyncThunk<
    { projectId: string; id: string; applyInInterception: boolean },
    { projectId: string; id: string; applyInInterception: boolean },
    { rejectValue: string }
>('filters/toggleInterception', async ({ projectId, id, applyInInterception }, { rejectWithValue }) => {
    try {
        await invoke('toggle_preset_filter_interception_db', {
            projectId,
            id,
            applyInInterception,
        });
        return { projectId, id, applyInInterception };
    } catch (err: any) {
        console.error('Failed to toggle preset filter interception in DB:', err);
        return rejectWithValue(typeof err === 'string' ? err : err.message || 'Failed to toggle');
    }
});

export const deleteFilterFromDb = createAsyncThunk<
    { projectId: string; id: string },
    { projectId: string; id: string },
    { rejectValue: string }
>('filters/deleteFromDb', async ({ projectId, id }, { rejectWithValue }) => {
    try {
        await invoke('delete_preset_filter_db', { projectId, id });
        return { projectId, id };
    } catch (err: any) {
        console.error('Failed to delete preset filter:', err);
        return rejectWithValue(typeof err === 'string' ? err : err.message || 'Failed to delete filter');
    }
});

export const resetDefaultFiltersDb = createAsyncThunk<
    { projectId: string; filters: PresetFilter[] },
    string,
    { rejectValue: string }
>('filters/resetDefaults', async (projectId, { rejectWithValue }) => {
    try {
        const filters = await invoke<PresetFilter[]>('reset_default_preset_filters_db', { projectId });
        return { projectId, filters: filters || [] };
    } catch (err: any) {
        console.error('Failed to reset preset filters:', err);
        return rejectWithValue(typeof err === 'string' ? err : err.message || 'Failed to reset defaults');
    }
});

// ─── Slice ───────────────────────────────────────────────────────────────────

export const filtersSlice = createSlice({
    name: 'filters',
    initialState,
    reducers: {
        setSelectedFilterId: (
            state,
            action: PayloadAction<{ projectId: string; filterId: string | null }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.selectedFilterId = action.payload.filterId;
        },
        setApplyInterceptionInHistory: (
            state,
            action: PayloadAction<{ projectId: string; enabled: boolean }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            bucket.applyInterceptionInHistory = action.payload.enabled;
            try {
                localStorage.setItem(
                    `aresius_apply_filter_history_${action.payload.projectId}`,
                    String(action.payload.enabled)
                );
            } catch {}
        },
        toggleLocalInterception: (
            state,
            action: PayloadAction<{ projectId: string; id: string; applyInInterception: boolean }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const item = bucket.filters.find((f) => f.id === action.payload.id);
            if (item) {
                item.applyInInterception = action.payload.applyInInterception;
                item.updatedAt = Date.now();
            }
        },
        createLocalFilterDraft: (
            state,
            action: PayloadAction<{ projectId: string; filter: PresetFilter }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const exists = bucket.filters.some((f) => f.id === action.payload.filter.id);
            if (!exists) {
                bucket.filters.push(action.payload.filter);
            }
            bucket.selectedFilterId = action.payload.filter.id;
        },
        updateLocalFilter: (
            state,
            action: PayloadAction<{ projectId: string; filter: PresetFilter }>
        ) => {
            const bucket = getBucket(state, action.payload.projectId);
            const index = bucket.filters.findIndex((f) => f.id === action.payload.filter.id);
            if (index !== -1) {
                bucket.filters[index] = action.payload.filter;
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchFiltersForProject.fulfilled, (state, action) => {
                const bucket = getBucket(state, action.payload.projectId);
                bucket.filters = action.payload.filters;
                bucket.isLoaded = true;
                if (!bucket.selectedFilterId && action.payload.filters.length > 0) {
                    bucket.selectedFilterId = action.payload.filters[0].id;
                }
            })
            .addCase(saveFilterToDb.fulfilled, (state, action) => {
                const bucket = getBucket(state, action.payload.projectId);
                const saved = action.payload.filter;
                const index = bucket.filters.findIndex((f) => f.id === saved.id);
                if (index !== -1) {
                    bucket.filters[index] = saved;
                } else {
                    bucket.filters.push(saved);
                }
                bucket.selectedFilterId = saved.id;
            })
            .addCase(togglePresetInterception.fulfilled, (state, action) => {
                const bucket = getBucket(state, action.payload.projectId);
                const item = bucket.filters.find((f) => f.id === action.payload.id);
                if (item) {
                    item.applyInInterception = action.payload.applyInInterception;
                    item.updatedAt = Date.now();
                }
            })
            .addCase(deleteFilterFromDb.fulfilled, (state, action) => {
                const bucket = getBucket(state, action.payload.projectId);
                bucket.filters = bucket.filters.filter((f) => f.id !== action.payload.id);
                if (bucket.selectedFilterId === action.payload.id) {
                    bucket.selectedFilterId = bucket.filters[0]?.id || null;
                }
            })
            .addCase(resetDefaultFiltersDb.fulfilled, (state, action) => {
                const bucket = getBucket(state, action.payload.projectId);
                bucket.filters = action.payload.filters;
                bucket.selectedFilterId = action.payload.filters[0]?.id || null;
            })
            .addCase(deleteProject, (state, action) => {
                delete state[action.payload];
            });
    },
});

export const {
    setSelectedFilterId,
    setApplyInterceptionInHistory,
    createLocalFilterDraft,
    updateLocalFilter,
} = filtersSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectFiltersState = (projectId: string | null) => (state: RootState) =>
    projectId && state.filters[projectId]
        ? state.filters[projectId]
        : defaultProjectFiltersState();

export const selectAllFilters = (projectId: string | null) =>
    createSelector(selectFiltersState(projectId), (fState) => fState.filters);

export const selectSelectedFilterId = (projectId: string | null) =>
    createSelector(selectFiltersState(projectId), (fState) => fState.selectedFilterId);

export const selectSelectedFilter = (projectId: string | null) =>
    createSelector(selectFiltersState(projectId), (fState) =>
        fState.filters.find((f) => f.id === fState.selectedFilterId) || fState.filters[0] || null
    );

export const selectInterceptionFilters = (projectId: string | null) =>
    createSelector(selectFiltersState(projectId), (fState) =>
        fState.filters.filter((f) => f.applyInInterception)
    );

export const selectApplyInterceptionInHistory = (projectId: string | null) =>
    createSelector(selectFiltersState(projectId), (fState) => fState.applyInterceptionInHistory);

export default filtersSlice.reducer;
