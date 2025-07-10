import { Button } from './ui/button'
import { Plus } from 'lucide-react'
import { Tree } from './tree.component'
import { useAppDispatch, useAppSelector } from '@/hooks/redux'
import { addFuzzSession } from '@/store/slices/fuzzerSlice'

const FuzzSession = () => {
    const dispatch = useAppDispatch();
    const { fuzzerSessions } = useAppSelector((state) => state.fuzzerstate)

    const handleCreateFuzzSession = () => {
        dispatch(addFuzzSession({ name: "Default session" }))

    }

    return (
        <div className='flex flex-col gap-1 h-full'>
            <div className='bg-muted/50 flex w-full items-center h-13 p-2'>
                <Button onClick={handleCreateFuzzSession}>
                    <Plus /> Create a session
                </Button>
            </div>
            <div className='bg-muted/50 h-full p-2'>
                {

                    fuzzerSessions.length > 0 ?
                        <Tree data={
                            fuzzerSessions.map((session, index) => ({
                                id: index,
                                label: session.name,
                                children: []
                                // session.fuzzingHistory.map((history, index) => ({
                                //     id: index,
                                //     label: `Fuzz #${index} - ${history.date}`
                                // }))

                            }))
                        }
                        // onSelect={console.log}
                        />

                        : "Their is no session"
                }
            </div>
        </div>
    )
}

export default FuzzSession
