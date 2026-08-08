import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import FuzzSession from '@/components/Fuzzer/FuzzerSession';
import FuzzerHistoryCompo from '@/components/Fuzzer/FuzzerHistory';
import FuzzRequestPayload, { selectActiveSessionShape, shallowEqualActiveSession } from '@/components/Fuzzer/FuzzerRequestPayload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { EmptyState } from '@/components/ui/empty-state';
import { Target } from 'lucide-react';
import { useEffect } from 'react';
import { resetFuzzReceivedSession, selectFuzzerState } from '@/store/slices/fuzzerSlice';

const Fuzzer: React.FC = () => {
    const projectId = useProjectId();
    const { activeSessionIndex } = useAppSelector(selectFuzzerState(projectId));
    const activeSession = useAppSelector(selectActiveSessionShape(projectId), shallowEqualActiveSession);

    const dispatch = useAppDispatch();

    useEffect(() => {
        if (projectId) {
            dispatch(resetFuzzReceivedSession(projectId));
        }
    }, [dispatch, projectId]);

    return (
        <div className="h-full min-h-0">
            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-layout">
                <ResizablePanel defaultSize={15} minSize={13} maxSize={50}>
                    <FuzzSession />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={85} minSize={15}>
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="flex-1 min-h-0">
                            {
                                activeSessionIndex !== null && activeSessionIndex !== undefined ?
                                    (
                                        activeSession?.selectedHistoryIndex !== null && activeSession?.selectedHistoryIndex !== undefined ?
                                            <FuzzerHistoryCompo
                                                isLoading={false}
                                                sessionIndex={activeSessionIndex}
                                                historyIndex={activeSession.selectedHistoryIndex}
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
