import { insertHttpHistoryEntry } from "@/pages/sitemap/utils";
import { HttpHistory } from "@/types/http.type";
import { TreeNode } from "@/types/sitemap.type";
import { createSlice, PayloadAction} from "@reduxjs/toolkit"



// interface SiteMapState {
//     sitemap: 
// }

const initialState : TreeNode[] = []



const SiteMapSlice = createSlice({
  name: 'sitemap',
  initialState,
  reducers: {
    updateSiteMap: (state, action: PayloadAction<{ historyItem: HttpHistory }>) => {
        const {historyItem} = action.payload
        state = insertHttpHistoryEntry(state, historyItem)
    }
  }
});

export const {updateSiteMap} = SiteMapSlice.actions;

export default SiteMapSlice.reducer;
