import { FuzzingHistory, FuzzerParameter, FuzzerSession, FuzzerState, HighlightRange, FuzzingAttackType } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

const initialState : FuzzerState = {
    fuzzerSessions: [{
        fuzzingHistory: [],
        name: 'Default Session',
        payload: {
            numThreads: 1,
            delaisTime: 0,
            fuzzingAttackType: FuzzingAttackType.ROTATOR,
            rawRequest: 'GET / HTTP/1.1\nHost: www.google.com\n\n',
            parameters: [],
            metadata: {
                targetUrl: 'http://google.com:80'
            }
        },
        selectedHighlightId: null,
    }],
    activeSessionIndex: 0,
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
        name: name + ` ${state.fuzzerSessions.length + 1}`,
        fuzzingHistory: [],
        payload: { // default payload
          numThreads: 1,
          delaisTime: 0,
          fuzzingAttackType: FuzzingAttackType.ROTATOR,
          rawRequest: 'GET / HTTP/1.1\nHost: facebook.com\n\n',
          metadata : {
            // protocol: "http",
            targetUrl: "http://google.com"
          },
          parameters: []
        },
        selectedHighlightId: null,
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
    addFuzzingHistory: (state, action: PayloadAction<{sessionIndex: number, history: FuzzingHistory}>) => {
      const {sessionIndex, history} = action.payload;
      const session = state.fuzzerSessions[sessionIndex];
      if (session) {
        session.fuzzingHistory.push(history);
      }else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

    setContent: (state, action: PayloadAction<{ rawRequest: string }>) => {
  if (state.activeSessionIndex !== null) {
    state.fuzzerSessions[state.activeSessionIndex].payload.rawRequest = action.payload.rawRequest;
  }
},


    addParameter: (state, action: PayloadAction<{highlightRange: HighlightRange}>) => {
      const {highlightRange} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.parameters.push({
          payloadSource: 'manual',
          values: [],
          highlightRange: {...highlightRange},
        })
      }else{
         console.error("Their is no active session!!");
      }
    },

    setParameters: (state, action: PayloadAction<{parameters: FuzzerParameter[]}>) => {
      const {parameters} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.parameters = parameters;
      } else {
        console.error("Their is no active session!!");
      }
    },
    removeParameter: (state, action: PayloadAction<{paramId: string}>) => {
      const {paramId} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.parameters = currentSession.payload.parameters.filter(param => param.highlightRange.id !== paramId);
      } else {
        console.error("Their is no active session!!");
      }
    },

    setSelectedParameter: (state, action: PayloadAction<{parameterId: string | null}>) => {
      const {parameterId} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex];
        const parameter = currentSession.payload.parameters.find(param => param.highlightRange.id === parameterId);
        if (parameter) {
          currentSession.selectedHighlightId = parameter.highlightRange.id;
        } 
        else if (parameterId === null) {
          currentSession.selectedHighlightId = null; // Deselect if null
        }
        else {
          console.warn(`Parameter with ID ${parameterId} not found in the current session.`);
        }
      }else{
         console.error("Their is no active session!!");
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

    setNumThreads : (state, action: PayloadAction<{numThreads: number}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.numThreads = action.payload.numThreads;
      }else{
         console.error("Their is no active session!!");
      }
    },

      setDelaisTime : (state, action: PayloadAction<{delaisTime: number}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.delaisTime = action.payload.delaisTime;
      }else{
         console.error("Their is no active session!!");
      }
    },


    setTargerUrl :(state, action: PayloadAction<{targetUrl: string}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.metadata.targetUrl = action.payload.targetUrl;
      }else{
         console.error("Their is no active session!!");
      }
    },

    setFuzzingAttackType :(state, action: PayloadAction<{fuzzingAttackingType: FuzzingAttackType}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.payload.fuzzingAttackType = action.payload.fuzzingAttackingType;
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
setSelectedParameter,
setParameters,
removeParameter,
setContent,
setNumThreads,
setDelaisTime,
setTargerUrl,
setFuzzingAttackType} = fuzzerSlice.actions;

export default fuzzerSlice.reducer;