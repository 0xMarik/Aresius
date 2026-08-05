import { ButtonGroup } from '../ui/button-group'
import { Button } from '../ui/button'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { parseRequest } from '../utils'
import { useAppDispatch } from '@/hooks/redux'
import { selectedHisotryIndex } from '@/store/slices/replayerSlice'
import { ReplayerHistoryItem } from '@/types/replayer.type'

const HistoryRequests = ({ selectedHistoryIndex, history }: { selectedHistoryIndex: number | null; history: ReplayerHistoryItem[] }) => {

    const dispatch = useAppDispatch()

    const goNewer = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex === 0) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex - 1 }));
    };

    const goOlder = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex >= history.length - 1) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex + 1 }));
    };

    const handleSelectedHisotry = (value: string) => {
        dispatch(selectedHisotryIndex({ historyIndex: parseInt(value) }));
    }

    return (
        <ButtonGroup>
            <Button
                disabled={selectedHistoryIndex === null || history.length - 1 === selectedHistoryIndex}
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={goOlder}
            >
                <ChevronLeft className="w-4 h-4" />
            </Button>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                        History <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[520px] p-0" align="start">
                    <div className="max-h-80 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted">
                                <TableRow>
                                    <TableHead>Method</TableHead>
                                    <TableHead>Host</TableHead>
                                    <TableHead>Path</TableHead>
                                    <TableHead>Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {history.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                                            No requests replayed yet
                                        </TableCell>
                                    </TableRow>
                                )}
                                {history.map((item, index) => {
                                    const req = parseRequest(item.requestRaw)
                                    return (
                                        <TableRow
                                            key={index}
                                            onClick={() => handleSelectedHisotry(index.toString())}
                                            className={`cursor-pointer ${selectedHistoryIndex === index ? 'bg-muted' : ''
                                                }`}
                                        >
                                            <TableCell className="font-mono text-xs font-semibold">{req.method}</TableCell>
                                            <TableCell className="text-xs">{item.baseUrl}</TableCell>
                                            <TableCell className="truncate max-w-[160px] font-mono text-xs">{req.path}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {new Date(item.requestTime).toLocaleTimeString()}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </PopoverContent>
            </Popover>

            <Button
                disabled={selectedHistoryIndex === null || selectedHistoryIndex === 0}
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={goNewer}
            >
                <ChevronRight className="w-4 h-4" />
            </Button>
        </ButtonGroup>
    )
}

export default HistoryRequests
