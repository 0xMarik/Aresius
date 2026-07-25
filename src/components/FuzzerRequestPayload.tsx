import React from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';

import RequestEditor from './fuzzer/request-editor/request-editor.component';
import FuzzConfig from './fuzzer/FuzzConfig';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { Input } from './ui/input';
import { addFuzzingHistory, setFuzzingAttackType, setTargerUrl } from '@/store/slices/fuzzerSlice';
import { FuzzingAttackType } from '@/types/fuzzer.type';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'react-redux';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';

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

    const executeProps = {
      session: fuzzSession,
      numTasks: fuzzSession.fuzzConfig.numThreads,
      selectedSession: activeSessionIndex,
      fuzzHistory: fuzzSession.fuzzingHistory.length
    }

    switch (fuzzSession.fuzzConfig.fuzzingAttackType) {
      case FuzzingAttackType.ROTATOR:
        await invoke<string[]>("execute_rotator_fuzzing", executeProps);
        break;
      case FuzzingAttackType.ECHO:
        await invoke<string[]>("execute_echo_fuzzing", executeProps);
        break;
      case FuzzingAttackType.ZIPPED:
        await invoke<string[]>("execute_zipped_fuzzing", executeProps);
        break;
      case FuzzingAttackType.COMBINATORIAL:
        await invoke<string[]>("execute_combinatorial_fuzzing", executeProps);
        break;
    }

    dispatch(addFuzzingHistory({
      sessionIndex: activeSessionIndex,
      history: { date: (new Date()).toISOString(), fuzzConfigSnapshot: fuzzSession.fuzzConfig, requests: [] }
    }))
  }

  return (
    <div className='flex flex-col gap-1 h-full'>


      <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
        <Input
          onChange={(e) => dispatch(setTargerUrl({ targetUrl: e.target.value }))}
          value={activeSession?.targetUrl ?? ''}
          placeholder="https://example.com"
        />

        <Select
          defaultValue={"1"}
          value={activeSession?.fuzzingAttackType}
          onValueChange={(value) => dispatch(setFuzzingAttackType({ fuzzingAttackingType: value as FuzzingAttackType }))}
        >
          <SelectTrigger className="w-[180px]">
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
          className="p-4 text-white rounded disabled:bg-gray-400"
        >
          RUN
        </Button>
      </div>
      <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-payload-layout" >
        <ResizablePanel defaultSize={50} minSize={15}>
          <RequestEditor />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50} minSize={15}>
          <FuzzConfig key={fuzzerSessions[activeSessionIndex].name} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default FuzzRequestPayload;
