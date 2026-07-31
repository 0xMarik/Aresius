import { HttpHistory } from '@/types/http.type';
import { createEntityAdapter, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store'; // adjust path if your store file lives elsewhere

const historyAdapter = createEntityAdapter<HttpHistory>();
// No custom selectId needed -- default is entity.id, which matches HttpHistory.id

const HttpHistorySlice = createSlice({
  name: 'http-history',
  initialState: historyAdapter.getInitialState(),
  reducers: {
    addToHttpHistory: (state, action: PayloadAction<{ historyItem: HttpHistory }>) => {
      historyAdapter.addOne(state, action.payload.historyItem);
    },
  },
});

export const { addToHttpHistory } = HttpHistorySlice.actions;

export const historySelectors = historyAdapter.getSelectors<RootState>(
  (state) => state.httpHistory, // <-- confirm this key matches configureStore's reducer map
);

export default HttpHistorySlice.reducer;