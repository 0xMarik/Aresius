import { FuzzerSession } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';


type FuzzerState = {
  fuzzerSessions: FuzzerSession[];
  activeSessionId: string | null;
};

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
  },
});

export const { addSession,setSessions } = fuzzerSlice.actions;
export default fuzzerSlice.reducer;