import { FuzzUpdate, FuzzProgressUpdate, FuzzWorkerUpdate } from '@/App';
import { FuzzingHistory, FuzzerParameter, FuzzerSession, FuzzerState, HighlightRange, FuzzingAttackType, FuzzerRequest, assignWorkerIds, buildInitialWorkers, initialFuzzRunState } from '@/types/fuzzer.type';
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
            rawRequest: 'GET / HTTP/1.1\r\nHost: www.google.com\r\n\r\n',
            parameters: [],
            metadata: {
                targetUrl: 'https://google.com',
                urlIsValid: true,
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
    addFuzzSession: (state, action : PayloadAction<{ name: string, rawRequest? : string, targetUrl: string}>) => {
      const {name, rawRequest , targetUrl} = action.payload;
      state.fuzzerSessions.push({
        name: name + ` ${state.fuzzerSessions.length + 1}`,
        fuzzingHistory: [],
        selectedHistoryIndex: null,
        fuzzConfig: { // default payload
          numThreads: 1,
          delayMs: 0,
          fuzzingAttackType: FuzzingAttackType.ROTATOR,
          rawRequest: rawRequest ||'GET / HTTP/1.1\r\n\r\n',
          metadata : {
            targetUrl: `${targetUrl}` || "https://",
            urlIsValid: false,
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
          existing.errorMessage = undefined;
          existing.connectionDropped = false;
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
        const { id, selectedSession, fuzzHistory, message, connectionDropped, request } = update.Error;
        const requestById = getRequestMap(selectedSession, fuzzHistory);
        if (!requestById) continue;
        const history = getHistory(selectedSession, fuzzHistory)!;

        const existing = requestById.get(id);
        if (existing) {
          existing.status = 'error';
          existing.errorMessage = message;
          existing.connectionDropped = connectionDropped ?? false;
          if (request) existing.rawRequest = request;
        } else {
          const row: FuzzerRequest = {
            fuzzRequestId: id,
            rawRequest: request ?? '',
            response: null,
            requestDate: new Date().toISOString(),
            status: 'error',
            errorMessage: message,
            connectionDropped: connectionDropped ?? false,
          };
          history.requests.push(row);
          requestById.set(id, row);
        }
      }
    }
  },

  updateFuzzProgress: (
    state,
    action: PayloadAction<FuzzProgressUpdate>
  ) => {
    const { selectedSession, fuzzHistory, completed, total, status, connectionDropped } = action.payload;
    const history = state.fuzzerSessions[selectedSession]?.fuzzingHistory[fuzzHistory];
    if (!history) return;

    history.runState = {
      ...history.runState,
      status: status as FuzzingHistory['runState']['status'],
      total,
      completed,
      connectionDropped,
      workers: history.runState?.workers ?? [],
    };

    if (status === 'cancelled') {
      for (const req of history.requests) {
        if (req.status === 'pending') {
          req.status = 'cancelled';
        }
      }
    }
  },

  updateFuzzWorkerProgress: (
    state,
    action: PayloadAction<FuzzWorkerUpdate>
  ) => {
    const { selectedSession, fuzzHistory, workerId, status, completed, total, message } = action.payload;
    const history = state.fuzzerSessions[selectedSession]?.fuzzingHistory[fuzzHistory];
    if (!history) return;

    if (!history.runState) {
      history.runState = initialFuzzRunState();
    }

    let worker = history.runState.workers.find((w) => w.workerId === workerId);
    if (!worker) {
      worker = {
        workerId,
        status,
        completed,
        total,
        errorMessage: message,
      };
      history.runState.workers.push(worker);
    } else {
      worker.status = status;
      worker.completed = completed;
      worker.total = total;
      if (message) worker.errorMessage = message;
    }

    if (status === 'dropped') {
      history.runState.connectionDropped = true;
    }
  },

  markRequestPending: (
    state,
    action: PayloadAction<{ sessionIndex: number; historyIndex: number; requestId: string }>
  ) => {
    const { sessionIndex, historyIndex, requestId } = action.payload;
    const req = state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex]?.requests
      .find((r) => r.fuzzRequestId === requestId);
    if (req) {
      req.status = 'pending';
      req.errorMessage = undefined;
      req.connectionDropped = false;
      req.response = null;
      const history = state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (history) {
        history.runState = { ...history.runState, status: 'running', connectionDropped: false };
      }
    }
  },

  markWorkerRequestsPending: (
    state,
    action: PayloadAction<{ sessionIndex: number; historyIndex: number; workerId: number }>
  ) => {
    const { sessionIndex, historyIndex, workerId } = action.payload;
    const history = state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
    if (!history) return;

    for (const req of history.requests) {
      if (req.workerId === workerId && (req.status === 'error' || req.status === 'cancelled' || req.connectionDropped)) {
        req.status = 'pending';
        req.errorMessage = undefined;
        req.connectionDropped = false;
        req.response = null;
      }
    }

    const worker = history.runState.workers.find((w) => w.workerId === workerId);
    if (worker) {
      worker.status = 'running';
      worker.errorMessage = undefined;
    }

    history.runState.status = 'running';
    history.runState.connectionDropped = history.runState.workers.some((w) => w.status === 'dropped');
  },

  markFailedRequestsPending: (
    state,
    action: PayloadAction<{ sessionIndex: number; historyIndex: number }>
  ) => {
    const { sessionIndex, historyIndex } = action.payload;
    const history = state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
    if (!history) return;

    for (const req of history.requests) {
      if (req.status === 'error' || req.status === 'cancelled' || req.connectionDropped) {
        req.status = 'pending';
        req.errorMessage = undefined;
        req.connectionDropped = false;
        req.response = null;
      }
    }

    history.runState = {
      ...history.runState,
      status: 'running',
      connectionDropped: false,
    };
  },

  setFuzzRunTargets: (
    state,
    action: PayloadAction<{ sessionIndex: number; historyIndex: number; targets: { id: string; request: string }[] }>
  ) => {
    const { sessionIndex, historyIndex, targets } = action.payload;
    const history = state.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
    if (!history) return;

    const numThreads = history.fuzzConfigSnapshot.numThreads || 1;
    const targetsWithWorkers = assignWorkerIds(targets, numThreads);
    const initialWorkers = buildInitialWorkers(targetsWithWorkers);

    history.requests = targetsWithWorkers.map((target) => ({
      fuzzRequestId: target.id,
      rawRequest: target.request,
      response: null,
      requestDate: new Date().toISOString(),
      status: 'pending' as const,
      workerId: target.workerId,
    }));
    history.runState = {
      status: 'running',
      total: targets.length,
      completed: 0,
      connectionDropped: false,
      workers: initialWorkers,
    };
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


    setTargerUrl :(state, action: PayloadAction<{targetUrl: string, urlIsValid: boolean}>) => {
      if(state.activeSessionIndex !== null) {
        const currentSession = state.fuzzerSessions[state.activeSessionIndex]
        currentSession.fuzzConfig.metadata.targetUrl = action.payload.targetUrl;
        currentSession.fuzzConfig.metadata.urlIsValid = action.payload.urlIsValid;
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
  applyFuzzUpdates,
  updateFuzzProgress,
  updateFuzzWorkerProgress,
  markRequestPending,
  markWorkerRequestsPending,
  markFailedRequestsPending,
  setFuzzRunTargets,
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