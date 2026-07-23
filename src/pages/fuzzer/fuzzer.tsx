import { invoke } from "@tauri-apps/api/core";
import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { addFuzzingHistory, setFuzzingAttackType, setTargerUrl } from '@/store/slices/fuzzerSlice';
import FuzzSession from '@/components/fuzz-session.component';
import { FuzzingAttackType } from '@/types/fuzzer.type';
import { Link } from 'react-router-dom';
import FuzzerHistoryCompo from '@/components/history.component';
import FuzzRequestPayload from '@/components/fuzz-request-payloads.component';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStore } from "react-redux";


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

const selectActiveSessionShape = (state: { fuzzerstate: any }): ActiveSessionShape => {
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

const shallowEqualActiveSession = (a: ActiveSessionShape, b: ActiveSessionShape) => {
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

const Fuzzer: React.FC = () => {
    const isLoading = false;
    const dispatch = useAppDispatch()
    const store = useStore()

    // Primitive -> plain === comparison, only changes on setSelectedFuzz.
    const activeSessionIndex = useAppSelector(state => state.fuzzerstate.activeSessionIndex)

    // Narrow shape + custom equality -> ignores `requests` churn entirely.
    const activeSession = useAppSelector(selectActiveSessionShape, shallowEqualActiveSession)

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
        <div className="py-1 pr-1 h-screen">

            <ReactSplit
                direction={SplitDirection.Horizontal}
                gutterClassName="custom-gutter-horizontal"
                draggerClassName="custom-dragger-horizontal"
                initialSizes={[20, 80]}
            >
                <FuzzSession />
                <div className='flex flex-col gap-1 h-full'>
                    <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
                        {activeSession?.historyDates.map((date, index) => (
                            <Link key={index} to={`/fuzzer/history/${index}`} className='text-sm'>
                                {new Date(date).toISOString()}
                                <Button className='size-4 text-sm'>X</Button>
                            </Link>
                        ))}
                    </div>

                    <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>
                        <Input
                            onChange={(e) => dispatch(setTargerUrl({ targetUrl: e.target.value }))}
                            value={activeSession?.targetUrl ?? ''}
                            placeholder="http://example.com"
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
                            disabled={isLoading}
                            className="p-4 text-white rounded disabled:bg-gray-400"
                        >
                            RUN
                        </Button>
                    </div>

                    {
                        activeSessionIndex !== null && activeSessionIndex !== undefined ?
                            (
                                activeSession?.selectedHistoryIndex !== null ?
                                    <FuzzerHistoryCompo isLoading={false} /> :
                                    <FuzzRequestPayload />
                            )
                            : <h1>Choose a session</h1>
                    }
                </div>
            </ReactSplit>
        </div>
    );
};

export default Fuzzer;