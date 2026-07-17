import { HttpHistory } from "@/types/http.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit"



interface HttpHistoryState {
    history: HttpHistory[]
}

const initialState : HttpHistoryState = {
    history: []
}



const HttpHistorySlice = createSlice({
  name: 'http-history',
  initialState,
  reducers: {
    addToHttpHistory: (state, action: PayloadAction<{ historyItem: HttpHistory }>) =>
    {
        const {historyItem} = action.payload;
        state.history = [...state.history, historyItem];
    }
  }
});

export const {addToHttpHistory} = HttpHistorySlice.actions;

export default HttpHistorySlice.reducer;
