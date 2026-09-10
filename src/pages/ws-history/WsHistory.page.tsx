import React, { useEffect, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    fetchWsStreams,
    fetchWsMessages,
    clearWsHistory,
    deleteWsMessage,
    clearStreamMessages,
    setSelectedStreamId,
    setSelectedMessageId,
    selectWsStreams,
    selectSelectedStreamId,
    selectSelectedStream,
    selectWsMessagesForStream,
    selectSelectedMessageId,
    selectWsHistoryState,
} from '@/store/slices/wsHistorySlice';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeMirrorEditor } from '@/components/result-table.components';
import {
    ArrowUpRight,
    ArrowDownLeft,
    Copy,
    Check,
    Trash2,
    Clock,
    HardDrive,
    Search,
    Cable,
    Shield,
    FileCode,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatDateTime(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatHexDump(base64OrRaw: string): string {
    try {
        let binaryStr: string;
        try {
            binaryStr = atob(base64OrRaw);
        } catch {
            binaryStr = base64OrRaw;
        }
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        const lines: string[] = [];
        for (let i = 0; i < bytes.length; i += 16) {
            const chunk = bytes.slice(i, i + 16);
            const offset = i.toString(16).padStart(8, '0');
            const hexParts: string[] = [];
            let asciiPart = '';

            for (let j = 0; j < 16; j++) {
                if (j < chunk.length) {
                    hexParts.push(chunk[j].toString(16).padStart(2, '0'));
                    asciiPart += chunk[j] >= 32 && chunk[j] <= 126 ? String.fromCharCode(chunk[j]) : '.';
                } else {
                    hexParts.push('  ');
                }
            }

            const hexPart1 = hexParts.slice(0, 8).join(' ');
            const hexPart2 = hexParts.slice(8, 16).join(' ');
            lines.push(`${offset}  ${hexPart1}  ${hexPart2}  |${asciiPart}|`);
        }
        return lines.join('\n');
    } catch {
        return base64OrRaw;
    }
}

export const WsHistoryPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const streams = useAppSelector(selectWsStreams(projectId));
    const selectedStreamId = useAppSelector(selectSelectedStreamId(projectId));
    const selectedStream = useAppSelector(selectSelectedStream(projectId));
    const messages = useAppSelector(selectWsMessagesForStream(projectId, selectedStreamId));
    const selectedMessageId = useAppSelector(selectSelectedMessageId(projectId));
    const wsState = useAppSelector(selectWsHistoryState(projectId));

    const [streamSearch, setStreamSearch] = useState('');
    const [messageSearch, setMessageSearch] = useState('');
    const [viewMode, setViewMode] = useState<'pretty' | 'raw' | 'hex'>('pretty');
    const [copied, setCopied] = useState(false);

    // Initial fetch of streams
    useEffect(() => {
        if (projectId && !wsState.isLoaded && !wsState.loading) {
            dispatch(fetchWsStreams(projectId));
        }
    }, [projectId, wsState.isLoaded, wsState.loading, dispatch]);

    // Fetch messages when selectedStreamId changes
    useEffect(() => {
        if (projectId && selectedStreamId !== null) {
            dispatch(fetchWsMessages({ projectId, streamId: selectedStreamId }));
        }
    }, [projectId, selectedStreamId, dispatch]);

    const filteredStreams = useMemo(() => {
        if (!streamSearch.trim()) return streams;
        const q = streamSearch.toLowerCase();
        return streams.filter(
            (s) => s.destination.toLowerCase().includes(q) || s.path.toLowerCase().includes(q)
        );
    }, [streams, streamSearch]);

    const filteredMessages = useMemo(() => {
        if (!messageSearch.trim()) return messages;
        const q = messageSearch.toLowerCase();
        return messages.filter(
            (m) =>
                m.payload.toLowerCase().includes(q) ||
                m.direction.toLowerCase().includes(q) ||
                m.messageType.toLowerCase().includes(q)
        );
    }, [messages, messageSearch]);

    const selectedMessage = useMemo(() => {
        if (!selectedMessageId) return null;
        return messages.find((m) => m.id === selectedMessageId) ?? null;
    }, [messages, selectedMessageId]);

    const displayPayload = useMemo(() => {
        if (!selectedMessage) return '';
        if (viewMode === 'hex') {
            return formatHexDump(selectedMessage.payload);
        }
        if (selectedMessage.messageType === 'Binary') {
            try {
                const decoded = atob(selectedMessage.payload);
                return decoded;
            } catch {
                return selectedMessage.payload;
            }
        }
        if (viewMode === 'pretty') {
            try {
                const parsed = JSON.parse(selectedMessage.payload);
                return JSON.stringify(parsed, null, 2);
            } catch {
                return selectedMessage.payload;
            }
        }
        return selectedMessage.payload;
    }, [selectedMessage, viewMode]);

    const handleCopy = () => {
        if (displayPayload) {
            navigator.clipboard.writeText(displayPayload);
            setCopied(true);
            toast.success('Message payload copied to clipboard');
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleClearAll = () => {
        if (projectId) {
            dispatch(clearWsHistory(projectId));
            toast.info('WebSocket history cleared');
        }
    };

    const handleDeleteMessage = (streamId: number, messageId: number) => {
        if (projectId) {
            dispatch(deleteWsMessage({ projectId, streamId, messageId }));
            toast.info('Message deleted');
        }
    };

    const handleClearStreamMessages = () => {
        if (projectId && selectedStreamId !== null) {
            dispatch(clearStreamMessages({ projectId, streamId: selectedStreamId }));
            toast.info('All messages deleted');
        }
    };

    return (
        <div className="flex flex-col h-screen w-full bg-background overflow-hidden select-none">
            <ResizablePanelGroup direction="vertical" autoSaveId="ws-history-vertical">
                {/* Top Section: Split horizontally between Streams list and Messages list */}
                <ResizablePanel defaultSize={52} minSize={25}>
                    <ResizablePanelGroup direction="horizontal" autoSaveId="ws-history-horizontal">
                        {/* Top-Left: WebSocket Streams List */}
                        <ResizablePanel defaultSize={48} minSize={25} className="flex flex-col border-r border-border/40">
                            {/* Header bar */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20 text-xs">
                                <div className="flex items-center gap-2">
                                    <Cable className="h-3.5 w-3.5 text-primary" />
                                    <span className="font-semibold text-foreground tracking-tight">Streams</span>
                                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-mono">
                                        {streams.length}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="h-3 w-3 absolute left-2 top-2 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Filter streams…"
                                            value={streamSearch}
                                            onChange={(e) => setStreamSearch(e.target.value)}
                                            className="h-7 w-32 md:w-44 pl-7 pr-2 rounded-md bg-muted/40 text-[11px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary border border-border/30"
                                        />
                                    </div>
                                    {streams.length > 0 && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                            title="Clear all streams"
                                            onClick={handleClearAll}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Column Header */}
                            <div className="grid grid-cols-[50px_1fr_1fr_140px] px-3 py-1.5 border-b border-border/30 bg-muted/30 text-[11px] font-medium text-muted-foreground">
                                <div>ID</div>
                                <div>Destination</div>
                                <div>Path</div>
                                <div>Created At</div>
                            </div>

                            {/* Table content */}
                            <div className="flex-1 overflow-y-auto">
                                {filteredStreams.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-in fade-in-50 duration-300">
                                        <p className="text-sm font-semibold text-foreground tracking-tight">
                                            You don't have any websocket streams
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground max-w-sm leading-relaxed">
                                            Websocket streams proxied through Aresius will be displayed here.
                                        </p>
                                        <Link
                                            to="/settings"
                                            className="mt-3 text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                                        >
                                            <Shield className="h-3 w-3" />
                                            Visit the CA Certificate Setup page to get started.
                                        </Link>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border/20">
                                        {filteredStreams.map((stream) => {
                                            const isSelected = stream.id === selectedStreamId;
                                            return (
                                                <div
                                                    key={stream.id}
                                                    onClick={() =>
                                                        projectId &&
                                                        dispatch(
                                                            setSelectedStreamId({
                                                                projectId,
                                                                streamId: stream.id,
                                                            })
                                                        )
                                                    }
                                                    className={`grid grid-cols-[50px_1fr_1fr_140px] items-center px-3 py-2 text-[12px] cursor-pointer transition-colors ${
                                                        isSelected
                                                            ? 'bg-primary/15 text-primary-foreground font-medium border-l-2 border-primary'
                                                            : 'hover:bg-muted/40 text-foreground'
                                                    }`}
                                                >
                                                    <div className="font-mono text-muted-foreground text-[11px]">
                                                        {stream.id}
                                                    </div>
                                                    <div className="font-mono truncate pr-2 text-foreground font-medium">
                                                        {stream.destination}
                                                    </div>
                                                    <div className="font-mono truncate pr-2 text-muted-foreground">
                                                        {stream.path || '/'}
                                                    </div>
                                                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                        <span className="tabular-nums">
                                                            {formatDateTime(stream.createdAt)}
                                                        </span>
                                                        <Badge
                                                            variant="outline"
                                                            className={`px-1 py-0 text-[9px] uppercase font-mono ${
                                                                stream.status === 'open'
                                                                    ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10'
                                                                    : 'border-muted text-muted-foreground'
                                                            }`}
                                                        >
                                                            {stream.status}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Top-Right: Messages List for Selected Stream */}
                        <ResizablePanel defaultSize={52} minSize={25} className="flex flex-col">
                            {/* Header bar */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20 text-xs">
                                <div className="flex items-center gap-2">
                                    <FileCode className="h-3.5 w-3.5 text-primary" />
                                    <span className="font-semibold text-foreground tracking-tight">Messages</span>
                                    {selectedStream && (
                                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-mono">
                                            {messages.length}
                                        </Badge>
                                    )}
                                </div>
                                {selectedStream && (
                                    <div className="relative">
                                        <Search className="h-3 w-3 absolute left-2 top-2 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Search messages…"
                                            value={messageSearch}
                                            onChange={(e) => setMessageSearch(e.target.value)}
                                            className="h-7 w-32 md:w-44 pl-7 pr-2 rounded-md bg-muted/40 text-[11px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary border border-border/30"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Column Header */}
                            {selectedStream && (
                                <div className="grid grid-cols-[45px_130px_75px_80px_1fr] px-3 py-1.5 border-b border-border/30 bg-muted/30 text-[11px] font-medium text-muted-foreground">
                                    <div>#</div>
                                    <div>Direction</div>
                                    <div>Type</div>
                                    <div>Length</div>
                                    <div>Time</div>
                                </div>
                            )}

                            {/* Messages Content */}
                            <div className="flex-1 overflow-y-auto">
                                {!selectedStream ? (
                                    <div className="flex items-center justify-center h-full p-6 text-center text-xs text-muted-foreground animate-in fade-in-50 duration-300 select-none">
                                        No stream selected
                                    </div>
                                ) : filteredMessages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full p-6 text-center text-xs text-muted-foreground animate-in fade-in-50 duration-300 select-none">
                                        <span>No messages in this stream yet</span>
                                        <span className="mt-1 text-[11px] text-muted-foreground/70">
                                            Messages sent or received will appear here in real time.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border/20">
                                        {filteredMessages.map((msg, idx) => {
                                            const isSelected = msg.id === selectedMessageId;
                                            const isClient = msg.direction === 'ClientToServer';
                                            return (
                                                <ContextMenu key={msg.id}>
                                                    <ContextMenuTrigger asChild>
                                                        <div
                                                            onClick={() =>
                                                                projectId &&
                                                                dispatch(
                                                                    setSelectedMessageId({
                                                                        projectId,
                                                                        messageId: msg.id,
                                                                    })
                                                                )
                                                            }
                                                            onContextMenu={() => {
                                                                if (projectId && selectedMessageId !== msg.id) {
                                                                    dispatch(
                                                                        setSelectedMessageId({
                                                                            projectId,
                                                                            messageId: msg.id,
                                                                        })
                                                                    );
                                                                }
                                                            }}
                                                            className={`grid grid-cols-[45px_130px_75px_80px_1fr] items-center px-3 py-1.5 text-[12px] cursor-pointer transition-colors ${
                                                                isSelected
                                                                    ? 'bg-primary/15 text-primary-foreground font-medium border-l-2 border-primary'
                                                                    : 'hover:bg-muted/40 text-foreground'
                                                            }`}
                                                        >
                                                            <div className="font-mono text-muted-foreground text-[11px]">
                                                                {idx + 1}
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                {isClient ? (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-blue-500/10 text-blue-500 text-[10px] font-medium">
                                                                        <ArrowUpRight className="h-3 w-3" />
                                                                        Client &rarr; Server
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-500 text-[10px] font-medium">
                                                                        <ArrowDownLeft className="h-3 w-3" />
                                                                        Server &rarr; Client
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <Badge
                                                                    variant="outline"
                                                                    className="text-[10px] px-1 py-0 font-mono"
                                                                >
                                                                    {msg.messageType}
                                                                </Badge>
                                                            </div>
                                                            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                                                {formatBytes(msg.payloadLength)}
                                                            </div>
                                                            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                                                {formatTime(msg.sentAt)}
                                                            </div>
                                                        </div>
                                                    </ContextMenuTrigger>
                                                    <ContextMenuContent className="w-52 text-xs">
                                                        <ContextMenuItem
                                                            onSelect={() => {
                                                                navigator.clipboard.writeText(msg.payload);
                                                                toast.success('Payload copied to clipboard');
                                                            }}
                                                        >
                                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                                            Copy payload
                                                        </ContextMenuItem>
                                                        <ContextMenuSeparator />
                                                        <ContextMenuItem
                                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                            onSelect={() => handleDeleteMessage(msg.streamId, msg.id)}
                                                        >
                                                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                                                            Delete message
                                                        </ContextMenuItem>
                                                        <ContextMenuItem
                                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                            onSelect={handleClearStreamMessages}
                                                        >
                                                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                                                            Delete all
                                                        </ContextMenuItem>
                                                    </ContextMenuContent>
                                                </ContextMenu>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Bottom Section: Dedicated "Message" Inspector Pane */}
                <ResizablePanel defaultSize={48} minSize={20} className="flex flex-col bg-background">
                    {/* Header Bar */}
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/20 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground tracking-tight px-1">Message</span>
                            {selectedMessage && (
                                <>
                                    <Badge
                                        variant="secondary"
                                        className={`text-[10px] px-1.5 py-0 ${
                                            selectedMessage.direction === 'ClientToServer'
                                                ? 'bg-blue-500/15 text-blue-500'
                                                : 'bg-emerald-500/15 text-emerald-500'
                                        }`}
                                    >
                                        {selectedMessage.direction === 'ClientToServer'
                                            ? 'Client → Server'
                                            : 'Server → Client'}
                                    </Badge>
                                    <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                                        <HardDrive className="h-3 w-3" />
                                        {formatBytes(selectedMessage.payloadLength)}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {formatTime(selectedMessage.sentAt)}
                                    </span>
                                </>
                            )}
                        </div>

                        {selectedMessage && (
                            <div className="flex items-center gap-1.5">
                                {/* View Mode Tabs */}
                                <div className="flex items-center bg-muted/40 rounded-md p-0.5 border border-border/30">
                                    <button
                                        onClick={() => setViewMode('pretty')}
                                        className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                            viewMode === 'pretty'
                                                ? 'bg-background text-foreground shadow-xs font-medium'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        Pretty
                                    </button>
                                    <button
                                        onClick={() => setViewMode('raw')}
                                        className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                            viewMode === 'raw'
                                                ? 'bg-background text-foreground shadow-xs font-medium'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        Raw
                                    </button>
                                    <button
                                        onClick={() => setViewMode('hex')}
                                        className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                            viewMode === 'hex'
                                                ? 'bg-background text-foreground shadow-xs font-medium'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        Hex
                                    </button>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCopy}
                                    className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3 w-3 text-emerald-500" />
                                            <span>Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3 w-3" />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Message Body Content */}
                    <div className="flex-1 min-h-0 overflow-hidden relative">
                        {!selectedMessage ? (
                            <div className="flex items-center justify-center h-full p-6 text-center text-xs text-muted-foreground animate-in fade-in-50 duration-300 select-none">
                                No message selected
                            </div>
                        ) : viewMode === 'hex' ? (
                            <div className="h-full overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground bg-muted/10 selection:bg-primary/20">
                                <pre className="whitespace-pre">{displayPayload}</pre>
                            </div>
                        ) : (
                            <div className="h-full w-full">
                                <CodeMirrorEditor
                                    value={displayPayload}
                                    isPretty={viewMode === 'pretty'}
                                />
                            </div>
                        )}
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};

export default WsHistoryPage;
