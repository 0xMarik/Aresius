import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EmptyState } from '@/components/ui/empty-state';
import { ValidateUrlInput } from "@/components/ValidateUrlInput";
import HistoryRequests from "@/components/Replayer/HistoryRequests";
import { HttpStatusBadge } from "@/components/HttpStatusBadge";
import { ViewModeTabs } from "@/components/ViewModeTabs";
import RequestCodeEditor from "@/components/Replayer/RequestCodeEditor";
import ResponseCodeEditor from "@/components/Replayer/ResponseCodeEditor";
import { AlertTriangle, Cable, Clock, CornerDownRight, HardDrive, Loader2, Play, Plus, Repeat, Square, Unplug } from "lucide-react";
import ReplayerSession from "@/components/Replayer/ReplayerSession";
import ReplayerSettingsPopover from "@/components/Replayer/ReplayerSettingsPopover";
import HttpRequestFormatWarning from "@/components/HttpRequestFormatWarning";
import { ReplayerProvider, useReplayerEditor, useReplayerTree } from "@/context/ReplayerContext";
import { splitHttpMessage, getRedirectionInfo } from "@/components/utils";
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    resetReplayerReceivedSession,
    selectActiveWsStatus,
    setWsStatus,
    addWsMessage,
    clearWsMessages,
    addSessionHistoryItem,
    updateSessionHistoryItemStatus,
} from '@/store/slices/replayerSlice';
import WsReplayerSessionView from '@/components/Replayer/WsReplayerSessionView';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

