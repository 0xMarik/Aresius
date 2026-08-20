import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import type { RootState } from '@/store';
import RequestEditor from './request-editor/RequestEditor';
import FuzzConfig from './FuzzConfig';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import { addFuzzingHistory, setFuzzingAttackType, setFuzzRunTargets, setTargerUrl, selectFuzzerState, defaultFuzzerState, persistFuzzerSession } from '@/store/slices/fuzzerSlice';
import { FuzzingAttackType, initialFuzzRunState } from '@/types/fuzzer.type';
import { generateNumberPayloads, generateNullPayloads } from '@/lib/fuzzerPreprocessing';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'react-redux';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Play, Loader2 } from 'lucide-react';
import { ValidateUrlInput, stripPath } from '../ValidateUrlInput';
import { toast } from 'sonner';

type ActiveSessionShape = {
  targetUrl: string
  urlIsValid: boolean
  fuzzingAttackType: FuzzingAttackType
  selectedHistoryIndex: number | null
  historyDates: string[]
} | undefined

export const selectActiveSessionShape = (projectId: string | null) => (state: RootState): ActiveSessionShape => {
  if (!projectId) return undefined;
  const fstate = state.fuzzerstate[projectId] ?? defaultFuzzerState();
  const idx = fstate.activeSessionIndex;
  if (idx === null || idx === undefined) return undefined;
  const s = fstate.fuzzerSessions[idx];
  if (!s) return undefined;
  return {
    targetUrl: s.fuzzConfig.metadata.targetUrl,
    urlIsValid: s.fuzzConfig.metadata.urlIsValid,
    fuzzingAttackType: s.fuzzConfig.fuzzingAttackType,
    selectedHistoryIndex: s.selectedHistoryIndex ?? null,
    historyDates: s.fuzzingHistory.map((h: { date: string }) => h.date),
  };
};

export const shallowEqualActiveSession = (a: ActiveSessionShape, b: ActiveSessionShape) => {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.targetUrl !== b.targetUrl) return false;
  if (a.urlIsValid !== b.urlIsValid) return false;
  if (a.fuzzingAttackType !== b.fuzzingAttackType) return false;
  if (a.selectedHistoryIndex !== b.selectedHistoryIndex) return false;
  if (a.historyDates.length !== b.historyDates.length) return false;
  for (let i = 0; i < a.historyDates.length; i++) {
    if (a.historyDates[i] !== b.historyDates[i]) return false;
  }
  return true;
};

