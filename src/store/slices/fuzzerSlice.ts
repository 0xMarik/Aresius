import { FuzzProgressUpdate } from '@/App';
import { FuzzingHistory, FuzzerParameter, FuzzerSession, FuzzerState, HighlightRange, FuzzingAttackType, PipelineScope, PreprocessingRule, PayloadSource, NumbersPayloadConfig, NullPayloadConfig } from '@/types/fuzzer.type';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { deleteProject, setcurrentProjectId } from './projectSlice';
import { invoke } from '@tauri-apps/api/core';
import { validateUrl } from '@/components/ValidateUrlInput';

export const DEFAULT_FUZZER_RAW_REQUEST = 'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n';

export const defaultFuzzerState = (): FuzzerState => ({
  fuzzerSessions: [],
  activeSessionIndex: null,
  receivedSession: 0,
  expandedIds: [],
});

export type FuzzerByProject = Record<string, FuzzerState>;

const initialState: FuzzerByProject = {};

function getBucket(state: FuzzerByProject, projectId: string): FuzzerState {
  if (!state[projectId]) {
    state[projectId] = defaultFuzzerState();
  }
  return state[projectId];
}

export const fuzzerSlice = createSlice({
  name: 'fuzzer',
  initialState,
  reducers: {
    setSessions: (state, action: PayloadAction<{ sessions: FuzzerSession[]; projectId: string; expandedIds?: string[] }>) => {
      const { sessions, projectId, expandedIds } = action.payload;
      const bucket = getBucket(state, projectId);
      bucket.fuzzerSessions = sessions;
      if (expandedIds !== undefined) {
        bucket.expandedIds = expandedIds;
      }
    },
    setFuzzerExpandedIds: (state, action: PayloadAction<{ projectId: string; expandedIds: string[] }>) => {
      const { projectId, expandedIds } = action.payload;
      getBucket(state, projectId).expandedIds = expandedIds;
    },
    toggleFuzzerSessionExpand: (state, action: PayloadAction<{ projectId: string; sessionIndex: number }>) => {
      const { projectId, sessionIndex } = action.payload;
      const bucket = getBucket(state, projectId);
      const key = String(sessionIndex);
      if (bucket.expandedIds.includes(key)) {
        bucket.expandedIds = bucket.expandedIds.filter(id => id !== key);
      } else {
        bucket.expandedIds.push(key);
      }
    },
    addFuzzSession: (state, action: PayloadAction<{ name: string; rawRequest?: string; targetUrl: string; isItFuzzerPage: boolean; projectId: string }>) => {
      const { name, rawRequest, targetUrl, isItFuzzerPage, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const newIndex = bucket.fuzzerSessions.length;
      const rawUrl = targetUrl || 'https://';
      const url = rawUrl !== 'https://' && rawUrl.trim() && !rawUrl.includes('://') ? `https://${rawUrl}` : rawUrl;
      const urlIsValid = !validateUrl(url) && url !== 'https://' && url.trim() !== '';

      bucket.fuzzerSessions.push({
        name: name + ` ${newIndex + 1}`,
        fuzzingHistory: [],
        selectedHistoryIndex: null,
        fuzzConfig: {
          numThreads: 1,
          delayMs: 0,
          fuzzingAttackType: FuzzingAttackType.ROTATOR,
          rawRequest: rawRequest || DEFAULT_FUZZER_RAW_REQUEST,
          metadata: {
            targetUrl: url,
            urlIsValid,
          },
          parameters: [],
          pipelineScope: 'all',
          pipelineRules: [],
          setConnectionKeepAlive: true,
          updateContentLength: true,
        },
        selectedHighlightId: null,
      });
      bucket.activeSessionIndex = newIndex;
      if (!bucket.expandedIds.includes(String(newIndex))) {
        bucket.expandedIds.push(String(newIndex));
      }
      bucket.receivedSession = !isItFuzzerPage ? bucket.receivedSession + 1 : bucket.receivedSession;
    },
    resetFuzzReceivedSession: (state, action: PayloadAction<string>) => {
      getBucket(state, action.payload).receivedSession = 0;
    },

    setActiveSession: (state, action: PayloadAction<{ sessionIndex: number | null; projectId: string }>) => {
      const { sessionIndex, projectId } = action.payload;
      getBucket(state, projectId).activeSessionIndex = sessionIndex;
    },
    activeFuzzSession: (state, action: PayloadAction<{ sessionIndex: number | null; projectId: string }>) => {
      const { sessionIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (sessionIndex === null) {
        bucket.activeSessionIndex = null;
        return;
      }
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

    deleteFuzzSession: (state, action: PayloadAction<{ sessionIndex: number; projectId: string }>) => {
      const { sessionIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (sessionIndex < 0 || sessionIndex >= bucket.fuzzerSessions.length) return;

      const wasActive = bucket.activeSessionIndex === sessionIndex;
      bucket.fuzzerSessions.splice(sessionIndex, 1);

      if (bucket.fuzzerSessions.length === 0) {
        bucket.activeSessionIndex = null;
        bucket.expandedIds = [];
        return;
      }

      if (wasActive) {
        bucket.activeSessionIndex = null;
      } else if (bucket.activeSessionIndex !== null && bucket.activeSessionIndex > sessionIndex) {
        bucket.activeSessionIndex -= 1;
      }

      const newExpandedIds: string[] = [];
      for (const id of bucket.expandedIds) {
        const num = Number(id);
        if (num < sessionIndex) {
          newExpandedIds.push(id);
        } else if (num > sessionIndex) {
          newExpandedIds.push(String(num - 1));
        }
      }
      bucket.expandedIds = newExpandedIds;
    },

    deleteFuzzHistory: (state, action: PayloadAction<{ sessionIndex: number; historyIndex: number; projectId: string }>) => {
      const { sessionIndex, historyIndex, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const session = bucket.fuzzerSessions[sessionIndex];
      if (!session) return;
      if (historyIndex < 0 || historyIndex >= session.fuzzingHistory.length) return;

      const wasActiveHist = session.selectedHistoryIndex === historyIndex;
      session.fuzzingHistory.splice(historyIndex, 1);

      if (wasActiveHist) {
        session.selectedHistoryIndex = null;
      } else if (session.selectedHistoryIndex !== null && session.selectedHistoryIndex > historyIndex) {
        session.selectedHistoryIndex -= 1;
      }
    },

    renameFuzzSession: (state, action: PayloadAction<{ sessionIndex: number; name: string; projectId: string }>) => {
      const { sessionIndex, name, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const session = bucket.fuzzerSessions[sessionIndex];
      if (session) {
        session.name = name;
      }
    },

    updateFuzzProgress: (
      state,
      action: PayloadAction<FuzzProgressUpdate & { projectId: string }>
    ) => {
      const { selectedSession, fuzzHistory, completed, total, failed, status, connectionDropped, projectId } = action.payload;
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
        failed: failed !== undefined ? failed : (existingRunState.failed ?? 0),
        connectionDropped,
      };
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
          connectionDropped: false,
        };
      }
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

      history.requests = [];
      history.runState = {
        status: 'running',
        total: targets.length,
        completed: 0,
        failed: 0,
        connectionDropped: false,
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

    setFuzzerHistorySelectedRequest: (
      state,
      action: PayloadAction<{ sessionIndex: number; historyIndex: number; selectedRequestId: number | null; projectId: string }>
    ) => {
      const { sessionIndex, historyIndex, selectedRequestId, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      const history = bucket.fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
      if (history) {
        history.selectedRequestId = selectedRequestId;
      }
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

    setPayloadSource: (state, action: PayloadAction<{ paramIndex: number; payloadSource: PayloadSource; projectId: string }>) => {
      const { paramIndex, payloadSource, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null &&
        bucket.fuzzerSessions[bucket.activeSessionIndex] &&
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex]
      ) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex].payloadSource = payloadSource;
      }
    },

    setNumbersConfig: (state, action: PayloadAction<{ paramIndex: number; config: NumbersPayloadConfig; projectId: string }>) => {
      const { paramIndex, config, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null &&
        bucket.fuzzerSessions[bucket.activeSessionIndex] &&
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex]
      ) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex].numbersConfig = config;
      }
    },

    setNullPayloadConfig: (state, action: PayloadAction<{ paramIndex: number; config: NullPayloadConfig; projectId: string }>) => {
      const { paramIndex, config, projectId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null &&
        bucket.fuzzerSessions[bucket.activeSessionIndex] &&
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex]
      ) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.parameters[paramIndex].nullPayloadConfig = config;
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
    },

    setConnectionKeepAlive: (state, action: PayloadAction<{ keepAlive: boolean; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.setConnectionKeepAlive = action.payload.keepAlive;
      }
    },

    setUpdateContentLength: (state, action: PayloadAction<{ updateContentLength: boolean; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.updateContentLength = action.payload.updateContentLength;
      }
    },

    setPipelineScope: (state, action: PayloadAction<{ scope: PipelineScope; projectId: string }>) => {
      const bucket = getBucket(state, action.payload.projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        bucket.fuzzerSessions[bucket.activeSessionIndex].fuzzConfig.pipelineScope = action.payload.scope;
      }
    },

    setPipelineRules: (state, action: PayloadAction<{ rules: PreprocessingRule[]; projectId: string; paramId?: string }>) => {
      const { rules, projectId, paramId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const session = bucket.fuzzerSessions[bucket.activeSessionIndex];
        if (paramId) {
          const param = session.fuzzConfig.parameters.find(p => p.highlightRange.id === paramId);
          if (param) {
            param.pipelineRules = rules;
          }
        } else {
          session.fuzzConfig.pipelineRules = rules;
        }
      }
    },

    addPipelineRule: (state, action: PayloadAction<{ rule: PreprocessingRule; projectId: string; paramId?: string }>) => {
      const { rule, projectId, paramId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const session = bucket.fuzzerSessions[bucket.activeSessionIndex];
        if (paramId) {
          const param = session.fuzzConfig.parameters.find(p => p.highlightRange.id === paramId);
          if (param) {
            if (!param.pipelineRules) param.pipelineRules = [];
            param.pipelineRules.push(rule);
          }
        } else {
          if (!session.fuzzConfig.pipelineRules) session.fuzzConfig.pipelineRules = [];
          session.fuzzConfig.pipelineRules.push(rule);
        }
      }
    },

    updatePipelineRule: (state, action: PayloadAction<{ rule: PreprocessingRule; projectId: string; paramId?: string }>) => {
      const { rule, projectId, paramId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const session = bucket.fuzzerSessions[bucket.activeSessionIndex];
        const targetRules = paramId
          ? session.fuzzConfig.parameters.find(p => p.highlightRange.id === paramId)?.pipelineRules
          : session.fuzzConfig.pipelineRules;
        if (targetRules) {
          const idx = targetRules.findIndex(r => r.id === rule.id);
          if (idx !== -1) {
            targetRules[idx] = rule;
          }
        }
      }
    },

    removePipelineRule: (state, action: PayloadAction<{ ruleId: string; projectId: string; paramId?: string }>) => {
      const { ruleId, projectId, paramId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const session = bucket.fuzzerSessions[bucket.activeSessionIndex];
        if (paramId) {
          const param = session.fuzzConfig.parameters.find(p => p.highlightRange.id === paramId);
          if (param && param.pipelineRules) {
            param.pipelineRules = param.pipelineRules.filter(r => r.id !== ruleId);
          }
        } else {
          if (session.fuzzConfig.pipelineRules) {
            session.fuzzConfig.pipelineRules = session.fuzzConfig.pipelineRules.filter(r => r.id !== ruleId);
          }
        }
      }
    },

    reorderPipelineRules: (state, action: PayloadAction<{ fromIndex: number; toIndex: number; projectId: string; paramId?: string }>) => {
      const { fromIndex, toIndex, projectId, paramId } = action.payload;
      const bucket = getBucket(state, projectId);
      if (bucket.activeSessionIndex !== null && bucket.fuzzerSessions[bucket.activeSessionIndex]) {
        const session = bucket.fuzzerSessions[bucket.activeSessionIndex];
        const targetRules = paramId
          ? session.fuzzConfig.parameters.find(p => p.highlightRange.id === paramId)?.pipelineRules
          : session.fuzzConfig.pipelineRules;
        if (targetRules && fromIndex >= 0 && fromIndex < targetRules.length && toIndex >= 0 && toIndex < targetRules.length) {
          const [moved] = targetRules.splice(fromIndex, 1);
          targetRules.splice(toIndex, 0, moved);
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(deleteProject, (state, action) => {
        delete state[action.payload];
      })
      .addCase(setcurrentProjectId, (state, action) => {
        const activeProjectId = action.payload;
        if (activeProjectId) {
          if (!state[activeProjectId]) {
            state[activeProjectId] = defaultFuzzerState();
          }
          // Unmount inactive projects from memory
          Object.keys(state).forEach((pId) => {
            if (pId !== activeProjectId) {
              delete state[pId];
            }
          });
        }
      });
  },
});

export const {
  setActiveSession,
  updateFuzzProgress,
  markRequestPending,
  markFailedRequestsPending,
  setFuzzRunTargets,
  addFuzzSession,
  deleteFuzzSession,
  deleteFuzzHistory,
  renameFuzzSession,
  resetFuzzReceivedSession,
  addFuzzingHistory,
  activeFuzzSession,
  setSessions,
  setFuzzerExpandedIds,
  toggleFuzzerSessionExpand,
  updatePayloadRawRequest,
  addParameter,
  loadValuesParam,
  setPayloadSource,
  setNumbersConfig,
  setNullPayloadConfig,
  setSelectedParameter,
  setParameters,
  removeParameter,
  setContent,
  setNumThreads,
  setDelayMs,
  setTargerUrl,
  setSelectedFuzz,
  setFuzzerHistorySelectedRequest,
  setFuzzingAttackType,
  setConnectionKeepAlive,
  setUpdateContentLength,
  setPipelineScope,
  setPipelineRules,
  addPipelineRule,
  updatePipelineRule,
  removePipelineRule,
  reorderPipelineRules,
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

export interface FuzzerSessionTreeState {
  activeSessionIndex: number | null;
  activeHistoryIndex: number | null | undefined;
  expandedIds: string[];
  sessions: {
    id: number;
    name: string;
    histories: {
      id: number;
      date: string;
      isRunning: boolean;
    }[];
  }[];
}

const DEFAULT_SESSION_TREE: FuzzerSessionTreeState = {
  activeSessionIndex: null,
  activeHistoryIndex: null,
  expandedIds: [],
  sessions: [],
};

export const selectFuzzerSessionTree = (projectId: string | null) => (state: RootState): FuzzerSessionTreeState => {
  if (!projectId || !state.fuzzerstate || !state.fuzzerstate[projectId]) {
    return DEFAULT_SESSION_TREE;
  }
  const fstate = state.fuzzerstate[projectId];
  const activeSessionIndex = fstate.activeSessionIndex ?? null;
  const activeHistoryIndex =
    activeSessionIndex !== null && fstate.fuzzerSessions[activeSessionIndex]
      ? fstate.fuzzerSessions[activeSessionIndex].selectedHistoryIndex
      : null;

  return {
    activeSessionIndex,
    activeHistoryIndex,
    expandedIds: fstate.expandedIds || [],
    sessions: fstate.fuzzerSessions.map((s, sIdx) => ({
      id: sIdx,
      name: s.name,
      histories: s.fuzzingHistory.map((h, hIdx) => ({
        id: hIdx,
        date: h.date,
        isRunning: h.runState?.status === 'running',
      })),
    })),
  };
};

export const equalFuzzerSessionTree = (a: FuzzerSessionTreeState, b: FuzzerSessionTreeState): boolean => {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.activeSessionIndex !== b.activeSessionIndex) return false;
  if (a.activeHistoryIndex !== b.activeHistoryIndex) return false;
  if (a.expandedIds.length !== b.expandedIds.length) return false;
  for (let i = 0; i < a.expandedIds.length; i++) {
    if (a.expandedIds[i] !== b.expandedIds[i]) return false;
  }
  if (a.sessions.length !== b.sessions.length) return false;

  for (let i = 0; i < a.sessions.length; i++) {
    const sa = a.sessions[i];
    const sb = b.sessions[i];
    if (sa.id !== sb.id || sa.name !== sb.name) return false;
    if (sa.histories.length !== sb.histories.length) return false;
    for (let j = 0; j < sa.histories.length; j++) {
      const ha = sa.histories[j];
      const hb = sb.histories[j];
      if (ha.id !== hb.id || ha.date !== hb.date || ha.isRunning !== hb.isRunning) {
        return false;
      }
    }
  }
  return true;
};

export interface FuzzerUiState {
  activeSessionIndex: number | null;
  expandedIds: string[];
  sessionHistorySelections?: Record<number, number | null>;
  historyRowSelections?: Record<string, number | null>;
}

export const fetchFuzzerDataForProject = (projectId: string) => async (dispatch: any) => {
  try {
    const data = await invoke<any>('get_fuzzer_project_data', { projectId });
    if (data && data.sessions && data.sessions.length > 0) {
      let parsedUiState: FuzzerUiState | null = null;
      if (data.uiState) {
        try {
          parsedUiState = typeof data.uiState === 'string' ? JSON.parse(data.uiState) : data.uiState;
        } catch (e) {
          console.error('Failed to parse fuzzer ui_state:', e);
        }
      }

      const mappedSessions: FuzzerSession[] = data.sessions.map((fullSess: any, sIdx: number) => {
        const s = fullSess.session;
        let sessionPipelineRules: PreprocessingRule[] = [];
        try {
          if (s.pipelineRules) {
            sessionPipelineRules = typeof s.pipelineRules === 'string' ? JSON.parse(s.pipelineRules) : s.pipelineRules;
          }
        } catch {
          sessionPipelineRules = [];
        }

        const selectedHistIdx = parsedUiState?.sessionHistorySelections?.[sIdx] !== undefined
          ? parsedUiState.sessionHistorySelections[sIdx]
          : (fullSess.session.selectedHistoryIndex !== undefined && fullSess.session.selectedHistoryIndex !== null
            ? fullSess.session.selectedHistoryIndex
            : null);

        return {
          name: s.name,
          fuzzConfig: {
            numThreads: s.numThreads || 1,
            delayMs: s.delayMs || 0,
            fuzzingAttackType: (s.attackType as FuzzingAttackType) || FuzzingAttackType.ROTATOR,
            rawRequest: s.rawRequest || DEFAULT_FUZZER_RAW_REQUEST,
            pipelineScope: (s.pipelineScope as PipelineScope) || 'all',
            pipelineRules: sessionPipelineRules,
            setConnectionKeepAlive: s.setConnectionKeepAlive !== undefined && s.setConnectionKeepAlive !== null ? Boolean(s.setConnectionKeepAlive) : true,
            updateContentLength: s.updateContentLength !== undefined && s.updateContentLength !== null ? Boolean(s.updateContentLength) : true,
            parameters: (fullSess.parameters || []).map((p: any) => {
              let paramRules: PreprocessingRule[] = [];
              try {
                if (p.parameter.pipelineRules) {
                  paramRules = typeof p.parameter.pipelineRules === 'string' ? JSON.parse(p.parameter.pipelineRules) : p.parameter.pipelineRules;
                }
              } catch {
                paramRules = [];
              }
              return {
                payloadSource: p.parameter.payloadSource,
                values: p.values || [],
                pipelineRules: paramRules,
                highlightRange: {
                  id: p.parameter.rangeId,
                  from: p.parameter.rangeFrom,
                  to: p.parameter.rangeTo,
                  byteFrom: p.parameter.byteFrom,
                  byteTo: p.parameter.byteTo,
                  originalText: p.parameter.originalText,
                  isActive: Boolean(p.parameter.isActive),
                },
              };
            }),
            metadata: {
              targetUrl: s.targetUrl || '',
              urlIsValid: Boolean(s.targetUrl && s.targetUrl.trim() && s.targetUrl !== 'https://' && !validateUrl(s.targetUrl)),
            },
          },
          selectedHighlightId: null,
          selectedHistoryIndex: selectedHistIdx,
          fuzzingHistory: (fullSess.runs || []).map((rawRun: any, hIdx: number) => {
            const run = rawRun.run || rawRun;
            let configSnapshot: any = {};
            try {
              configSnapshot = JSON.parse(run.configSnapshot);
            } catch {
              configSnapshot = {};
            }
            const hasValidParameters = Array.isArray(configSnapshot?.parameters) && configSnapshot.parameters.length > 0;
            const hasValidRawRequest = typeof configSnapshot?.rawRequest === 'string' && configSnapshot.rawRequest.trim().length > 0;

            const fallbackParameters = (fullSess.parameters || []).map((p: any) => {
              let paramRules: PreprocessingRule[] = [];
              try {
                if (p.parameter.pipelineRules) {
                  paramRules = typeof p.parameter.pipelineRules === 'string' ? JSON.parse(p.parameter.pipelineRules) : p.parameter.pipelineRules;
                }
              } catch {
                paramRules = [];
              }
              return {
                payloadSource: p.parameter.payloadSource,
                values: p.values || [],
                pipelineRules: paramRules,
                highlightRange: {
                  id: p.parameter.rangeId,
                  from: p.parameter.rangeFrom,
                  to: p.parameter.rangeTo,
                  byteFrom: p.parameter.byteFrom,
                  byteTo: p.parameter.byteTo,
                  originalText: p.parameter.originalText,
                  isActive: Boolean(p.parameter.isActive),
                },
              };
            });

            const fullConfigSnapshot = {
              ...configSnapshot,
              numThreads: configSnapshot?.numThreads || s.numThreads || 1,
              delayMs: configSnapshot?.delayMs !== undefined ? configSnapshot.delayMs : (s.delayMs || 0),
              fuzzingAttackType: configSnapshot?.fuzzingAttackType || s.attackType || 'rotator',
              rawRequest: hasValidRawRequest ? configSnapshot.rawRequest : (s.rawRequest || DEFAULT_FUZZER_RAW_REQUEST),
              pipelineScope: configSnapshot?.pipelineScope || s.pipelineScope || 'all',
              pipelineRules: configSnapshot?.pipelineRules || sessionPipelineRules,
              setConnectionKeepAlive: configSnapshot?.setConnectionKeepAlive !== undefined ? Boolean(configSnapshot.setConnectionKeepAlive) : (s.setConnectionKeepAlive !== undefined && s.setConnectionKeepAlive !== null ? Boolean(s.setConnectionKeepAlive) : true),
              updateContentLength: configSnapshot?.updateContentLength !== undefined ? Boolean(configSnapshot.updateContentLength) : (s.updateContentLength !== undefined && s.updateContentLength !== null ? Boolean(s.updateContentLength) : true),
              parameters: hasValidParameters ? configSnapshot.parameters : fallbackParameters,
              metadata: {
                targetUrl: configSnapshot?.metadata?.targetUrl || s.targetUrl || '',
                urlIsValid: Boolean(
                  (configSnapshot?.metadata?.targetUrl || s.targetUrl) &&
                  (configSnapshot?.metadata?.targetUrl || s.targetUrl).trim() &&
                  (configSnapshot?.metadata?.targetUrl || s.targetUrl) !== 'https://' &&
                  !validateUrl(configSnapshot?.metadata?.targetUrl || s.targetUrl)
                ),
                ...(configSnapshot?.metadata || {}),
              },
            };

            const savedSelectedRow = parsedUiState?.historyRowSelections?.[`${sIdx}_${hIdx}`] ?? null;

            return {
              date: new Date(run.startedAt).toISOString(),
              fuzzConfigSnapshot: fullConfigSnapshot,
              requests: [],
              selectedRequestId: savedSelectedRow,
              runState: {
                status: run.status,
                completed: run.completed,
                total: run.total,
                failed: run.failed ?? 0,
                completedBase: run.completedBase ?? 0,
                connectionDropped: Boolean(run.connectionDropped),
              },
            };
          }),
        };
      });

      const expandedIds = parsedUiState?.expandedIds ?? data.expandedIds ?? [];
      dispatch(setSessions({ sessions: mappedSessions, projectId, expandedIds }));
      const selectedSessionIdx = (parsedUiState?.activeSessionIndex !== undefined && parsedUiState?.activeSessionIndex !== null)
        ? parsedUiState.activeSessionIndex
        : ((data.selectedSessionIndex !== undefined && data.selectedSessionIndex !== null)
          ? data.selectedSessionIndex
          : null);
      dispatch(setActiveSession({ sessionIndex: selectedSessionIdx, projectId }));

      if (selectedSessionIdx !== null) {
        const activeSess = mappedSessions[selectedSessionIdx];
        if (activeSess && activeSess.fuzzConfig.parameters.length > 0) {
          dispatch(setSelectedParameter({
            parameterId: activeSess.fuzzConfig.parameters[0].highlightRange.id,
            projectId,
          }));
        }
      }
    }
  } catch (err) {
    console.error('Failed to load fuzzer data on project selection:', err);
  }
};

let fuzzerUiStateSaveTimers: Record<string, NodeJS.Timeout> = {};

export const persistFuzzerUiState = (projectId: string) => async (_dispatch: any, getState: () => RootState) => {
  if (fuzzerUiStateSaveTimers[projectId]) {
    clearTimeout(fuzzerUiStateSaveTimers[projectId]);
  }

  fuzzerUiStateSaveTimers[projectId] = setTimeout(async () => {
    try {
      const state = getState();
      const bucket = state.fuzzerstate[projectId];
      if (!bucket) return;

      const sessionHistorySelections: Record<number, number | null> = {};
      const historyRowSelections: Record<string, number | null> = {};

      bucket.fuzzerSessions.forEach((sess, sIdx) => {
        if (sess.selectedHistoryIndex !== null && sess.selectedHistoryIndex !== undefined) {
          sessionHistorySelections[sIdx] = sess.selectedHistoryIndex;
        }
        sess.fuzzingHistory.forEach((hist, hIdx) => {
          if (hist.selectedRequestId !== null && hist.selectedRequestId !== undefined) {
            historyRowSelections[`${sIdx}_${hIdx}`] = hist.selectedRequestId;
          }
        });
      });

      const uiState: FuzzerUiState = {
        activeSessionIndex: bucket.activeSessionIndex,
        expandedIds: bucket.expandedIds || [],
        sessionHistorySelections,
        historyRowSelections,
      };

      await invoke('save_fuzzer_ui_state_db', {
        projectId,
        uiState: JSON.stringify(uiState),
      });
    } catch (err) {
      console.error('Failed to save fuzzer ui state to DB:', err);
    }
  }, 250);
};

export const persistFuzzerSession = (projectId: string, sessionIndex: number) => async (_dispatch: any, getState: () => RootState) => {
  try {
    const state = getState();
    const bucket = state.fuzzerstate[projectId];
    if (!bucket) return;
    const session = bucket.fuzzerSessions[sessionIndex];
    if (!session) return;

    await invoke('save_fuzzer_session_draft', {
      projectId,
      sessionIndex,
      name: session.name,
      rawRequest: session.fuzzConfig.rawRequest,
      targetUrl: session.fuzzConfig.metadata.targetUrl,
      attackType: session.fuzzConfig.fuzzingAttackType,
      numThreads: session.fuzzConfig.numThreads,
      delayMs: session.fuzzConfig.delayMs,
      pipelineScope: session.fuzzConfig.pipelineScope || 'all',
      pipelineRules: JSON.stringify(session.fuzzConfig.pipelineRules || []),
      setConnectionKeepAlive: session.fuzzConfig.setConnectionKeepAlive ?? true,
      updateContentLength: session.fuzzConfig.updateContentLength ?? true,
    });

    await invoke('save_fuzzer_parameters_db', {
      projectId,
      sessionIndex,
      parameters: session.fuzzConfig.parameters,
    });
  } catch (err) {
    console.error('Failed to persist fuzzer session to DB:', err);
  }
};

export default fuzzerSlice.reducer;