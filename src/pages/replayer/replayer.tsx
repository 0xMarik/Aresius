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
import { AlertTriangle, Clock, CornerDownRight, HardDrive, Loader2, Play, Plus, Repeat, Square } from "lucide-react";
import ReplayerSession from "@/components/Replayer/ReplayerSession";
import ReplayerSettingsPopover from "@/components/Replayer/ReplayerSettingsPopover";
import HttpRequestFormatWarning from "@/components/HttpRequestFormatWarning";
import { ReplayerProvider, useReplayerEditor, useReplayerTree } from "@/context/ReplayerContext";
import { splitHttpMessage, getRedirectionInfo } from "@/components/utils";
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { resetReplayerReceivedSession } from '@/store/slices/replayerSlice';

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
                                onChange={(url, urlIsValid) => {
                                    updateDraftUrl(url, urlIsValid);
                                }}
                            />
                            <ReplayerSettingsPopover />
                            {responseLoading ? (
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
                            )}

                            <HistoryRequests />
                        </div>
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