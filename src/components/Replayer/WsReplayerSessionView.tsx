import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import RequestCodeEditor from '@/components/Replayer/RequestCodeEditor';
import ResponseCodeEditor from '@/components/Replayer/ResponseCodeEditor';
import { ViewModeTabs } from '@/components/ViewModeTabs';
import { HttpStatusBadge } from '@/components/HttpStatusBadge';
import HttpRequestFormatWarning from '@/components/HttpRequestFormatWarning';
import { useReplayerEditor } from '@/context/ReplayerContext';
import { useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    selectActiveWsStatus,
    selectActiveWsMessages,
} from '@/store/slices/replayerSlice';
import { ReplayerWsMessage } from '@/types/replayer.type';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
    Copy,
    Check,
    SendHorizonal,
    Search,
    X,
    Clock,
    Cable,
} from 'lucide-react';

function formatMessageTime(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export const WsReplayerSessionView: React.FC = () => {
    const projectId = useProjectId();
    const {
        activeDraft,
        activeHistoryItem,
        selectedHistoryIndex,
        reqViewMode,
        resViewMode,
        setReqViewMode,
        setResViewMode,
        activeStatus,
        autoScroll,
    } = useReplayerEditor();

    const sessionId = activeDraft?.sessionId;
    const wsStatus = useAppSelector(selectActiveWsStatus(projectId, sessionId));
    const liveMessages = useAppSelector(selectActiveWsMessages(projectId, sessionId));

    const [activeTab, setActiveTab] = useState<'upgrade' | 'messages'>('messages');
    const [filterQuery, setFilterQuery] = useState('');
    const [messageDraft, setMessageDraft] = useState('');
    const [historicalMessages, setHistoricalMessages] = useState<ReplayerWsMessage[] | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    // Fetch historical messages if viewing a previous connection in history, or if index 0 has no live messages in memory
    useEffect(() => {
        let isMounted = true;
        if (
            selectedHistoryIndex !== null &&
            activeHistoryItem?.id &&
            (selectedHistoryIndex > 0 || (wsStatus !== 'connected' && liveMessages.length === 0))
        ) {
            invoke<ReplayerWsMessage[]>('get_replayer_ws_messages', { historyId: activeHistoryItem.id })
                .then((msgs) => {
                    if (isMounted) setHistoricalMessages(msgs);
                })
                .catch((err) => console.error('Failed to load past connection messages:', err));
        } else {
            setHistoricalMessages(null);
        }
        return () => {
            isMounted = false;
        };
    }, [selectedHistoryIndex, activeHistoryItem?.id, wsStatus, liveMessages.length]);

    // Active displayed messages list
    const displayedMessages = useMemo(() => {
        return historicalMessages !== null ? historicalMessages : liveMessages;
    }, [historicalMessages, liveMessages]);

    // Filter messages by query
    const filteredMessages = useMemo(() => {
        if (!filterQuery.trim()) return displayedMessages;
        const q = filterQuery.toLowerCase();
        return displayedMessages.filter(
            (m) =>
                m.payload.toLowerCase().includes(q) ||
                m.direction.toLowerCase().includes(q) ||
                m.messageType.toLowerCase().includes(q)
        );
    }, [displayedMessages, filterQuery]);

    // Auto-scroll on new messages when at bottom if autoScroll is enabled
    useEffect(() => {
        if (autoScroll && activeTab === 'messages' && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [displayedMessages.length, activeTab, autoScroll]);

    const handleSendMessage = async () => {
        if (!sessionId || !projectId || !messageDraft.trim()) return;
        if (wsStatus !== 'connected') {
            toast.warning('Cannot send message: WebSocket is not connected');
            return;
        }

        const payload = messageDraft;
        setMessageDraft('');

        try {
            await invoke('send_replayer_ws_message', {
                sessionId,
                payload,
                messageType: 'Text',
            });
        } catch (err: any) {
            console.error('Failed to send WebSocket message:', err);
            toast.error(`Send error: ${err}`);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleCopyPayload = (payload: string, idx: number) => {
        navigator.clipboard.writeText(payload);
        setCopiedIndex(idx);
        toast.success('Payload copied to clipboard');
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const isConnected = wsStatus === 'connected';

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
            {/* Sub-header tabs: HTTP Upgrade & Messages */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-card/60 select-none shrink-0">
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center bg-muted/40 p-0.5 rounded-md border border-border/30">
                        <button
                            type="button"
                            onClick={() => setActiveTab('upgrade')}
                            className={`px-2.5 py-1 text-xs rounded-sm transition-colors font-medium ${
                                activeTab === 'upgrade'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            HTTP Upgrade
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('messages')}
                            className={`px-2.5 py-1 text-xs rounded-sm transition-colors font-medium flex items-center gap-1.5 ${
                                activeTab === 'messages'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <span>Messages</span>
                            {displayedMessages.length > 0 && (
                                <Badge variant="secondary" className="px-1 py-0 text-[10px] font-mono h-4">
                                    {displayedMessages.length}
                                </Badge>
                            )}
                        </button>
                    </div>

                    {/* Status Indicator Pill */}
                    <div className="flex items-center gap-1.5 ml-2">
                        <span
                            className={`h-2 w-2 rounded-full ${
                                wsStatus === 'connected'
                                    ? 'bg-emerald-500 animate-pulse'
                                    : wsStatus === 'connecting'
                                    ? 'bg-amber-500 animate-pulse'
                                    : 'bg-muted-foreground/40'
                            }`}
                        />
                        <span className="text-[11px] font-mono capitalize text-muted-foreground">
                            {wsStatus}
                        </span>
                    </div>
                </div>

                {activeTab === 'upgrade' && (
                    <div className="flex items-center gap-3 text-xs">
                        {activeStatus && <HttpStatusBadge status={activeStatus} />}
                        {activeHistoryItem?.responseTime !== undefined && activeHistoryItem.responseTime > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                                <Clock className="w-3 h-3 text-muted-foreground/70" />
                                {activeHistoryItem.responseTime} ms
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Main Tab Content */}
            {activeTab === 'upgrade' ? (
                /* HTTP Upgrade Request & Response Split View */
                <ResizablePanelGroup direction="horizontal" autoSaveId="ws-replayer-upgrade-split" className="flex-1 min-h-0">
                    <ResizablePanel defaultSize={50} minSize={20}>
                        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                        Upgrade Request
                                    </span>
                                    <HttpRequestFormatWarning rawRequest={activeDraft?.requestTmp} />
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <ViewModeTabs mode={reqViewMode} onChange={setReqViewMode} />
                                </div>
                            </div>
                            <div className="flex-1 min-h-0">
                                <RequestCodeEditor />
                            </div>
                        </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    <ResizablePanel defaultSize={50} minSize={20}>
                        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                        Upgrade Response
                                    </span>
                                    {activeStatus && <HttpStatusBadge status={activeStatus} />}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <ViewModeTabs mode={resViewMode} onChange={setResViewMode} />
                                </div>
                            </div>
                            <div className="flex-1 min-h-0">
                                <ResponseCodeEditor />
                            </div>
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            ) : (
                /* Messages View: Live Message Feed + Resizable Bottom Editor */
                <ResizablePanelGroup direction="vertical" autoSaveId="ws-replayer-messages-split" className="flex-1 min-h-0">
                    {/* Top Pane: Message Feed */}
                    <ResizablePanel defaultSize={68} minSize={25} className="flex flex-col min-h-0 bg-background">
                        <div className="flex-1 overflow-y-auto p-2 font-mono text-xs select-text">
                            {filteredMessages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground/60 select-none p-6">
                                    <Cable className="w-8 h-8 mb-2 opacity-30" />
                                    <p className="text-xs font-medium">
                                        {wsStatus === 'connected'
                                            ? 'Connected! Send a message below to start communicating.'
                                            : 'No messages yet in this WebSocket connection.'}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground/40 mt-1">
                                        Messages sent (→) and received (←) will appear here in real time.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    {filteredMessages.map((msg, idx) => {
                                        const isIncoming = msg.direction === 'ServerToClient';
                                        return (
                                            <div
                                                key={msg.id || idx}
                                                className="group flex items-start justify-between py-1 px-2 rounded-sm hover:bg-muted/30 transition-colors gap-3"
                                            >
                                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                                    {isIncoming ? (
                                                        <span className="text-emerald-500 font-bold shrink-0 text-sm select-none" title="Server → Client">
                                                            ←
                                                        </span>
                                                    ) : (
                                                        <span className="text-rose-500 font-bold shrink-0 text-sm select-none" title="Client → Server">
                                                            →
                                                        </span>
                                                    )}
                                                    <span
                                                        className={`whitespace-pre-wrap break-all leading-relaxed ${
                                                            isIncoming ? 'text-emerald-400 dark:text-emerald-400' : 'text-rose-400 dark:text-rose-400'
                                                        }`}
                                                    >
                                                        {msg.payload}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0 select-none pt-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyPayload(msg.payload, idx)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 rounded"
                                                        title="Copy payload"
                                                    >
                                                        {copiedIndex === idx ? (
                                                            <Check className="w-3 h-3 text-emerald-500" />
                                                        ) : (
                                                            <Copy className="w-3 h-3" />
                                                        )}
                                                    </button>
                                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                                                        {formatMessageTime(msg.sentAt)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Bottom Pane: Search/StreamQL Bar + Message Editor + Send Button */}
                    <ResizablePanel defaultSize={32} minSize={18} className="flex flex-col min-h-0 bg-card border-t border-border/40">
                        {/* StreamQL / Search Filter Bar */}
                        <div className="p-1.5 border-b border-border/30 bg-muted/20 shrink-0">
                            <div className="relative flex items-center">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                                <Input
                                    value={filterQuery}
                                    onChange={(e) => setFilterQuery(e.target.value)}
                                    placeholder="Enter a StreamQL query..."
                                    className="h-7 text-xs font-mono pl-8 pr-7 bg-muted/30 border-border/30 rounded-md focus-visible:ring-1 focus-visible:ring-primary/40"
                                />
                                {filterQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setFilterQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-0.5 rounded"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Editor Area with Send Button */}
                        <div className="flex-1 min-h-0 relative flex flex-col">
                            <div className="flex-1 flex min-h-0 relative">
                                {/* Line Number Gutter */}
                                <div className="w-8 py-2 bg-muted/10 border-r border-border/20 text-muted-foreground/40 font-mono text-xs text-right pr-2 select-none">
                                    1
                                </div>
                                <textarea
                                    value={messageDraft}
                                    onChange={(e) => setMessageDraft(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Enter a websocket message..."
                                    className="flex-1 h-full p-2 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/50 resize-none outline-none focus:ring-0 leading-relaxed"
                                    disabled={!isConnected}
                                />
                            </div>

                            {/* Bottom Bar: Shortcut hint and Rose Send Button */}
                            <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/30 bg-muted/10 shrink-0 select-none">
                                <span className="text-[10px] text-muted-foreground/60 font-mono">
                                    {isConnected
                                        ? 'Press Ctrl+Enter to send'
                                        : 'Connect to target before sending messages'}
                                </span>

                                <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                onClick={handleSendMessage}
                                                disabled={!isConnected || !messageDraft.trim()}
                                                size="sm"
                                                className="h-7 w-7 p-0 bg-rose-600 hover:bg-rose-700 text-white shadow-xs rounded shrink-0 cursor-pointer disabled:opacity-40"
                                            >
                                                <SendHorizonal className="w-3.5 h-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-[11px] py-0.5 px-2">
                                            Send message (Ctrl+Enter)
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            )}
        </div>
    );
};

export default WsReplayerSessionView;
