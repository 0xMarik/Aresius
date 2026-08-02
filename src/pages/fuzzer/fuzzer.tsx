import { useAppSelector } from '@/hooks/redux';
import FuzzSession from '@/components/fuzz-session.component';
import FuzzerHistoryCompo from '@/components/FuzzerHistory';
import FuzzRequestPayload, { selectActiveSessionShape, shallowEqualActiveSession } from '@/components/FuzzerRequestPayload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

const Fuzzer: React.FC = () => {
    const activeSessionIndex = useAppSelector(state => state.fuzzerstate.activeSessionIndex)
    const activeSession = useAppSelector(selectActiveSessionShape, shallowEqualActiveSession)

    return (
        <div className="py-1 pr-1 h-full min-h-0">
            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-layout">
                <ResizablePanel defaultSize={13} minSize={13} maxSize={20}>
                    <FuzzSession />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={87} minSize={15}>
                    <div className="flex h-full min-h-0 flex-col">
                        <div className='bg-muted/50 gap-2 flex w-full items-center h-14 shrink-0 p-2'>
                        </div>

                        <div className="flex-1 min-h-0">
                            {
                                activeSessionIndex !== null && activeSessionIndex !== undefined ?
                                    (
                                        activeSession?.selectedHistoryIndex !== null ?
                                            <FuzzerHistoryCompo
                                                isLoading={false}
                                                sessionIndex={activeSessionIndex}
                                                historyIndex={activeSession!.selectedHistoryIndex!}
                                            /> :
                                            <FuzzRequestPayload />
                                    )
                                    : <h1>Choose a session</h1>
                            }
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default Fuzzer;