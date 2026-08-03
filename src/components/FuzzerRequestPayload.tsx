import React from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';

import RequestEditor from './fuzzer/request-editor/request-editor.component';
import FuzzConfig from './fuzzer/FuzzConfig';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { Input } from './ui/input';
import { addFuzzingHistory, setFuzzingAttackType, setFuzzRunTargets, setTargerUrl } from '@/store/slices/fuzzerSlice';
import { FuzzingAttackType, initialFuzzRunState } from '@/types/fuzzer.type';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'react-redux';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Play } from 'lucide-react';


// Shape of what this component actually renders for the active session.
// Deliberately excludes `requests` — that's what applyFuzzUpdates mutates
// on every completed/errored fuzz request, and we don't want to re-render
// on that.
type ActiveSessionShape = {
  targetUrl: string
  fuzzingAttackType: FuzzingAttackType
  selectedHistoryIndex: number | null
  historyDates: string[]
} | undefined



export const selectActiveSessionShape = (state: { fuzzerstate: any }): ActiveSessionShape => {
  const idx = state.fuzzerstate.activeSessionIndex
  if (idx === null || idx === undefined) return undefined
  const s = state.fuzzerstate.fuzzerSessions[idx]
  if (!s) return undefined
  return {
    targetUrl: s.fuzzConfig.metadata.targetUrl,
    fuzzingAttackType: s.fuzzConfig.fuzzingAttackType,
    selectedHistoryIndex: s.selectedHistoryIndex ?? null,
    historyDates: s.fuzzingHistory.map((h: { date: string }) => h.date),
  }
}

export const shallowEqualActiveSession = (a: ActiveSessionShape, b: ActiveSessionShape) => {
  if (a === b) return true
  if (!a || !b) return a === b
  if (a.targetUrl !== b.targetUrl) return false
  if (a.fuzzingAttackType !== b.fuzzingAttackType) return false
  if (a.selectedHistoryIndex !== b.selectedHistoryIndex) return false
  if (a.historyDates.length !== b.historyDates.length) return false
  for (let i = 0; i < a.historyDates.length; i++) {
    if (a.historyDates[i] !== b.historyDates[i]) return false
  }
  return true
}

const FuzzRequestPayload: React.FC = () => {
  const dispatch = useAppDispatch()
  const store = useStore()

  const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate);
  if (activeSessionIndex === null) return null;
  if (fuzzerSessions[activeSessionIndex] === undefined) return null;
  // Narrow shape + custom equality -> ignores `requests` churn entirely.
  const activeSession = useAppSelector(selectActiveSessionShape, shallowEqualActiveSession)
  // const { rawRequest } = fuzzerSessions[activeSessionIndex].payload;

  // Event handler, not a render concern: read fresh state directly from
  // the store instead of subscribing to it via a selector. This keeps
  // triggerFuzzing's dependency on fuzzerSessions from ever causing a
  // re-render — it only needs the value at the moment it's called.
  const triggerFuzzing = async () => {
    const { activeSessionIndex, fuzzerSessions } = (store.getState() as any).fuzzerstate
    if (activeSessionIndex === null || activeSessionIndex === undefined) return;
    const fuzzSession = fuzzerSessions[activeSessionIndex]
    if (!fuzzSession) return;

    const historyIndex = fuzzSession.fuzzingHistory.length;

    dispatch(addFuzzingHistory({
      sessionIndex: activeSessionIndex,
      history: {
        date: (new Date()).toISOString(),
        fuzzConfigSnapshot: fuzzSession.fuzzConfig,
        requests: [],
        runState: { ...initialFuzzRunState(), status: 'running' },
      },
    }));

    const executeProps = {
      session: fuzzSession,
      numTasks: fuzzSession.fuzzConfig.numThreads,
      selectedSession: activeSessionIndex,
      fuzzHistory: historyIndex,
    }

    let targets: { id: string; request: string }[] = [];
    try {
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
    } catch (err) {
      console.error('Failed to start fuzzing:', err);
      return;
    }

    dispatch(setFuzzRunTargets({
      sessionIndex: activeSessionIndex,
      historyIndex,
      targets,
    }))
  }

  return (
    <div className='flex flex-col gap-1 h-full'>
      <div className='bg-card/40 border border-border/60 rounded-md gap-2 flex w-full items-center h-12 p-2 shrink-0'>
        <Input
          onChange={(e) => dispatch(setTargerUrl({ targetUrl: e.target.value }))}
          value={activeSession?.targetUrl ?? ''}
          placeholder="https://example.com"
          className="h-8 font-mono text-xs"
        />

        <Select
          defaultValue={"1"}
          value={activeSession?.fuzzingAttackType}
          onValueChange={(value) => dispatch(setFuzzingAttackType({ fuzzingAttackingType: value as FuzzingAttackType }))}
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
          className="h-8 px-4 font-semibold gap-1.5 shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          START FUZZ
        </Button>
      </div>
      <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-payload-layout" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={50} minSize={15}>
          <RequestEditor />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={15}>
          <FuzzConfig key={fuzzerSessions[activeSessionIndex].name} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default FuzzRequestPayload;
