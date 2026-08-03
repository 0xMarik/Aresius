import { useAppSelector } from '@/hooks/redux';
import FuzzSession from '@/components/fuzz-session.component';
import FuzzerHistoryCompo from '@/components/FuzzerHistory';
import FuzzRequestPayload, { selectActiveSessionShape, shallowEqualActiveSession } from '@/components/FuzzerRequestPayload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { EmptyState } from '@/components/ui/empty-state';
import { Target } from 'lucide-react';

const Fuzzer: React.FC = () => {
    const activeSessionIndex = useAppSelector(state => state.fuzzerstate.activeSessionIndex)
    const activeSession = useAppSelector(selectActiveSessionShape, shallowEqualActiveSession)

    return (
        <div className="p-1 h-full min-h-0">
            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-layout">
                <ResizablePanel defaultSize={15} minSize={13} maxSize={22}>
                    <FuzzSession />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={85} minSize={15}>
                    <div className="flex h-full min-h-0 flex-col">
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
                                    : (
                                        <EmptyState
                                            icon={Target}
                                            title="No Fuzzing Session Selected"
                                            description="Select an existing fuzzing session from the sidebar or create a new session to configure payloads and attack positions."
                                        />
                                    )
                            }
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default Fuzzer;
