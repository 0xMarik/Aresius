import { FuzzerHistory, FuzzerSession, FuzzerState } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

const initialState: FuzzerState = {
  fuzzerSessions: [
    {
      name: 'Default Session',
      fuzzingHistory: [
        // {
        //   date: 0,
        //   requests: [
        //     {
        //       request: 'GET / HTTP/1.1\nHost: example.com\n\n',
        //       url: 'http://google.com',
        //       requestDate: new Date().toISOString(),
        //       response: {
        //         response: 'HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html>...</html>',
        //         responseTime: 120
        //       }
        //     }
        //   ]
        // },
      ]
    },
    {
      name: 'Second Session',
      fuzzingHistory: []
    }
  ],
  activeSessionIndex: 0
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
        name: name,
        fuzzingHistory: []
      });
    },
    
    // removeSession: (state, action: PayloadAction<{sessionId: string}>) => {
    //   const {sessionId} = action.payload;
    //   state.fuzzerSessions = state.fuzzerSessions.filter(s => s.sessionId !== sessionId);
    // },

    setActiveSession: (state, action : PayloadAction<{sessionIndex: number}>) => {
      const {sessionIndex} = action.payload;
      state.activeSessionIndex = sessionIndex;
    },
    activeFuzzSession: (state, action: PayloadAction<{sessionIndex: number}>) => {
      const {sessionIndex} = action.payload;
      const session = state.fuzzerSessions[sessionIndex]
      if (session) {
        state.activeSessionIndex = sessionIndex;
      } else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

    // Modify histories
    addFuzzingHistory: (state, action: PayloadAction<{sessionIndex: number, history: FuzzerHistory}>) => {
      const {sessionIndex, history} = action.payload;
      const session = state.fuzzerSessions[sessionIndex];
      if (session) {
        session.fuzzingHistory.push(history);
      }else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

  },
});

export const { 
  setActiveSession,
  // removeSession,
   addFuzzSession,
  addFuzzingHistory,
  activeFuzzSession,
  setSessions } = fuzzerSlice.actions;

export default fuzzerSlice.reducer;