function ReplayerContent() {
    const projectId = useProjectId();
    const dispatch = useAppDispatch();

    const {
        collections,
        selectedCollectionId,
        createSession,
        createCollection,
        isLoaded,
    } = useReplayerTree();

    const {
        selectedSessionId,
        activeDraft,
        responseLoading,
        activeHistoryItem,
        activeStatus,
        hasError,
        errorMessage,
        reqViewMode,
        resViewMode,
        setReqViewMode,
        setResViewMode,
        updateDraftUrl,
        triggerReplay,
        followRedirection,
        cancelReplay,
    } = useReplayerEditor();

    useEffect(() => {
        if (projectId) {
            dispatch(resetReplayerReceivedSession(projectId));
        }
    }, [dispatch, projectId]);

    const isWs = activeDraft?.sessionType === 'ws';
    const wsStatus = useAppSelector(selectActiveWsStatus(projectId, activeDraft?.sessionId));

    // Register WebSocket event listeners
    useEffect(() => {
        let unlistenConnected: (() => void) | undefined;
        let unlistenMsg: (() => void) | undefined;
        let unlistenClosed: (() => void) | undefined;

        async function setupListeners() {
            unlistenConnected = await listen<{
                sessionId: string;
                historyId: string;
                baseUrl: string;
                requestRaw: string;
                responseRaw: string;
                status: string;
                createdAt: string;
            }>('replayer_ws_connected', (event) => {
                const { sessionId, historyId, baseUrl, requestRaw, responseRaw, status, createdAt } = event.payload;
                if (projectId) {
                    dispatch(setWsStatus({ projectId, sessionId, status: 'connected' }));
                    dispatch(clearWsMessages({ projectId, sessionId }));
                    dispatch(addSessionHistoryItem({
                        projectId,
                        sessionId,
                        item: {
                            id: historyId,
                            requestRaw,
                            responseRaw,
                            responseTime: 0,
                            requestTime: 0,
                            createdAt,
                            status,
                            errorMessage: null,
                            baseUrl,
                        },
                    }));
                }
            });

            unlistenMsg = await listen<{
                sessionId: string;
                historyId: string;
                id: number;
                direction: 'ServerToClient' | 'ClientToServer';
                messageType: string;
                payload: string;
                payloadLength: number;
                sentAt: number;
            }>('replayer_ws_message', (event) => {
                const { sessionId, historyId, id, direction, messageType, payload, payloadLength, sentAt } = event.payload;
                if (projectId) {
                    dispatch(addWsMessage({
                        projectId,
                        sessionId,
                        message: {
                            id,
                            historyId,
                            direction: direction as 'ServerToClient' | 'ClientToServer',
                            messageType: messageType as 'Text' | 'Binary' | 'Ping' | 'Pong' | 'Close',
                            payload,
                            payloadLength,
                            sentAt,
                        },
                    }));
                }
            });

            unlistenClosed = await listen<{
                sessionId: string;
                historyId: string;
                status: string;
                errorMessage?: string;
            }>('replayer_ws_closed', (event) => {
                const { sessionId, historyId, status, errorMessage } = event.payload;
                if (projectId) {
                    dispatch(setWsStatus({ projectId, sessionId, status: 'closed' }));
                    dispatch(updateSessionHistoryItemStatus({
                        projectId,
                        sessionId,
                        historyId,
                        status,
                        errorMessage: errorMessage ?? null,
                    }));
                }
            });
        }

        setupListeners();

        return () => {
            if (unlistenConnected) unlistenConnected();
            if (unlistenMsg) unlistenMsg();
            if (unlistenClosed) unlistenClosed();
        };
    }, [dispatch, projectId]);

    const handleConnectWs = async () => {
        if (!activeDraft?.sessionId || !projectId) return;
        dispatch(setWsStatus({ projectId, sessionId: activeDraft.sessionId, status: 'connecting' }));
        try {
            await invoke('connect_replayer_ws', {
                sessionId: activeDraft.sessionId,
                url: activeDraft.url,
                requestTmp: activeDraft.requestTmp,
            });
        } catch (err: any) {
            console.error('Failed to connect WebSocket:', err);
            const errMsg = typeof err === 'string' ? err : err?.message || 'Failed to connect';
            toast.error(errMsg);
            dispatch(setWsStatus({ projectId, sessionId: activeDraft.sessionId, status: 'error' }));
        }
    };

    const handleDisconnectWs = async () => {
        if (!activeDraft?.sessionId || !projectId) return;
        dispatch(setWsStatus({ projectId, sessionId: activeDraft.sessionId, status: 'closed' }));
        try {
            await invoke('disconnect_replayer_ws', { sessionId: activeDraft.sessionId });
        } catch (err) {
            console.error('Failed to disconnect WebSocket:', err);
        }
    };

    const parsedRes = useMemo(
        () => splitHttpMessage(activeHistoryItem?.responseRaw ?? ''),
        [activeHistoryItem?.responseRaw]
    );

    const redirectInfo = useMemo(
        () => getRedirectionInfo(activeHistoryItem?.responseRaw),
        [activeHistoryItem?.responseRaw]
    );

    const responseLength = useMemo(() => {
        if (!activeHistoryItem?.responseRaw) return 0;
        return new TextEncoder().encode(activeHistoryItem.responseRaw).length;
    }, [activeHistoryItem?.responseRaw]);

    const resContentType = useMemo(() => {
        const ctHeader = parsedRes.headersList.find((h) => h.name.toLowerCase() === 'content-type');
        if (!ctHeader) return '';
        const rawCt = ctHeader.value.split(';')[0].trim();
        return rawCt.replace(/^application\//i, '').replace(/^text\//i, '');
    }, [parsedRes.headersList]);

    if (!isLoaded) {
        return null;
    }

    const totalSessions = collections.reduce((acc, c) => acc + c.sessions.length, 0);
    const hasNoSessionsAtAll = totalSessions === 0;
    const noSessionSelected = !selectedSessionId || !activeDraft;

    const isSendDisabled = !activeDraft?.url || !activeDraft.url.trim() || activeDraft.url === 'https://' || activeDraft.urlIsValid === false;
    const isConnectDisabled = !activeDraft?.url || !activeDraft.url.trim() || activeDraft.urlIsValid === false || wsStatus === 'connecting';

    const handleCreateSession = async () => {
        const targetColId = selectedCollectionId || collections[0]?.id;
        if (targetColId) {
            await createSession(targetColId);
        } else {
            const newColId = await createCollection();
            if (newColId) {
                await createSession(newColId);
            }
        }
    };

    return (
        <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-repeater-layout">
            <ResizablePanel defaultSize={15} minSize={13} maxSize={50}>
                <ReplayerSession />
            </ResizablePanel>

            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={85} minSize={20}>
                {noSessionSelected ? (
                    <EmptyState
                        icon={Repeat}
                        title={hasNoSessionsAtAll ? "No Replayer Sessions" : "No Replayer Session Selected"}
                        description={
                            hasNoSessionsAtAll
                                ? "You don't have any sessions in your collections. Create a new session to start replaying HTTP requests."
                                : "Select an existing session from the collection tree on the left or create a new session."
                        }
                        action={
                            <Button
                                size="sm"
                                onClick={handleCreateSession}
                                variant={hasNoSessionsAtAll ? "default" : "outline"}
                                className="gap-1.5 font-medium text-xs shadow-xs"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                {hasNoSessionsAtAll ? "Create Session" : "New Session"}
                            </Button>
                        }
                    />
                ) : (
                    <div className="h-full flex flex-col">
                        <div className="flex items-center h-12 bg-card/40 gap-3 shrink-0 p-2 border-b border-border/40">
                            <ValidateUrlInput
                                url={activeDraft?.url || ""}
                                protocol={isWs ? "ws" : "http"}
                                onChange={(url, urlIsValid) => {
                                    updateDraftUrl(url, urlIsValid);
                                }}
                            />
                            <ReplayerSettingsPopover />
                            {isWs ? (
                                wsStatus === 'connected' ? (
                                    <Button
                                        onClick={handleDisconnectWs}
                                        variant="destructive"
                                        size="sm"
                                        className="h-8 font-semibold gap-1.5 shrink-0"
                                    >
                                        <Unplug className="w-3.5 h-3.5" />
                                        DISCONNECT
                                    </Button>
                                ) : wsStatus === 'connecting' ? (
                                    <Button
                                        onClick={handleDisconnectWs}
                                        variant="destructive"
                                        size="sm"
                                        className="h-8 font-semibold gap-1.5 shrink-0"
                                    >
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        CANCEL
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={handleConnectWs}
                                        size="sm"
                                        disabled={isConnectDisabled}
                                        className="h-8 font-semibold gap-1.5 shrink-0 bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer"
                                    >
                                        <Cable className="w-3.5 h-3.5" />
                                        CONNECT
                                    </Button>
                                )
                            ) : (
                                responseLoading ? (
                                    <Button
                                        onClick={cancelReplay}
                                        variant="destructive"
                                        size="sm"
                                        className="h-8 font-semibold gap-1.5 shrink-0"
                                    >
                                        <Square className="w-3.5 h-3.5 fill-current" />
                                        CANCEL
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={triggerReplay}
                                        size="sm"
                                        disabled={isSendDisabled}
                                        className="h-8 font-semibold gap-1.5 shrink-0"
                                    >
                                        <Play className="w-3.5 h-3.5 fill-current" />
                                        SEND
                                    </Button>
                                )
                            )}

                            <HistoryRequests />
                        </div>
                        {isWs ? (
                            <WsReplayerSessionView />
                        ) : (
                            <ResizablePanelGroup direction="horizontal" autoSaveId="repeater-req-res" className="flex-1 min-h-0">
                                <ResizablePanel defaultSize={50} minSize={20}>
                                    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
                                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Request</span>
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
                                                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Response</span>
                                                {activeStatus && (
                                                    <HttpStatusBadge status={activeStatus} />
                                                )}
                                                {redirectInfo?.isRedirect && (
                                                    <TooltipProvider>
                                                        <Tooltip delayDuration={150}>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={followRedirection}
                                                                    disabled={responseLoading}
                                                                    className="h-5 px-1.5 text-[11px] font-medium gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border-amber-500/30 shadow-none hover:text-amber-600 dark:hover:text-amber-300 shrink-0 cursor-pointer"
                                                                >
                                                                    <CornerDownRight className="w-3 h-3" />
                                                                    Follow Redirection
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent
                                                                side="bottom"
                                                                align="start"
                                                                className="max-w-md bg-popover text-popover-foreground border border-border shadow-lg p-2.5 text-xs select-text z-50 font-sans"
                                                            >
                                                                <div className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400 mb-1">
                                                                    <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
                                                                    <span>Redirect Location ({redirectInfo.statusCode})</span>
                                                                </div>
                                                                <p className="font-mono text-[11px] text-muted-foreground break-all">
                                                                    {redirectInfo.location}
                                                                </p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                                {hasError && (
                                                    <TooltipProvider>
                                                        <Tooltip delayDuration={150}>
                                                            <TooltipTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center justify-center text-rose-500 hover:text-rose-400 transition-colors p-0.5 rounded focus:outline-none focus:ring-1 focus:ring-rose-500/50"
                                                                >
                                                                    <AlertTriangle className="w-3.5 h-3.5" />
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent
                                                                side="bottom"
                                                                align="start"
                                                                className="max-w-sm bg-popover text-popover-foreground border border-border shadow-lg p-3 text-xs select-text z-50"
                                                            >
                                                                <div className="flex items-center gap-1.5 font-semibold text-rose-500 mb-1.5">
                                                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                                                    <span>Request Error</span>
                                                                </div>
                                                                <p className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                                                                    {errorMessage || "An error occurred while sending the request."}
                                                                </p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                                {activeHistoryItem?.responseTime !== undefined && activeHistoryItem.responseTime > 0 && (
                                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                                                        <Clock className="w-3 h-3 text-muted-foreground/70" />
                                                        {activeHistoryItem.responseTime} ms
                                                    </span>
                                                )}
                                                {responseLength > 0 && (
                                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                                                        <HardDrive className="w-3 h-3 text-muted-foreground/70" />
                                                        {responseLength} B
                                                    </span>
                                                )}
                                                {resContentType && (
                                                    <Badge variant="outline" className="text-[9px] uppercase px-1.5 py-0 h-4 border-border/60 text-muted-foreground">
                                                        {resContentType}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <ViewModeTabs mode={resViewMode} onChange={setResViewMode} />
                                            </div>
                                        </div>
                                        <div className="flex-1 min-h-0">
                                            {responseLoading ? (
                                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2">
                                                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                                    <span>Replaying HTTP Request...</span>
                                                </div>
                                            ) : (
                                                <ResponseCodeEditor />
                                            )}
                                        </div>
                                    </div>
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        )}
                    </div>
                )}
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default function Replayer() {
    return (
        <ReplayerProvider>
            <ReplayerContent />
        </ReplayerProvider>
    );
}