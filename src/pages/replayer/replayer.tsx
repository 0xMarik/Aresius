import { basicSetup, EditorView } from "codemirror";
import './replayer.style.css'
import { EditorState, } from '@codemirror/state';
import { useEffect, useRef } from 'react'
import { http } from '@/components/http-parser.component';
import { oneDark } from '@codemirror/theme-one-dark';
import { getCodeMirrorScrollTheme } from '@/components/codemirror-scroll.theme';
import { useTheme } from '@/components/theme-provider';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { addReplayerHistory, fetchReplayerData, resetReplayerReceivedSession, selectedHisotryIndex, setReaplayerURL, selectReplayerState } from '@/store/slices/replayerSlice';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { invoke } from '@tauri-apps/api/core';
import { ReplayerHistoryItem } from '@/types/replayer.type';
import React from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EmptyState } from '@/components/ui/empty-state';
import { stripPath, ValidateUrlInput } from "@/components/ValidateUrlInput";
import HistoryRequests, { getStatusBadgeStyle } from "@/components/Replayer/HistoryRequests";
import RequestCodeEditor from "@/components/Replayer/RequestCodeEditor";
import { AlertTriangle, Loader2, Play, Repeat, Square } from "lucide-react";
import ReplayerSession from "@/components/Replayer/ReplayerSession";
import { parseResponse } from "@/components/utils";
import { cn } from "@/lib/utils";

const fullHeightTheme = EditorView.theme({
    '&': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    '.cm-scroller': {
        flex: 1,
        overflow: 'auto',
    },
});

const ResponseCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { theme } = useTheme();
    const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const projectId = useProjectId();
    const { collections, selectedCollectionIndex } = useAppSelector(selectReplayerState(projectId));
    const collection = collections[selectedCollectionIndex];
    const selectedSessionIndex = collection?.selectedSessionIndex ?? null;
    const session = selectedSessionIndex !== null && collection
        ? collection.sessions[selectedSessionIndex]
        : null;
    const history = session?.history ?? [];
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;

    useEffect(() => {
        if (!editorRef.current) return;
        if (selectedSessionIndex === null) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const state = EditorState.create({
            doc: selectedHistoryIndex !== null && history[selectedHistoryIndex]
                ? history[selectedHistoryIndex].responseRaw
                : "",
            extensions: [
                basicSetup,
                http(),
                ...(isDark ? [oneDark] : []),
                fullHeightTheme,
                getCodeMirrorScrollTheme(isDark),
                EditorView.lineWrapping,
                EditorState.readOnly.of(true),
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [history, selectedHistoryIndex, selectedCollectionIndex, selectedSessionIndex, isDark]);

    return (
        <div ref={editorRef} className="h-full w-full">
        </div>
    )
}

function Replayer() {

    const projectId = useProjectId();
    const { collections, selectedCollectionIndex } = useAppSelector(selectReplayerState(projectId));
    const collection = collections[selectedCollectionIndex];
    const selectedSessionIndex = collection?.selectedSessionIndex ?? null;
    const session = selectedSessionIndex !== null && collection
        ? collection.sessions[selectedSessionIndex]
        : null;

    const url = session?.url ?? "";
    const requestTmp = session?.requestTmp ?? "";
    const history = session?.history ?? [];
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;

    const [responseLoading, setResponseLoading] = React.useState<boolean>(false);
    const activeRequestIdRef = useRef<string | null>(null);
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (projectId) {
            dispatch(fetchReplayerData(projectId));
            dispatch(resetReplayerReceivedSession(projectId));
        }
    }, [dispatch, projectId]);

    const triggerRequest = async () => {
        if (selectedSessionIndex === null || !projectId) return; // no active session, nothing to run

        const reqId = crypto.randomUUID();
        activeRequestIdRef.current = reqId;
        setResponseLoading(true);

        const stripedUrl = stripPath(url);
        dispatch(setReaplayerURL({ url: stripedUrl, urlIsValid: true, projectId })); // update the url in the store to be stripped of path
        try {
            const response = await invoke<ReplayerHistoryItem>('replay_request', {
                requestTmp: requestTmp,
                url: stripedUrl,
                reqId,
            });
            if (activeRequestIdRef.current === reqId) {
                setResponseLoading(false);
                activeRequestIdRef.current = null;
                const parsed = parseResponse(response.responseRaw);
                const statusCodeStr = parsed.statusCode
                    ? `${parsed.statusCode}${parsed.statusText ? ' ' + parsed.statusText : ''}`
                    : '200 OK';
                const itemWithStatus: ReplayerHistoryItem = {
                    ...response,
                    status: statusCodeStr,
                    errorMessage: null,
                };
                dispatch(addReplayerHistory({ historyItem: itemWithStatus, projectId }));
                dispatch(selectedHisotryIndex({ historyIndex: 0, projectId }));
            }
        } catch (error) {
            if (activeRequestIdRef.current === reqId) {
                console.error('Error replaying request:', error);
                setResponseLoading(false);
                activeRequestIdRef.current = null;
                const errStr = typeof error === 'string' ? error : (error as any)?.message || 'Request failed';
                const isCanceled = errStr.toLowerCase().includes('cancel');
                const errorItem: ReplayerHistoryItem = {
                    requestRaw: requestTmp,
                    responseRaw: "",
                    baseUrl: stripedUrl,
                    responseTime: 0,
                    status: isCanceled ? 'Canceled' : 'Error',
                    errorMessage: isCanceled ? null : errStr,
                };
                dispatch(addReplayerHistory({ historyItem: errorItem, projectId }));
                dispatch(selectedHisotryIndex({ historyIndex: 0, projectId }));
            }
        }
    };

    const handleCancelRequest = async () => {
        const reqId = activeRequestIdRef.current;
        activeRequestIdRef.current = null;
        setResponseLoading(false);
        if (reqId) {
            try {
                await invoke('cancel_replayer_request', { reqId });
            } catch (e) {
                console.error('Failed to cancel replayer request:', e);
            }
            const cancelItem: ReplayerHistoryItem = {
                requestRaw: requestTmp,
                responseRaw: "",
                baseUrl: stripPath(url),
                responseTime: 0,
                status: 'Canceled',
                errorMessage: null,
            };
            dispatch(addReplayerHistory({ historyItem: cancelItem, projectId }));
            dispatch(selectedHisotryIndex({ historyIndex: 0, projectId }));
        }
    };

    const noSessionSelected = selectedSessionIndex === null;

    const currentHistoryItem = selectedHistoryIndex !== null ? history[selectedHistoryIndex] : null;
    const parsedResponse = currentHistoryItem?.responseRaw ? parseResponse(currentHistoryItem.responseRaw) : null;
    const currentStatus = responseLoading
        ? 'pending'
        : (currentHistoryItem?.status || (parsedResponse?.statusCode ? String(parsedResponse.statusCode) : ''));
    const hasError = !responseLoading && (currentHistoryItem?.status === 'Error' || !!currentHistoryItem?.errorMessage);

    return (
        <ResizablePanelGroup direction='horizontal' autoSaveId="aresius-repeater-layout" >
            <ResizablePanel defaultSize={15} minSize={13} maxSize={50}>
                <ReplayerSession collections={collections} />
            </ResizablePanel>

            <ResizableHandle withHandle />
            {/* <ResizableHandle
                withHandle
                className="hover:bg-primary [&:hover>div]:bg-primary [&:hover>div]:border-primary [&:hover>div>svg]:text-primary-foreground"
            /> */}
            <ResizablePanel defaultSize={85} minSize={20}>
                {noSessionSelected ? (
                    <EmptyState
                        icon={Repeat}
                        title="No Replayer Session Selected"
                        description="Select an existing session from the collection tree or click 'New Session' to start replaying HTTP requests."
                    />
                ) : (
                    <div className='h-full flex flex-col'>
                        <div className='flex items-center h-12 bg-card/40 gap-3 shrink-0 p-2'>
                            {/* <Input placeholder='Enter URL to replay...' className='flex-1 font-mono text-xs h-8 bg-background'
                                value={url}
                                onChange={(event) => dispatch(setReaplayerURL({ url: event.target.value }))}
                            /> */}
                            <ValidateUrlInput url={session?.url || ""} onChange={(url, urlIsValid) => {
                                if (projectId) dispatch(setReaplayerURL({ url, urlIsValid, projectId }));
                            }} />
                            {responseLoading ? (
                                <Button
                                    onClick={handleCancelRequest}
                                    variant="destructive"
                                    size="sm"
                                    className="h-8 font-semibold gap-1.5 shrink-0"
                                >
                                    <Square className="w-3.5 h-3.5 fill-current" />
                                    CANCEL
                                </Button>
                            ) : (
                                <Button
                                    onClick={triggerRequest}
                                    size="sm"
                                    disabled={session?.urlIsValid === false}
                                    className="h-8 font-semibold gap-1.5 shrink-0"
                                >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    SEND
                                </Button>
                            )}

                            <HistoryRequests history={history} selectedHistoryIndex={selectedHistoryIndex} />
                        </div>
                        <ResizablePanelGroup direction='horizontal' autoSaveId="repeater-req-res" className="flex-1 min-h-0">
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
                                            {currentStatus && (
                                                <Badge
                                                    variant="outline"
                                                    className={cn("text-[10px] font-mono px-1.5 py-0 font-medium capitalize", getStatusBadgeStyle(currentStatus))}
                                                >
                                                    {currentStatus}
                                                </Badge>
                                            )}
                                            {hasError && (
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                type="button"
                                                                className="inline-flex items-center justify-center text-rose-500 hover:text-rose-400 transition-colors p-0.5 rounded focus:outline-none focus:ring-1 focus:ring-rose-500/50"
                                                            // title="View Error Details"
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
                                                                {currentHistoryItem?.errorMessage || "An error occurred while sending the request."}
                                                            </p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                        {currentHistoryItem?.responseTime !== undefined && currentHistoryItem.responseTime > 0 && (
                                            <span className="text-[11px] font-mono text-muted-foreground">
                                                {currentHistoryItem.responseTime} ms
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
    )
}

export default Replayer