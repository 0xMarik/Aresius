import { FuzzerHistory, FuzzerParameter, FuzzerSession, FuzzerState } from '@/types/fuzzer.type';
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
      ],
      payload: {
        rawRequest : `GET / HTTP/1.1
Host: google.com
User-Agent: Rust-TCP-Client/1.0
Accept: */*
custom
Connection: close

`,
        metadata : {
          // protocol: "http",
          targetUrl: "http://google.com"
        },
        parameters : [],
        
      }
    },
    {
      name: 'Second Session',
      fuzzingHistory: [],
      payload: {
        rawRequest : 'GET / HTTP/1.1\n\n',
        metadata : {
          // protocol: "http",
          targetUrl: "http://google.com"
        },
        parameters : [],
        
      }
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
      state.fuzzerSessions.push({
        name: name,
        fuzzingHistory: [],
        payload: { // default payload
          rawRequest: 'GET / HTTP/1.1\n\n',
          metadata : {
            // protocol: "http",
            targetUrl: "http://google.com"
          },
          parameters: []
        }
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

    // Payload

    updatePayloadRawRequest : (state, action: PayloadAction<{content: string}>) => {
      const {content} = action.payload;
      if(state.activeSessionIndex !== null) {
        state.fuzzerSessions[state.activeSessionIndex].payload.rawRequest = content;
      }else{
         console.error("Their is no active session!!");
      }
    },

    addParameter: (state, action: PayloadAction< FuzzerParameter >) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.parameters.push({...action.payload})
      }else{
         console.error("Their is no active session!!");
      }
    },
    loadValuesParam: (state, action: PayloadAction<{paramIndex: number, values: string}>) => {
      const {paramIndex} = action.payload;
      const values = action.payload.values.split('\n')
      
      if(state.activeSessionIndex !== null && 
        state.fuzzerSessions[state.activeSessionIndex] &&
        state.fuzzerSessions[state.activeSessionIndex].payload.parameters[paramIndex]
      ) {
        state.fuzzerSessions[state.activeSessionIndex].payload.parameters[paramIndex].values = values
      }else {
        console.error("Slice Error: session not activated or their is no session in the index passed or their is not parameter in the paramIndexer passed!!");
      }

    },
    setTargerUrl :(state, action: PayloadAction<{targetUrl: string}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.metadata.targetUrl = action.payload.targetUrl;
      }else{
         console.error("Their is no active session!!");
      }
    }

  },
});

export const { 
  setActiveSession,
  // removeSession,
   addFuzzSession,
  addFuzzingHistory,
  activeFuzzSession,
  setSessions,
updatePayloadRawRequest,
addParameter,
loadValuesParam,
setTargerUrl} = fuzzerSlice.actions;

export default fuzzerSlice.reducer;