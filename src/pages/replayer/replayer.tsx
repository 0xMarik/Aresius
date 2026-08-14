import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EmptyState } from '@/components/ui/empty-state';
import { ValidateUrlInput } from "@/components/ValidateUrlInput";
import HistoryRequests, { getStatusBadgeStyle } from "@/components/Replayer/HistoryRequests";
import RequestCodeEditor from "@/components/Replayer/RequestCodeEditor";
import ResponseCodeEditor from "@/components/Replayer/ResponseCodeEditor";
import { AlertTriangle, Loader2, Play, Plus, Repeat, Square } from "lucide-react";
import ReplayerSession from "@/components/Replayer/ReplayerSession";
import { ReplayerProvider, useReplayerEditor, useReplayerTree } from "@/context/ReplayerContext";
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { resetReplayerReceivedSession } from '@/store/slices/replayerSlice';
import { cn } from "@/lib/utils";

function ReplayerContent() {
    const projectId = useProjectId();
    const dispatch = useAppDispatch();

    const {
        collections,
        selectedCollectionId,
        createSession,
        createCollection,
    } = useReplayerTree();

    const {
        selectedSessionId,
        activeDraft,
        responseLoading,
        activeHistoryItem,
        activeStatus,
        hasError,
        errorMessage,
        updateDraftUrl,
        triggerReplay,
        cancelReplay,
    } = useReplayerEditor();

    useEffect(() => {
        if (projectId) {
            dispatch(resetReplayerReceivedSession(projectId));
        }
    }, [dispatch, projectId]);

    const totalSessions = collections.reduce((acc, c) => acc + c.sessions.length, 0);
    const hasNoSessionsAtAll = totalSessions === 0;
    const noSessionSelected = !selectedSessionId || !activeDraft;

    const handleCreateSession = () => {
        const targetColId = selectedCollectionId || collections[0]?.id;
        if (targetColId) {
            createSession(targetColId);
        } else {
            createCollection().then(() => {
                if (collections[0]?.id) {
                    createSession(collections[0].id);
                }
            });
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
                        <div className="flex items-center h-12 bg-card/40 gap-3 shrink-0 p-2">
                            <ValidateUrlInput
                                url={activeDraft?.url || ""}
                                onChange={(url, urlIsValid) => {
                                    updateDraftUrl(url, urlIsValid);
                                }}
                            />
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
                                    disabled={activeDraft?.urlIsValid === false}
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
                                        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Request</span>
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
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Response</span>
                                            {activeStatus && (
                                                <Badge
                                                    variant="outline"
                                                    className={cn("text-[10px] font-mono px-1.5 py-0 font-medium capitalize", getStatusBadgeStyle(activeStatus))}
                                                >
                                                    {activeStatus}
                                                </Badge>
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
                                        </div>
                                        {activeHistoryItem?.responseTime !== undefined && activeHistoryItem.responseTime > 0 && (
                                            <span className="text-[11px] font-mono text-muted-foreground">
                                                {activeHistoryItem.responseTime} ms
                                            </span>
                                        )}
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