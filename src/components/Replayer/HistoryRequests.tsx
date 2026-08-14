import { useState } from 'react'
import { ButtonGroup } from '../ui/button-group'
import { Button } from '../ui/button'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Badge } from '../ui/badge'
import { parseRequest, parseResponse } from '../utils'
import { useAppDispatch } from '@/hooks/redux'
import { useProjectId } from '@/hooks/useProjectId'
import { selectedHisotryIndex } from '@/store/slices/replayerSlice'
import { ReplayerHistoryItem } from '@/types/replayer.type'
import { cn } from '@/lib/utils'

export function getStatusBadgeStyle(status: string) {
    if (!status) return 'bg-muted text-muted-foreground border-border';
    const lower = status.toLowerCase();
    if (lower === 'pending') {
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
    }
    if (lower === 'error') {
        return 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
    }
    if (lower === 'canceled' || lower === 'cancelled') {
        return 'bg-muted text-muted-foreground border-border';
    }
    const num = parseInt(status);
    if (!isNaN(num)) {
        if (num < 300) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
        if (num < 400) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
        if (num < 500) return 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
        return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30';
    }
    return 'bg-muted text-muted-foreground border-border';
}

const HistoryRequests = ({ selectedHistoryIndex, history }: { selectedHistoryIndex: number | null; history: ReplayerHistoryItem[] }) => {
    const [open, setOpen] = useState(false);
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const goNewer = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex === 0 || !projectId) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex - 1, projectId }));
    };

    const goOlder = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex >= history.length - 1 || !projectId) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex + 1, projectId }));
    };

    const handleSelectedHisotry = (value: string) => {
        if (!projectId) return;
        dispatch(selectedHisotryIndex({ historyIndex: parseInt(value), projectId }));
        setOpen(false);
    };

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

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                        History <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[580px] p-0" align="start">
                    <div className="max-h-80 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted">
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Method</TableHead>
                                    <TableHead>Host</TableHead>
                                    <TableHead>Path</TableHead>
                                    <TableHead>Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {history.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                                            No requests replayed yet
                                        </TableCell>
                                    </TableRow>
                                )}
                                {history.map((item, index) => {
                                    const req = parseRequest(item.requestRaw);
                                    const parsedRes = item.responseRaw ? parseResponse(item.responseRaw) : null;
                                    const status = item.status || (parsedRes?.statusCode ? String(parsedRes.statusCode) : '');

                                    const hostHeader = Object.entries(req.headers || {}).find(
                                        ([k]) => k.toLowerCase() === 'host'
                                    )?.[1];

                                    let hostDisplay = hostHeader || item.baseUrl || '';
                                    if (!hostDisplay) {
                                        hostDisplay = '—';
                                    } else if (hostDisplay.includes('://')) {
                                        try {
                                            hostDisplay = new URL(hostDisplay).host;
                                        } catch {
                                            // keep raw hostDisplay
                                        }
                                    }

                                    let timeDisplay = '—';
                                    if (item.createdAt) {
                                        const d = new Date(item.createdAt);
                                        if (!isNaN(d.getTime())) {
                                            timeDisplay = d.toLocaleTimeString();
                                        }
                                    } else if (item.requestTime && item.requestTime > 1000000000000) {
                                        const d = new Date(item.requestTime);
                                        if (!isNaN(d.getTime())) {
                                            timeDisplay = d.toLocaleTimeString();
                                        }
                                    }

                                    return (
                                        <TableRow
                                            key={item.id ?? index}
                                            onClick={() => handleSelectedHisotry(index.toString())}
                                            className={`cursor-pointer ${selectedHistoryIndex === index ? 'bg-muted' : ''}`}
                                        >
                                            <TableCell className="py-1">
                                                {status ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={cn("text-[10px] font-mono px-1.5 py-0 font-medium", getStatusBadgeStyle(status))}
                                                    >
                                                        {status}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs font-semibold">{req.method}</TableCell>
                                            <TableCell className="text-xs truncate max-w-[140px]">{hostDisplay}</TableCell>
                                            <TableCell className="truncate max-w-[150px] font-mono text-xs">{req.path}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {timeDisplay}
                                            </TableCell>
                                        </TableRow>
                                    );
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
