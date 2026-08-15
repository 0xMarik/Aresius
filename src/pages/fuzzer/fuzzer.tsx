import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import FuzzSession from '@/components/Fuzzer/FuzzerSession';
import FuzzerHistoryCompo from '@/components/Fuzzer/FuzzerHistory';
import FuzzRequestPayload, { selectActiveSessionShape, shallowEqualActiveSession } from '@/components/Fuzzer/FuzzerRequestPayload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Plus, Target } from 'lucide-react';
import { useEffect } from 'react';
import { addFuzzSession, resetFuzzReceivedSession, selectFuzzerState } from '@/store/slices/fuzzerSlice';
import { invoke } from '@tauri-apps/api/core';

const Fuzzer: React.FC = () => {
    const projectId = useProjectId();
    const { activeSessionIndex, fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
    const activeSession = useAppSelector(selectActiveSessionShape(projectId), shallowEqualActiveSession);

    const dispatch = useAppDispatch();

    useEffect(() => {
        if (projectId) {
            dispatch(resetFuzzReceivedSession(projectId));
        }
    }, [dispatch, projectId]);

    const totalSessions = fuzzerSessions.length;
    const hasNoSessionsAtAll = totalSessions === 0;
    const noSessionSelected = activeSessionIndex === null || activeSessionIndex === undefined || !fuzzerSessions[activeSessionIndex];

    const handleCreateFuzzSession = () => {
        if (projectId) {
            dispatch(addFuzzSession({ name: "Session", targetUrl: "", isItFuzzerPage: true, projectId }));
            invoke('create_fuzzer_session_db', {
                projectId,
                name: "Session",
                targetUrl: "",
                rawRequest: "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n",
            }).catch(console.error);
        }
    };

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
                            {noSessionSelected ? (
                                <EmptyState
                                    icon={Target}
                                    title={hasNoSessionsAtAll ? "No Fuzzing Sessions" : "No Fuzzing Session Selected"}
                                    description={
                                        hasNoSessionsAtAll
                                            ? "You don't have any fuzzing sessions. Create a new session to configure payloads and attack positions."
                                            : "Select an existing session from the sidebar on the left or create a new session."
                                    }
                                    action={
                                        <Button
                                            size="sm"
                                            onClick={handleCreateFuzzSession}
                                            variant={hasNoSessionsAtAll ? "default" : "outline"}
                                            className="gap-1.5 font-medium text-xs shadow-xs"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            {hasNoSessionsAtAll ? "Create Session" : "New Session"}
                                        </Button>
                                    }
                                />
                            ) : (
                                activeSession?.selectedHistoryIndex !== null && activeSession?.selectedHistoryIndex !== undefined ? (
                                    <FuzzerHistoryCompo
                                        isLoading={false}
                                        sessionIndex={activeSessionIndex}
                                        historyIndex={activeSession.selectedHistoryIndex}
                                    />
                                ) : (
                                    <FuzzRequestPayload />
                                )
                            )}
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default Fuzzer;
