import { useCallback, useMemo } from 'react'
import { Button } from '../ui/button'
import { Folder, Plus, SlidersVertical } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/hooks/redux'
import { useProjectId } from '@/hooks/useProjectId'
import { addFuzzSession, setSelectedFuzz, selectFuzzerState } from '@/store/slices/fuzzerSlice'
import { RsTree, TreeNode } from 'rstree-ui'
import { RunningDot } from '@/components/ui/RunningDot'

interface HistoryShapeItem {
    date: string;
    isRunning: boolean;
}


const FuzzSession = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const fstate = useAppSelector(selectFuzzerState(projectId));

    const sessionShape = useMemo<HistoryShapeItem[][]>(() => {
        return fstate.fuzzerSessions.map((s) => s.fuzzingHistory.map((h) => ({
            date: h.date,
            isRunning: h.runState?.status === 'running',
        })));
    }, [fstate.fuzzerSessions]);

    const activeSessionIndex = fstate.activeSessionIndex;
    const activeHistoryIndex = useMemo(() => {
        if (activeSessionIndex === null || activeSessionIndex === undefined) return undefined;
        return fstate.fuzzerSessions[activeSessionIndex]?.selectedHistoryIndex;
    }, [fstate.fuzzerSessions, activeSessionIndex]);

    const data: TreeNode<unknown>[] = useMemo(() =>
        sessionShape.map((historyItems, colIndex) => {
            const isSessionRunning = historyItems.some((h) => h.isRunning)
            return {
                id: `${colIndex}`,
                label: (
                    <span className="flex items-center justify-between w-full pr-1">
                        <span>Session {colIndex + 1}</span>
                        {isSessionRunning && (
                            <RunningDot className="ml-auto" />
                        )}
                    </span>
                ) as any,
                icon: <SlidersVertical size={12} />,
                children: historyItems.map((h, sessIndex) => ({
                    id: `${colIndex}-${sessIndex}`,
                    label: (
                        <span className="flex items-center justify-between w-full pr-1">
                            <span>{h.date}</span>
                            {h.isRunning && (
                                <RunningDot className="ml-auto" />
                            )}
                        </span>
                    ) as any,
                    icon: <div></div>,
                }))
            }
        }), [sessionShape])

    const selectedIds = useMemo(() => {
        if (activeSessionIndex === null || activeSessionIndex === undefined) return []
        return [
            activeHistoryIndex === null || activeHistoryIndex === undefined
                ? `${activeSessionIndex}`
                : `${activeSessionIndex}-${activeHistoryIndex}`
        ]
    }, [activeSessionIndex, activeHistoryIndex])

    const expandedIds = useMemo(() => {
        return activeSessionIndex !== null && activeSessionIndex !== undefined
            ? [`${activeSessionIndex}`]
            : []
    }, [activeSessionIndex])

    const handleCreateFuzzSession = useCallback(() => {
        if (projectId) {
            dispatch(addFuzzSession({ name: "Session", targetUrl: "", isItFuzzerPage: true, projectId }));
        }
    }, [dispatch, projectId])

    const handleSelection = useCallback((value: string[]) => {
        if (!projectId) return;
        if (value.length >= 1) {
            if (value[0].includes("-")) {
                const [sessionId, historyId] = value[0].split("-");
                dispatch(setSelectedFuzz({ sessionIndex: Number(sessionId), historyIndex: Number(historyId), projectId }));
            } else {
                dispatch(setSelectedFuzz({ sessionIndex: Number(value[0]), historyIndex: null, projectId }));
            }
        } else {
            dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null, projectId }));
        }
    }, [dispatch, projectId])

    return (
        <div className='flex flex-col gap-1 h-full'>
            <div className='flex w-full items-center'>
                <Button className='my-2 mx-auto' onClick={handleCreateFuzzSession}>
                    <Plus /> Create a session
                </Button>
            </div>
            <div className='h-full'>
                <RsTree
                    className="!h-full bg-transparent border-none"
                    data={data}
                    treeLineClassName="!border-border/40"
                    treeNodeClassName="
    !bg-transparent
    !text-muted-foreground
    hover:!bg-accent/50 hover:!text-foreground
    aria-selected:!bg-accent aria-selected:!text-accent-foreground
    rounded-sm text-[13px] font-mono transition-colors
  "
                    selectedIds={selectedIds}
                    expandedIds={expandedIds}
                    onSelect={handleSelection}
                    showIcons={true}
                    virtualizeEnabled={true}
                    folderIcon={<Folder className="w-3.5 h-3.5 text-accent" />}
                />
            </div>
        </div>
    )
}

export default FuzzSession