import { ReplayerCollection } from "@/types/replayer.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface ReaplyerState {
    collections: ReplayerCollection[];
    selectedCollectionIndex: number;
}

const initialState : ReaplyerState  = {
    collections : [
        {
            sessions: [
                {
                    history: [],
                    requestTmp: 'GET / HTTP/1.1\nHost: example.com\n\n',
                    url: 'https://example.com'
                }
            ],
            selectedSessionIndex: 0,
        },
    ],
    selectedCollectionIndex: 0
}



const replayerSlice = createSlice({
  name: 'replayer',
  initialState,
  reducers: {
    setReaplayerContent: (state, action: PayloadAction<{ rawRequest: string }>) => {
        const { rawRequest } = action.payload;
        const collection = state.collections[state.selectedCollectionIndex];
        const session = collection.sessions[collection.selectedSessionIndex];
        session.requestTmp = rawRequest;
    }
}
})

export const {setReaplayerContent} = replayerSlice.actions;
export default replayerSlice.reducer;