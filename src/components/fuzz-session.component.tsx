import { useCallback, useMemo } from 'react'
import { Button } from './ui/button'
import { Plus, SlidersVertical } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/hooks/redux'
import { addFuzzSession, setSelectedFuzz } from '@/store/slices/fuzzerSlice'
import { RsTree, TreeNode } from 'rstree-ui'

// Only compares what the tree renders: session count + each session's
// history dates. `requests` never enters this, so applyFuzzUpdates
// churning through fuzzed rows doesn't count as a "change" here.
const sessionShapeEqual = (a: string[][], b: string[][]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i].length !== b[i].length) return false
        for (let j = 0; j < a[i].length; j++) {
            if (a[i][j] !== b[i][j]) return false
        }
    }
    return true
}

const FuzzSession = () => {
    console.count('FuzzSession render')
    const dispatch = useAppDispatch();

    const sessionShape = useAppSelector(
        (state) => state.fuzzerstate.fuzzerSessions.map((s) => s.fuzzingHistory.map((h) => `${h.date}`)),
        sessionShapeEqual as any
    )

    const activeSessionIndex = useAppSelector((state) => state.fuzzerstate.activeSessionIndex)
    const activeHistoryIndex = useAppSelector((state) => {
        const idx = state.fuzzerstate.activeSessionIndex
        if (idx === null || idx === undefined) return undefined
        return state.fuzzerstate.fuzzerSessions[idx]?.selectedHistoryIndex
    })

    const data: TreeNode<unknown>[] = useMemo(() =>
        (sessionShape as any[]).map((dates: any, colIndex: any) => ({
            id: `${colIndex}`,
            label: `Session ${colIndex + 1}`,
            icon: <SlidersVertical size={12} />,
            children: dates.map((date: any, sessIndex: any) => ({
                id: `${colIndex}-${sessIndex}`,
                label: date,
                icon: <div></div>,
            }))
        })), [sessionShape])

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
        dispatch(addFuzzSession({ name: "Session", targetUrl: "" }))
    }, [dispatch])

    const handleSelection = useCallback((value: string[]) => {
        if (value.length >= 1) {
            if (value[0].includes("-")) {
                const [sessionId, historyId] = value[0].split("-");
                dispatch(setSelectedFuzz({ sessionIndex: Number(sessionId), historyIndex: Number(historyId) }))
            } else {
                dispatch(setSelectedFuzz({ sessionIndex: Number(value[0]), historyIndex: null }))
            }
        } else {
            dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null }))
        }
    }, [dispatch])

    return (
        <div className='flex flex-col gap-1 h-full'>
            <div className='bg-muted/50 flex w-full items-center h-13 p-2'>
                <Button onClick={handleCreateFuzzSession}>
                    <Plus /> Create a session
                </Button>
            </div>
            <div className='bg-muted/50 h-full p-2'>
                <RsTree
                    className='!h-full bg-transparent'
                    data={data}
                    selectedIds={selectedIds}
                    expandedIds={expandedIds}
                    onSelect={handleSelection}
                    showIcons={true}
                    virtualizeEnabled={true}
                />
            </div>
        </div>
    )
}

export default FuzzSession