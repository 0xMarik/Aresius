import { FuzzUpdate } from '@/App';
import { FuzzingHistory, FuzzerParameter, FuzzerSession, FuzzerState, HighlightRange, FuzzingAttackType, FuzzerRequest } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

const initialState : FuzzerState = {
    fuzzerSessions: [{
        fuzzingHistory: [],
        name: 'Default Session',
        selectedHistoryIndex: null,
        fuzzConfig: {
            numThreads: 1,
            delayMs: 0,
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
    addFuzzSession: (state, action : PayloadAction<{ name: string, rawRequest? : string}>) => {
      const {name, rawRequest} = action.payload;
      state.fuzzerSessions.push({
        name: name + ` ${state.fuzzerSessions.length + 1}`,
        fuzzingHistory: [],
        selectedHistoryIndex: null,
        fuzzConfig: { // default payload
          numThreads: 1,
          delayMs: 0,
          fuzzingAttackType: FuzzingAttackType.ROTATOR,
          rawRequest: rawRequest ||'GET / HTTP/1.1\nHost: facebook.com\n\n',
          metadata : {
            // protocol: "http",
            targetUrl: "http://google.com"
          },
          parameters: []
        },
        selectedHighlightId: null,
      });
    },
    

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
        state.activeSessionIndex = sessionIndex;
        state.fuzzerSessions[sessionIndex].selectedHistoryIndex = session.fuzzingHistory.length - 1; // selected the added history page
      }else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

  applyFuzzUpdates: (
    state,
    action: PayloadAction<{ updates: FuzzUpdate[] }>
  ) => {
    const { updates } = action.payload;

    // Cache requestById maps per (sessionIndex, historyIndex) so we don't
    // rebuild them for every update in the batch.
    const mapCache = new Map<string, Map<string, FuzzerRequest>>();

    const getRequestMap = (sessionIndex: number, historyIndex: number) => {
      const key = `${sessionIndex}:${historyIndex}`;
      let cached = mapCache.get(key);
      if (cached) return cached;

      const session = state.fuzzerSessions[sessionIndex];
      const history = session?.fuzzingHistory[historyIndex];
      if (!history) {
        console.error(`History entry not found at session ${sessionIndex}, index ${historyIndex}.`);
        return null;
      }

      cached = new Map(history.requests.map((r) => [r.fuzzRequestId, r]));
      mapCache.set(key, cached);
      return cached;
    };

    const getHistory = (sessionIndex: number, historyIndex: number) =>
      state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];

    for (const update of updates) {
      if ('Completed' in update) {
        const { id, selectedSession, fuzzHistory, reqRes } = update.Completed;
        const requestById = getRequestMap(selectedSession, fuzzHistory);
        if (!requestById) continue;
        const history = getHistory(selectedSession, fuzzHistory)!;

        const existing = requestById.get(id);
        if (existing) {
          existing.status = 'completed';
          existing.rawRequest = reqRes.request;
          existing.response = { rawResponse: reqRes.response, responseTime: reqRes.responseTime };
        } else {
          const row: FuzzerRequest = {
            fuzzRequestId: id,
            rawRequest: reqRes.request,
            response: { rawResponse: reqRes.response, responseTime: reqRes.responseTime },
            requestDate: new Date().toISOString(),
            status: 'completed',
          };
          history.requests.push(row);
          requestById.set(id, row);
        }
      } else if ('Error' in update) {
        const { id, selectedSession, fuzzHistory } = update.Error;
        const requestById = getRequestMap(selectedSession, fuzzHistory);
        if (!requestById) continue;
        const history = getHistory(selectedSession, fuzzHistory)!;

        const existing = requestById.get(id);
        if (existing) {
          existing.status = 'error';
        } else {
          const row: FuzzerRequest = {
            fuzzRequestId: id,
            rawRequest: '',
            response: null,
            requestDate: new Date().toISOString(),
            status: 'error',
          };
          history.requests.push(row);
          requestById.set(id, row);
        }
      }
    }
  },

    setContent: (state, action: PayloadAction<{ rawRequest: string }>) => {
  if (state.activeSessionIndex !== null) {
    state.fuzzerSessions[state.activeSessionIndex].fuzzConfig.rawRequest = action.payload.rawRequest;
  }
},


    addParameter: (state, action: PayloadAction<{highlightRange: HighlightRange}>) => {
      const {highlightRange} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.parameters.push({
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
        currentSession.fuzzConfig.parameters = parameters;
      } else {
        console.error("Their is no active session!!");
      }
    },
    removeParameter: (state, action: PayloadAction<{paramId: string}>) => {
      const {paramId} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.parameters = currentSession.fuzzConfig.parameters.filter(param => param.highlightRange.id !== paramId);
      } else {
        console.error("Their is no active session!!");
      }
    },

    setSelectedParameter: (state, action: PayloadAction<{parameterId: string | null}>) => {
      const {parameterId} = action.payload;
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex];
        const parameter = currentSession.fuzzConfig.parameters.find(param => param.highlightRange.id === parameterId);
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

setSelectedFuzz: (state, action: PayloadAction<{ sessionIndex: number | null, historyIndex: number | null }>) => {
    const { sessionIndex, historyIndex } = action.payload;

    if (sessionIndex === null && historyIndex !== null) {
        console.error("There is no active session to choose history from");
        return;
    }

    if (sessionIndex === null) {
        // valid case: clearing selection entirely
        state.activeSessionIndex = null;
        return;
    }

    const currentSession = state.fuzzerSessions[sessionIndex];
    if (!currentSession) {
        console.error(`No session found at index ${sessionIndex}`);
        return;
    }

    state.activeSessionIndex = sessionIndex;
    currentSession.selectedHistoryIndex = historyIndex;
},

    // Payload

    updatePayloadRawRequest : (state, action: PayloadAction<{content: string}>) => {
      const {content} = action.payload;
      if(state.activeSessionIndex !== null) {
        state.fuzzerSessions[state.activeSessionIndex].fuzzConfig.rawRequest = content;
      }else{
         console.error("Their is no active session!!");
      }
    },


    loadValuesParam: (state, action: PayloadAction<{paramIndex: number, values: string}>) => {
      const {paramIndex} = action.payload;
      const values = action.payload.values.split('\n')
      
      if(state.activeSessionIndex !== null && 
        state.fuzzerSessions[state.activeSessionIndex] &&
        state.fuzzerSessions[state.activeSessionIndex].fuzzConfig.parameters[paramIndex]
      ) {
        state.fuzzerSessions[state.activeSessionIndex].fuzzConfig.parameters[paramIndex].values = values
      }else {
        console.error("Slice Error: session not activated or their is no session in the index passed or their is not parameter in the paramIndexer passed!!");
      }

    },

    setNumThreads : (state, action: PayloadAction<{numThreads: number}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.numThreads = action.payload.numThreads;
      }else{
         console.error("Their is no active session!!");
      }
    },

      setDelayMs : (state, action: PayloadAction<{delayMs: number}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.delayMs = action.payload.delayMs;
      }else{
         console.error("Their is no active session!!");
      }
    },


    setTargerUrl :(state, action: PayloadAction<{targetUrl: string}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.metadata.targetUrl = action.payload.targetUrl;
      }else{
         console.error("Their is no active session!!");
      }
    },

    setFuzzingAttackType :(state, action: PayloadAction<{fuzzingAttackingType: FuzzingAttackType}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.fuzzingAttackType = action.payload.fuzzingAttackingType;
      }else{
         console.error("Their is no active session!!");
      }
    }

  },
});

export const { 
  setActiveSession,
  // removeSession,
  applyFuzzUpdates,
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
setDelayMs,
setTargerUrl,
setSelectedFuzz,
setFuzzingAttackType} = fuzzerSlice.actions;

export default fuzzerSlice.reducer;