import { useState } from 'react';
import { ButtonGroup } from '../ui/button-group';
import { Button } from '../ui/button';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import MethodBadge from '@/components/MethodBadge';
import { parseRequest, parseResponse } from '../utils';
import { HttpStatusBadge, getStatusBadgeStyle } from '@/components/HttpStatusBadge';
import { useReplayerEditor } from '@/context/ReplayerContext';
import { ReplayerHistoryItem } from '@/types/replayer.type';

export { getStatusBadgeStyle };

function formatHistoryBaseUrl(item: ReplayerHistoryItem, headers?: Record<string, string>): string {
    if (item.baseUrl && item.baseUrl !== 'https://' && item.baseUrl.trim() !== '') {
        return item.baseUrl;
    }
    const hostHeader = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'host')?.[1];
    if (hostHeader) {
        return hostHeader;
    }
    return item.baseUrl || '—';
}

function formatHistoryTime(item: ReplayerHistoryItem): string {
    if (item.createdAt) {
        const d = new Date(item.createdAt);
        if (!isNaN(d.getTime())) return d.toLocaleTimeString();
    }
    if (item.requestTime && item.requestTime > 1000000000000) {
        const d = new Date(item.requestTime);
        if (!isNaN(d.getTime())) return d.toLocaleTimeString();
    }
    return '—';
}

const HistoryRequests = () => {
    const [open, setOpen] = useState(false);
    const { history, selectedHistoryIndex, selectHistoryIndex } = useReplayerEditor();

    const goNewer = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex === 0) return;
        selectHistoryIndex(selectedHistoryIndex - 1);
    };

    const goOlder = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex >= history.length - 1) return;
        selectHistoryIndex(selectedHistoryIndex + 1);
    };

    const handleSelect = (index: number) => {
        selectHistoryIndex(index);
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
                <PopoverContent className="w-[620px] p-0" align="start">
                    <div className="max-h-80 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted">
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Method</TableHead>
                                    <TableHead>Base Url</TableHead>
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
                                    const baseUrlDisplay = formatHistoryBaseUrl(item, req.headers);

                                    return (
                                        <TableRow
                                            key={item.id ?? index}
                                            onClick={() => handleSelect(index)}
                                            className={`cursor-pointer ${selectedHistoryIndex === index ? 'bg-muted' : ''}`}
                                        >
                                            <TableCell className="py-1">
                                                {status ? (
                                                    <HttpStatusBadge status={status} />
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                <MethodBadge method={req.method} />
                                            </TableCell>
                                            <TableCell className="text-xs truncate max-w-[160px] font-mono" title={baseUrlDisplay}>
                                                {baseUrlDisplay}
                                            </TableCell>
                                            <TableCell className="truncate max-w-[140px] font-mono text-xs" title={req.path}>
                                                {req.path}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                {formatHistoryTime(item)}
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
    );
};

export default HistoryRequests;