const FuzzRequestPayload: React.FC = () => {
  const dispatch = useAppDispatch();
  const store = useStore();
  const projectId = useProjectId();
  const [isVerifying, setIsVerifying] = useState(false);

  const { activeSessionIndex, fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
  const activeSession = useAppSelector(selectActiveSessionShape(projectId), shallowEqualActiveSession);

  if (activeSessionIndex === null || fuzzerSessions[activeSessionIndex] === undefined) return null;

  const isFuzzDisabled =
    isVerifying ||
    !activeSession?.targetUrl ||
    !activeSession.targetUrl.trim() ||
    activeSession.targetUrl === 'https://' ||
    activeSession.urlIsValid === false;

  const triggerFuzzing = async () => {
    if (!projectId || isVerifying) return;
    const currentStoreState = store.getState() as RootState;
    const fstate = currentStoreState.fuzzerstate[projectId] ?? defaultFuzzerState();
    const activeSessionIdx = fstate.activeSessionIndex;
    if (activeSessionIdx === null || activeSessionIdx === undefined) return;
    const fuzzSession = fstate.fuzzerSessions[activeSessionIdx];
    if (!fuzzSession) return;

    const rawTargetUrl = fuzzSession.fuzzConfig.metadata.targetUrl;
    const stripedUrl = stripPath(rawTargetUrl);

    if (!fuzzSession.fuzzConfig.parameters || fuzzSession.fuzzConfig.parameters.length === 0) {
      toast.error("Please add at least one parameter first", { position: 'top-center' });
      return;
    }

    const resolvedParameters = fuzzSession.fuzzConfig.parameters.map((p) => {
      let effectiveValues = p.values || [];
      if (p.payloadSource === 'numbers') {
        const cfg = p.numbersConfig || { start: 1, end: 100, step: 1, minIntegerDigits: 1 };
        effectiveValues = generateNumberPayloads(cfg);
      } else if (p.payloadSource === 'null_payload') {
        const cfg = p.nullPayloadConfig || { count: 10 };
        effectiveValues = generateNullPayloads(cfg);
      }
      return {
        ...p,
        values: effectiveValues,
      };
    });

    const hasValues = resolvedParameters.some(
      (p) => p.values && p.values.length > 0 && (p.payloadSource === 'null_payload' || p.values.some((v) => v.trim() !== ''))
    );
    if (!hasValues) {
      toast.error("Please add payload values to the parameter first", { position: 'top-center' });
      return;
    }

    setIsVerifying(true);
    try {
      const updatedSession = {
        ...fuzzSession,
        fuzzConfig: {
          ...fuzzSession.fuzzConfig,
          parameters: resolvedParameters,
          metadata: {
            ...fuzzSession.fuzzConfig.metadata,
            targetUrl: stripedUrl,
            urlIsValid: true,
          },
        },
      };

      const historyIndex = fuzzSession.fuzzingHistory.length;

      const executeProps = {
        session: updatedSession,
        numTasks: fuzzSession.fuzzConfig.numThreads,
        selectedSession: activeSessionIdx,
        fuzzHistory: historyIndex,
      };

      let targets: { id: string; request: string }[] = [];
      switch (fuzzSession.fuzzConfig.fuzzingAttackType) {
        case FuzzingAttackType.ROTATOR:
          targets = await invoke("execute_rotator_fuzzing", executeProps);
          break;
        case FuzzingAttackType.ECHO:
          targets = await invoke("execute_echo_fuzzing", executeProps);
          break;
        case FuzzingAttackType.ZIPPED:
          targets = await invoke("execute_zipped_fuzzing", executeProps);
          break;
        case FuzzingAttackType.COMBINATORIAL:
          targets = await invoke("execute_combinatorial_fuzzing", executeProps);
          break;
      }

      dispatch(setTargerUrl({ targetUrl: stripedUrl, urlIsValid: true, projectId }));
      dispatch(persistFuzzerSession(projectId, activeSessionIdx));

      dispatch(addFuzzingHistory({
        sessionIndex: activeSessionIdx,
        history: {
          date: (new Date()).toISOString(),
          fuzzConfigSnapshot: updatedSession.fuzzConfig,
          requests: [],
          runState: { ...initialFuzzRunState(), status: 'running' },
        },
        projectId,
      }));

      invoke('save_fuzzer_session_draft', {
        projectId,
        sessionIndex: activeSessionIdx,
        name: fuzzSession.name,
        rawRequest: fuzzSession.fuzzConfig.rawRequest,
        targetUrl: stripedUrl,
        attackType: fuzzSession.fuzzConfig.fuzzingAttackType,
        numThreads: fuzzSession.fuzzConfig.numThreads,
        delayMs: fuzzSession.fuzzConfig.delayMs,
      }).catch(console.error);

      dispatch(setFuzzRunTargets({
        sessionIndex: activeSessionIdx,
        historyIndex,
        targets,
        projectId,
      }));
    } catch (err) {
      console.error('Failed to start fuzzing:', err);
      const errStr = typeof err === 'string' ? err : (err as any)?.message || 'Connection failed';
      toast.error(errStr, { position: 'top-center' });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className='flex flex-col gap-1 h-full'>
      <div className='bg-card/40  gap-2 flex w-full items-center h-12 p-2 shrink-0'>

        <ValidateUrlInput
          url={activeSession?.targetUrl ?? ''}
          disabled={isVerifying}
          onChange={(url, urlIsValid) => {
            if (projectId && activeSessionIndex !== null) {
              dispatch(setTargerUrl({ targetUrl: url, urlIsValid, projectId }));
              dispatch(persistFuzzerSession(projectId, activeSessionIndex));
            }
          }}
        />

        <Select
          disabled={isVerifying}
          defaultValue={"1"}
          value={activeSession?.fuzzingAttackType}
          onValueChange={(value) => {
            if (projectId && activeSessionIndex !== null) {
              dispatch(setFuzzingAttackType({ fuzzingAttackingType: value as FuzzingAttackType, projectId }));
              dispatch(persistFuzzerSession(projectId, activeSessionIndex));
            }
          }}
        >
          <SelectTrigger className="w-[180px] h-8 text-xs shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FuzzingAttackType.ROTATOR}>Rotator</SelectItem>
            <SelectItem value={FuzzingAttackType.ECHO}>Echo</SelectItem>
            <SelectItem value={FuzzingAttackType.ZIPPED}>Zipped</SelectItem>
            <SelectItem value={FuzzingAttackType.COMBINATORIAL}>Combinatorial</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={triggerFuzzing}
          size="sm"
          disabled={isFuzzDisabled}
          className="h-8 px-4 font-semibold gap-1.5 shrink-0"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              START FUZZ
            </>
          )}
        </Button>
      </div>
      <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-payload-layout" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={50} minSize={15}>
          <RequestEditor key={`editor-${activeSessionIndex}`} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={15}>
          <FuzzConfig key={`config-${activeSessionIndex}`} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default FuzzRequestPayload;
