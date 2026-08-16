import { buildSitemap, insertHttpHistoryEntry, removeNodeFromTree } from "@/pages/sitemap/utils";
import { HttpHistory } from "@/types/http.type";
import { TreeNode } from "@/types/sitemap.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit"
import { deleteProject } from "./projectSlice";
import type { RootState } from "@/store";

type SitemapByProject = Record<string, TreeNode[]>

const initialState: SitemapByProject = {}

const SiteMapSlice = createSlice({
  name: 'sitemap',
  initialState,
  reducers: {
    updateSiteMap: (state, action: PayloadAction<{ historyItem: HttpHistory; projectId: string }>) => {
      const { historyItem, projectId } = action.payload;
      if (!state[projectId]) state[projectId] = [];
      insertHttpHistoryEntry(state[projectId], historyItem);
    },
    setSiteMapBulk: (state, action: PayloadAction<{ items: HttpHistory[]; projectId: string }>) => {
      const { items, projectId } = action.payload;
      state[projectId] = buildSitemap(items);
    },
    deleteSitemapNode: (state, action: PayloadAction<{ nodeId: string; projectId: string }>) => {
      const { nodeId, projectId } = action.payload;
      if (!state[projectId]) return;
      state[projectId] = removeNodeFromTree(state[projectId], nodeId);
    }
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  }
});

export const { updateSiteMap, setSiteMapBulk, deleteSitemapNode } = SiteMapSlice.actions;

const EMPTY_SITEMAP: TreeNode[] = [];

const sitemapSelectorsCache = new Map<string | null, (state: RootState) => TreeNode[]>();

/** Selector: returns the sitemap tree for the given project (defaults to empty array) */
export const selectSitemap = (projectId: string | null) => {
  if (!sitemapSelectorsCache.has(projectId)) {
    sitemapSelectorsCache.set(
      projectId,
      (state: RootState): TreeNode[] =>
        projectId && state.sitemap[projectId] ? state.sitemap[projectId] : EMPTY_SITEMAP
    );
  }
  return sitemapSelectorsCache.get(projectId)!;
};

export default SiteMapSlice.reducer;
