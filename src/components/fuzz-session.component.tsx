import { Button } from './ui/button'
import { Plus, SlidersVertical } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/hooks/redux'
import { addFuzzSession, setSelectedFuzz, } from '@/store/slices/fuzzerSlice'
import { RsTree, TreeNode } from 'rstree-ui'



const FuzzSession = () => {
    const dispatch = useAppDispatch();
    const { fuzzerSessions } = useAppSelector((state) => state.fuzzerstate)

    const data: TreeNode<unknown>[] = fuzzerSessions.map((fuzzSession, colIndex) => ({
        id: `${colIndex}`,
        label: `Session ${colIndex + 1}`,
        icon: <SlidersVertical size={12} />,
        children: fuzzSession.fuzzingHistory.map((history, sessIndex) => ({
            id: `${colIndex}-${sessIndex}`,
            label: `${history.date}`,
            icon: <div></div>,
            // You can add more nesting if needed
        }))
    }))



    const handleCreateFuzzSession = () => {
        dispatch(addFuzzSession({ name: "Session" }))

    }

    const handleSelection = (value: string[]) => {
        console.log("Selected IDs: ", value)
        // show the first (default session) in case multiple selection
        if (value.length >= 1) {
            if (value[0].includes("-")) {
                // Here we are in history
                const [sessionId, historyId] = value[0].split("-");
                dispatch(setSelectedFuzz({ sessionIndex: Number(sessionId), historyIndex: Number(historyId) }))
            } else {
                const sessionId = Number(value[0])
                dispatch(setSelectedFuzz({ sessionIndex: Number(sessionId), historyIndex: null }))
                // dispatch(setSelectedSe)
            }
        } else {
            // Deselect everything
            dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null }))
        }
    }

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
                    // selectedIds={selectedIds}
                    onSelect={handleSelection}
                    // searchTerm={searchTerm}
                    showIcons={true}
                    virtualizeEnabled={true}
                />
            </div>
        </div>
    )
}

export default FuzzSession
