import { buildSitemap, insertHttpHistoryEntry, removeNodeFromTree } from "@/pages/sitemap/utils";
import { HttpHistory } from "@/types/http.type";
import { TreeNode } from "@/types/sitemap.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { deleteProject } from "./projectSlice";
import type { AppDispatch, RootState } from "@/store";
import { invoke } from "@tauri-apps/api/core";

export interface SitemapProjectState {
  tree: TreeNode[];
  selectedNodeId: string | null;
  selectedRequestId: number | null;
  expandedIds: string[];
  searchTerm: string;
  scopeFilter: 'all' | 'in' | 'out';
  reqViewMode: 'raw' | 'pretty';
  resViewMode: 'raw' | 'pretty';
  isLoaded: boolean;
}

export type SitemapByProject = Record<string, SitemapProjectState>;

const defaultProjectState = (): SitemapProjectState => ({
  tree: [],
  selectedNodeId: null,
  selectedRequestId: null,
  expandedIds: [],
  searchTerm: '',
  scopeFilter: 'all',
  reqViewMode: 'raw',
  resViewMode: 'raw',
  isLoaded: false,
});

const initialState: SitemapByProject = {};

const SiteMapSlice = createSlice({
  name: 'sitemap',
  initialState,
  reducers: {
    updateSiteMap: (state, action: PayloadAction<{ historyItem: HttpHistory; projectId: string }>) => {
      const { historyItem, projectId } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      insertHttpHistoryEntry(state[projectId].tree, historyItem);
    },
    setSiteMapBulk: (state, action: PayloadAction<{ items: HttpHistory[]; projectId: string }>) => {
      const { items, projectId } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].tree = buildSitemap(items);
    },
    deleteSitemapNode: (state, action: PayloadAction<{ nodeId: string; projectId: string }>) => {
      const { nodeId, projectId } = action.payload;
      if (!state[projectId]) return;
      state[projectId].tree = removeNodeFromTree(state[projectId].tree, nodeId);
      if (state[projectId].selectedNodeId === nodeId) {
        state[projectId].selectedNodeId = null;
      }
    },
    setSitemapLoadedState: (
      state,
      action: PayloadAction<{ projectId: string; state: Partial<SitemapProjectState> }>
    ) => {
      const { projectId, state: loaded } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      Object.assign(state[projectId], loaded, { isLoaded: true });
    },
    setSitemapExpandedIds: (
      state,
      action: PayloadAction<{ projectId: string; expandedIds: string[] }>
    ) => {
      const { projectId, expandedIds } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].expandedIds = expandedIds;
    },
    setSitemapSelectedNode: (
      state,
      action: PayloadAction<{ projectId: string; selectedNodeId: string | null }>
    ) => {
      const { projectId, selectedNodeId } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].selectedNodeId = selectedNodeId;
    },
    setSitemapSelectedRequest: (
      state,
      action: PayloadAction<{ projectId: string; selectedRequestId: number | null }>
    ) => {
      const { projectId, selectedRequestId } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].selectedRequestId = selectedRequestId;
    },
    setSitemapSearchTerm: (
      state,
      action: PayloadAction<{ projectId: string; searchTerm: string }>
    ) => {
      const { projectId, searchTerm } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].searchTerm = searchTerm;
    },
    setSitemapScopeFilter: (
      state,
      action: PayloadAction<{ projectId: string; scopeFilter: 'all' | 'in' | 'out' }>
    ) => {
      const { projectId, scopeFilter } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].scopeFilter = scopeFilter;
    },
    setSitemapReqViewMode: (
      state,
      action: PayloadAction<{ projectId: string; mode: 'raw' | 'pretty' }>
    ) => {
      const { projectId, mode } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].reqViewMode = mode;
    },
    setSitemapResViewMode: (
      state,
      action: PayloadAction<{ projectId: string; mode: 'raw' | 'pretty' }>
    ) => {
      const { projectId, mode } = action.payload;
      if (!state[projectId]) state[projectId] = defaultProjectState();
      state[projectId].resViewMode = mode;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  },
});

