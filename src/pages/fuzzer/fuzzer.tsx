import { useAppSelector } from '@/hooks/redux';
import FuzzSession from '@/components/fuzz-session.component';
import FuzzerHistoryCompo from '@/components/FuzzerHistory';
import FuzzRequestPayload, { selectActiveSessionShape, shallowEqualActiveSession } from '@/components/FuzzerRequestPayload';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

const Fuzzer: React.FC = () => {
    // Primitive -> plain === comparison, only changes on setSelectedFuzz.
    const activeSessionIndex = useAppSelector(state => state.fuzzerstate.activeSessionIndex)

    const activeSession = useAppSelector(selectActiveSessionShape, shallowEqualActiveSession)

    return (
        <div className="py-1 pr-1 h-screen">
            <ResizablePanelGroup direction='horizontal' autoSaveId="fuzzing-layout" >
                <ResizablePanel defaultSize={13} minSize={13} maxSize={20}>
                    <FuzzSession />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={87} minSize={15}>
                    <div className='bg-muted/50 gap-2 flex w-full items-center h-14 p-2'>

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
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default Fuzzer;