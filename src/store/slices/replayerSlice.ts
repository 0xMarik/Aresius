import { ReplayerCollection, ReplayerHistoryItem } from "@/types/replayer.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface ReaplyerState {
    collections: ReplayerCollection[];
    selectedCollectionIndex: number;
    receivedSession: number;
}

const initialState : ReaplyerState  = {
    collections : [
        {
            sessions: [
            ],
            selectedSessionIndex: null,
        },
    ],
    selectedCollectionIndex: 0,
    receivedSession: 0,
}



const replayerSlice = createSlice({
  name: 'replayer',
  initialState,
  reducers: {
    setReaplayerContent: (state, action: PayloadAction<{ rawRequest: string }>) => {
        const { rawRequest } = action.payload;
        const collection = state.collections[state.selectedCollectionIndex];
        if(collection.selectedSessionIndex !== null){
            const session = collection.sessions[collection.selectedSessionIndex];
            session.requestTmp = rawRequest;
            return;
        }
        console.error("Their is no replayer session selected")
    },
    setReaplayerURL: (state, action: PayloadAction<{ url: string; urlIsValid: boolean }>) => {
        const { url, urlIsValid } = action.payload;
        const collection = state.collections[state.selectedCollectionIndex];
        if(collection.selectedSessionIndex !== null){
            const session = collection.sessions[collection.selectedSessionIndex];
            session.url = url;
            session.urlIsValid = urlIsValid;
            return;
        }
        console.error("Their is no replayer session selected")

    },
    addReplayerHistory: (state, action: PayloadAction<{ historyItem: ReplayerHistoryItem }>) => {
        const { historyItem } = action.payload;
        const collection = state.collections[state.selectedCollectionIndex];
        if(collection.selectedSessionIndex !== null){
            const session = collection.sessions[collection.selectedSessionIndex];
            session.requestTmp = historyItem.requestRaw;
            session.history = [historyItem, ...session.history];
            return;
        }
        console.error("Their is no replayer session selected")
    },
    selectedHisotryIndex: (state, action: PayloadAction<{ historyIndex: number }>) => {
        const { historyIndex } = action.payload;
        const collection = state.collections[state.selectedCollectionIndex];
        if(collection.selectedSessionIndex !== null){
            const session = collection.sessions[collection.selectedSessionIndex];
            session.requestTmp = session.history[historyIndex].requestRaw;
            session.selectedHistoryIndex = historyIndex;
            return;
        }
        console.error("Their is no replayer session selected")
    },
    addCollection : (state) => {
        state.collections.push({
            sessions: [
                {
                    history: [],
                    requestTmp: 'GET / HTTP/1.1\r\n\r\n',
                    url: 'https://',
                    selectedHistoryIndex: null,
                    urlIsValid: false,
                }
            ],
            selectedSessionIndex: 0,
        })
    },
    selectColSess : (state, action: PayloadAction<{ collectionIndex: number; sessionIndex: number }>) => {
        const { collectionIndex, sessionIndex } = action.payload;
        state.selectedCollectionIndex = collectionIndex;
        const collection = state.collections[collectionIndex];
        collection.selectedSessionIndex = sessionIndex;
    },
    addSessionToCollection: (state, action: PayloadAction<{ collectionIndex: number, isItReplayerPage : boolean }>) => {
        const { collectionIndex,isItReplayerPage } = action.payload;
        const collection = state.collections[collectionIndex];
        collection.sessions.push({
            history: [],
            requestTmp: 'GET / HTTP/1.1\r\n\r\n',
            url: 'https://',
            selectedHistoryIndex: null,
            urlIsValid: false,
        });
        state.receivedSession = !isItReplayerPage ? state.receivedSession + 1 : state.receivedSession;
    },
    resetReplayerReceivedSession: (state) => {
        state.receivedSession = 0;
    },

}})

export const {setReaplayerContent,setReaplayerURL,addReplayerHistory,selectedHisotryIndex,addCollection,selectColSess, addSessionToCollection, resetReplayerReceivedSession} = replayerSlice.actions;

export default replayerSlice.reducer;