export const {
  updateSiteMap,
  setSiteMapBulk,
  deleteSitemapNode,
  setSitemapLoadedState,
  setSitemapExpandedIds,
  setSitemapSelectedNode,
  setSitemapSelectedRequest,
  setSitemapSearchTerm,
  setSitemapScopeFilter,
  setSitemapReqViewMode,
  setSitemapResViewMode,
} = SiteMapSlice.actions;

const EMPTY_SITEMAP: TreeNode[] = [];
const DEFAULT_SITEMAP_STATE = defaultProjectState();

const sitemapTreeSelectorsCache = new Map<string | null, (state: RootState) => TreeNode[]>();
const sitemapStateSelectorsCache = new Map<string | null, (state: RootState) => SitemapProjectState>();

/** Selector: returns the sitemap tree for the given project */
export const selectSitemap = (projectId: string | null) => {
  if (!sitemapTreeSelectorsCache.has(projectId)) {
    sitemapTreeSelectorsCache.set(
      projectId,
      (state: RootState): TreeNode[] =>
        projectId && state.sitemap[projectId] ? state.sitemap[projectId].tree : EMPTY_SITEMAP
    );
  }
  return sitemapTreeSelectorsCache.get(projectId)!;
};

/** Selector: returns the full sitemap view state for the given project */
export const selectSitemapState = (projectId: string | null) => {
  if (!sitemapStateSelectorsCache.has(projectId)) {
    sitemapStateSelectorsCache.set(
      projectId,
      (state: RootState): SitemapProjectState =>
        projectId && state.sitemap[projectId] ? state.sitemap[projectId] : DEFAULT_SITEMAP_STATE
    );
  }
  return sitemapStateSelectorsCache.get(projectId)!;
};

/** Thunk: Loads sitemap view state from SQLite database */
export const fetchSitemapStateForProject = (projectId: string) => async (dispatch: AppDispatch) => {
  try {
    const data = await invoke<any>('get_sitemap_state_db', { projectId });
    if (data) {
      dispatch(
        setSitemapLoadedState({
          projectId,
          state: {
            selectedNodeId: data.selectedNodeId ?? null,
            selectedRequestId: data.selectedRequestId ?? null,
            expandedIds: Array.isArray(data.expandedIds) ? data.expandedIds : [],
            searchTerm: data.searchTerm ?? '',
            scopeFilter: (data.scopeFilter as 'all' | 'in' | 'out') ?? 'all',
            reqViewMode: (data.reqViewMode as 'raw' | 'pretty') ?? 'raw',
            resViewMode: (data.resViewMode as 'raw' | 'pretty') ?? 'raw',
            isLoaded: true,
          },
        })
      );
    } else {
      dispatch(
        setSitemapLoadedState({
          projectId,
          state: { isLoaded: true },
        })
      );
    }
  } catch (err) {
    console.warn('Failed to load sitemap state from DB:', err);
  }
};

/** Helper to persist current sitemap state to SQLite DB */
export const persistSitemapStateToDb = async (
  projectId: string,
  state: {
    selectedNodeId: string | null;
    selectedRequestId: number | null;
    expandedIds: string[];
    searchTerm?: string;
    scopeFilter?: string;
    reqViewMode?: string;
    resViewMode?: string;
  }
) => {
  try {
    await invoke('save_sitemap_state_db', {
      projectId,
      state: {
        selectedNodeId: state.selectedNodeId,
        selectedRequestId: state.selectedRequestId,
        expandedIds: state.expandedIds,
        searchTerm: state.searchTerm,
        scopeFilter: state.scopeFilter,
        reqViewMode: state.reqViewMode,
        resViewMode: state.resViewMode,
      },
    });
  } catch (err) {
    console.warn('Failed to save sitemap state to DB:', err);
  }
};

export default SiteMapSlice.reducer;
