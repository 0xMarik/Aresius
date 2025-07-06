import { FuzzerHistory, FuzzerSession, FuzzerState } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

const initialState: FuzzerState = {
  fuzzerSessions: [
    {
      sessionId: 'fuzz-session-1',
      name: 'Default Session',
      fuzzingHistory: [
        {
          id: 'history-1',
          date: 0,
          requests: []
        },
        {
          id: 'history-2',
          date: 0,
          requests: []
        },
      ]
    },
    {
      sessionId: 'fuzz-session-2',
      name: 'Second Session',
      fuzzingHistory: [

      ]
    }
  ],
  activeSessionId: 'fuzz-session-1'
};


const fuzzerSlice = createSlice({
  name: 'fuzzer',
  initialState,
  reducers: {
    setSessions: (state, action : PayloadAction<{sessions: FuzzerSession[]}>) => {
      const {sessions} = action.payload
      state.fuzzerSessions = sessions;
    },
    addFuzzSession: (state, action : PayloadAction<{ name: string}>) => {
      const {name} = action.payload;
      const tmp = state.fuzzerSessions.length
      state.fuzzerSessions.push({
        sessionId: `fuzz-session-${tmp + 1}`,
        name: name,
        fuzzingHistory: []
      });
    },
    
    removeSession: (state, action: PayloadAction<{sessionId: string}>) => {
      const {sessionId} = action.payload;
      state.fuzzerSessions = state.fuzzerSessions.filter(s => s.sessionId !== sessionId);
    },

    setActiveSession: (state, action : PayloadAction<{sessionId: string}>) => {
      const {sessionId} = action.payload;
      state.activeSessionId = sessionId;
    },
    activeFuzzSession: (state, action: PayloadAction<{sessionId: string}>) => {
      const {sessionId} = action.payload;
      const session = state.fuzzerSessions.find(s => s.sessionId === sessionId);
      if (session) {
        state.activeSessionId = session.sessionId;
      } else {
        console.warn(`Session with ID ${sessionId} not found.`);
      }
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
   addFuzzSession,
  addFuzzingHistory,
  activeFuzzSession,
  setSessions } = fuzzerSlice.actions;

export default fuzzerSlice.reducer;