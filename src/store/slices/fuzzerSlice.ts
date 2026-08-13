import { FuzzProgressUpdate, FuzzWorkerUpdate } from '@/App';
import { FuzzingHistory, FuzzerParameter, FuzzerSession, FuzzerState, HighlightRange, FuzzingAttackType, assignWorkerIds, buildInitialWorkers, initialFuzzRunState } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject } from './projectSlice';

export const defaultFuzzerState = (): FuzzerState => ({
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
  receivedSession: 0,
});

export type FuzzerByProject = Record<string, FuzzerState>;

const initialState: FuzzerByProject = {};

function getBucket(state: FuzzerByProject, projectId: string): FuzzerState {
  if (!state[projectId]) state[projectId] = defaultFuzzerState();
  return state[projectId];
}

const fuzzerSlice = createSlice({
  name: 'fuzzer',
  initialState,
  reducers: {
    setSessions: (state, action: PayloadAction<{ sessions: FuzzerSession[]; projectId: string }>) => {
      const { sessions, projectId } = action.payload;
      getBucket(state, projectId).fuzzerSessions = sessions;
    },
    addFuzzSession: (state, action: PayloadAction<{ name: string; rawRequest?: string; targetUrl: string; isItFuzzerPage: boolean; projectId: string }>) => {
      const { name, rawRequest, targetUrl, isItFuzzerPage, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      bucket.fuzzerSessions.push({
        name: name + ` ${bucket.fuzzerSessions.length + 1}`,
        fuzzingHistory: [],
        selectedHistoryIndex: null,
        fuzzConfig: {
          numThreads: 1,
          delayMs: 0,
          fuzzingAttackType: FuzzingAttackType.ROTATOR,
          rawRequest: rawRequest || 'GET / HTTP/1.1\r\n\r\n',
          metadata: {
            targetUrl: `${targetUrl}` || "https://",
            urlIsValid: false,
          },
          parameters: []
        },
        selectedHighlightId: null,
      });
      bucket.receivedSession = !isItFuzzerPage ? bucket.receivedSession + 1 : bucket.receivedSession;
    },
    resetFuzzReceivedSession: (state, action: PayloadAction<string>) => {
      getBucket(state, action.payload).receivedSession = 0;
    },

    setActiveSession: (state, action: PayloadAction<{ sessionIndex: number; projectId: string }>) => {
      const { sessionIndex, projectId } = action.payload;
      getBucket(state, projectId).activeSessionIndex = sessionIndex;
    },
    activeFuzzSession: (state, action: PayloadAction<{ sessionIndex: number; projectId: string }>) => {
      const { sessionIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const session = bucket.fuzzerSessions[sessionIndex];
      if (session) {
        bucket.activeSessionIndex = sessionIndex;
      } else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

    // Modify histories
    addFuzzingHistory: (state, action: PayloadAction<{ sessionIndex: number; history: FuzzingHistory; projectId: string }>) => {
      const { sessionIndex, history, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const session = bucket.fuzzerSessions[sessionIndex];
      if (session) {
        session.fuzzingHistory.push(history);
        bucket.activeSessionIndex = sessionIndex;
        bucket.fuzzerSessions[sessionIndex].selectedHistoryIndex = session.fuzzingHistory.length - 1;
      } else {
        console.warn(`Session with ID ${sessionIndex} not found.`);
      }
    },

    updateFuzzProgress: (
      state,
      action: PayloadAction<FuzzProgressUpdate & { projectId: string }>
    ) => {
      const { selectedSession, fuzzHistory, completed, total, status, connectionDropped, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[selectedSession]?.fuzzingHistory[fuzzHistory];
      if (!history) return;

      const existingRunState = history.runState || {} as any;
      const existingTotal = existingRunState.total ?? 0;
      const completedBase = existingRunState.completedBase ?? 0;

      const newTotal = Math.max(existingTotal, total);

      const newCompleted = total < existingTotal
        ? Math.min(completedBase + completed, newTotal)
        : completed;

      history.runState = {
        ...existingRunState,
        status: status as FuzzingHistory['runState']['status'],
        total: newTotal,
        completed: newCompleted,
        connectionDropped,
        workers: existingRunState.workers ?? [],
      };
    },

    updateFuzzWorkerProgress: (
      state,
      action: PayloadAction<FuzzWorkerUpdate & { projectId: string }>
    ) => {
      const { selectedSession, fuzzHistory, workerId, status, completed, total, message, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[selectedSession]?.fuzzingHistory[fuzzHistory];
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
      action: PayloadAction<{ sessionIndex: number; historyIndex: number; requestId: string; projectId: string }>
    ) => {
      const { sessionIndex, historyIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (history) {
        history.runState = {
          ...history.runState,
          status: 'running',
          connectionDropped: false,
          completedBase: history.runState.completed,
        };
      }
    },

    markWorkerRequestsPending: (
      state,
      action: PayloadAction<{ sessionIndex: number; historyIndex: number; workerId: number; projectId: string }>
    ) => {
      const { sessionIndex, historyIndex, workerId, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (!history) return;

      const worker = history.runState.workers.find((w) => w.workerId === workerId);
      if (worker) {
        worker.status = 'running';
        worker.errorMessage = undefined;
      }

      history.runState.status = 'running';
      history.runState.completedBase = history.runState.completed;
      history.runState.connectionDropped = history.runState.workers.some((w) => w.status === 'dropped');
    },

    markFailedRequestsPending: (
      state,
      action: PayloadAction<{ sessionIndex: number; historyIndex: number; projectId: string }>
    ) => {
      const { sessionIndex, historyIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (!history) return;

      history.runState = {
        ...history.runState,
        status: 'running',
        connectionDropped: false,
        completedBase: history.runState.completed,
      };
    },

    setFuzzRunTargets: (
      state,
      action: PayloadAction<{ sessionIndex: number; historyIndex: number; targets: { id: string; request: string }[]; projectId: string }>
    ) => {
      const { sessionIndex, historyIndex, targets, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (!history) return;

      const numThreads = history.fuzzConfigSnapshot.numThreads || 1;
      const targetsWithWorkers = assignWorkerIds(targets, numThreads);
      const initialWorkers = buildInitialWorkers(targetsWithWorkers);

      history.requests = [];
      history.runState = {
        status: 'running',
        total: targets.length,
        completed: 0,
        connectionDropped: false,
        workers: initialWorkers,
        completedBase: 0,
      };
    },

    setContent: (state, action: PayloadAction<{ rawRequest: string; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.rawRequest = action.payload.rawRequest;
      }
    },

    addParameter: (state, action: PayloadAction<{ highlightRange: HighlightRange; projectId: string }>) => {
      const { highlightRange, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const currentSession = bucket.fuzzerSessions[bucket.activeSessionIndex];
        currentSession.fuzzConfig.parameters.push({
          payloadSource: 'manual',
          values: [],
          highlightRange: { ...highlightRange },
        });
      } else {
        console.error("There is no active session!!");
      }
    },

    setParameters: (state, action: PayloadAction<{ parameters: FuzzerParameter[]; projectId: string }>) => {
      const { parameters, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const currentSession = bucket.fuzzerSessions[bucket.activeSessionIndex];
        currentSession.fuzzConfig.parameters = parameters;
      } else {
        console.error("There is no active session!!");
      }
    },

    removeParameter: (state, action: PayloadAction<{ paramId: string; projectId: string }>) => {
      const { paramId, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const currentSession = bucket.fuzzerSessions[bucket.activeSessionIndex];
        currentSession.fuzzConfig.parameters = currentSession.fuzzConfig.parameters.filter(param => param.highlightRange.id !== paramId);
      } else {
        console.error("There is no active session!!");
      }
    },

    setSelectedParameter: (state, action: PayloadAction<{ parameterId: string | null; projectId: string }>) => {
      const { parameterId, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const currentSession = bucket.fuzzerSessions[bucket.activeSessionIndex];
        const parameter = currentSession.fuzzConfig.parameters.find(param => param.highlightRange.id === parameterId);
        if (parameter) {
          currentSession.selectedHighlightId = parameter.highlightRange.id;
        } else if (parameterId === null) {
          currentSession.selectedHighlightId = null;
        } else {
          console.warn(`Parameter with ID ${parameterId} not found in the current session.`);
        }
      } else {
        console.error("There is no active session!!");
      }
    },

    setSelectedFuzz: (state, action: PayloadAction<{ sessionIndex: number | null; historyIndex: number | null; projectId: string }>) => {
      const { sessionIndex, historyIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);

      if (sessionIndex === null && historyIndex !== null) {
        console.error("There is no active session to choose history from");
        return;
      }

      if (sessionIndex === null) {
        bucket.activeSessionIndex = null;
        return;
      }

      const currentSession = bucket.fuzzerSessions[sessionIndex];
      if (!currentSession) {
        console.error(`No session found at index ${sessionIndex}`);
        return;
      }

      bucket.activeSessionIndex = sessionIndex;
      currentSession.selectedHistoryIndex = historyIndex;
    },

    updatePayloadRawRequest: (state, action: PayloadAction<{ content: string; projectId: string }>) => {
      const { content, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.rawRequest = content;
      } else {
        console.error("There is no active session!!");
      }
    },

    loadValuesParam: (state, action: PayloadAction<{ paramIndex: number; values: string; projectId: string }>) => {
      const { paramIndex, values: valuesStr, projectId } = action.payload;
      const values = valuesStr.split('\n');
      const bucket = getBucket(state, projectId);

      if (bucket.activeSessionIndex !== null &&
        bucket.fuzzerSessions[bucket.activeSessionIndex] &&
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex]
      ) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex].values = values;
      } else {
        console.error("Slice Error: session not activated or there is no session in the index passed or there is no parameter in the paramIndex passed!!");
      }
    },

    setNumThreads: (state, action: PayloadAction<{ numThreads: number; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.numThreads = action.payload.numThreads;
      } else {
        console.error("There is no active session!!");
      }
    },

    setDelayMs: (state, action: PayloadAction<{ delayMs: number; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.delayMs = action.payload.delayMs;
      } else {
        console.error("There is no active session!!");
      }
    },

    setTargerUrl: (state, action: PayloadAction<{ targetUrl: string; urlIsValid: boolean; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const currentSession = bucket.fuzzerSessions[bucket.activeSessionIndex];
        currentSession.fuzzConfig.metadata.targetUrl = action.payload.targetUrl;
        currentSession.fuzzConfig.metadata.urlIsValid = action.payload.urlIsValid;
      } else {
        console.error("There is no active session!!");
      }
    },

    setFuzzingAttackType: (state, action: PayloadAction<{ fuzzingAttackingType: FuzzingAttackType; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.fuzzingAttackType = action.payload.fuzzingAttackingType;
      } else {
        console.error("There is no active session!!");
      }
    }
  },
  extraReducers: (builder) => {
    builder.addCase(deleteProject, (state, action) => {
      delete state[action.payload];
    });
  },
});

export const {
  setActiveSession,
  updateFuzzProgress,
  updateFuzzWorkerProgress,
  markRequestPending,
  markWorkerRequestsPending,
  markFailedRequestsPending,
  setFuzzRunTargets,
  addFuzzSession,
  resetFuzzReceivedSession,
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
  setFuzzingAttackType,
} = fuzzerSlice.actions;

const DEFAULT_FUZZER_STATE = defaultFuzzerState();

const fuzzerStateSelectorsCache = new Map<string | null, (state: RootState) => FuzzerState>();

/** Selector: returns FuzzerState for given project (or default state if none) */
export const selectFuzzerState = (projectId: string | null) => {
  if (!fuzzerStateSelectorsCache.has(projectId)) {
    fuzzerStateSelectorsCache.set(
      projectId,
      (state: RootState): FuzzerState =>
        projectId && state.fuzzerstate[projectId] ? state.fuzzerstate[projectId] : DEFAULT_FUZZER_STATE
    );
  }
  return fuzzerStateSelectorsCache.get(projectId)!;
};

export default fuzzerSlice.reducer;