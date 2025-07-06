import { FuzzerHistory, FuzzerSession, FuzzerState } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

const initialState: FuzzerState = {
  fuzzerSessions: [],
  activeSessionId: null
};


const fuzzerSlice = createSlice({
  name: 'fuzzer',
  initialState,
  reducers: {
    setSessions: (state, action : PayloadAction<{sessions: FuzzerSession[]}>) => {
      const {sessions} = action.payload
      state.fuzzerSessions = sessions;
    },
    addSession: (state, action : PayloadAction<{session: FuzzerSession}>) => {
      const {session} = action.payload;
      state.fuzzerSessions.push(session);
    },
    
    removeSession: (state, action: PayloadAction<{sessionId: string}>) => {
      const {sessionId} = action.payload;
      state.fuzzerSessions = state.fuzzerSessions.filter(s => s.sessionId !== sessionId);
    },

    setActiveSession: (state, action : PayloadAction<{sessionId: string}>) => {
      const {sessionId} = action.payload;
      state.activeSessionId = sessionId;
    },

    // Modify histories
    addFuzzingHistory: (state, action: PayloadAction<{sessionId: string, history: FuzzerHistory}>) => {
      const {sessionId, history} = action.payload;
      const session = state.fuzzerSessions.find(s => s.sessionId === sessionId);
      if (session) {
        session.fuzzingHistory.push(history);
      }
    },
  },
});

export const { 
  setActiveSession,
  removeSession,
  addSession,
  addFuzzingHistory,
  setSessions } = fuzzerSlice.actions;

export default fuzzerSlice.reducer;