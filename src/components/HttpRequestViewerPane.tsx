import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Clock, HardDrive, FileText, ChevronDown, Check, Sparkles, GitCompare, SlidersHorizontal } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { HttpMessageDiffViewer } from '@/components/HttpMessageDiffViewer';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import MethodBadge from '@/components/MethodBadge';
import { HttpStatusBadge } from '@/components/HttpStatusBadge';
import { ViewModeTabs } from '@/components/ViewModeTabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import SendToReplayer from '@/components/ContextMenu/SendToReplayer';
import SendToFuzzer from '@/components/ContextMenu/SendToFuzzer';
import RequestCopyActions from '@/components/ContextMenu/RequestCopyActions';
import { splitHttpMessage, formatHttpMessagePretty } from '@/components/utils';
import { applyDeltaPatch } from '@/utils/deltaPatcher';
import type { HttpHistory } from '@/types/http.type';

export interface HttpRequestViewerPaneProps {
    request?: HttpHistory | null;
    reqViewMode?: 'raw' | 'pretty';
    resViewMode?: 'raw' | 'pretty';
    onReqViewModeChange?: (mode: 'raw' | 'pretty') => void;
    onResViewModeChange?: (mode: 'raw' | 'pretty') => void;
    autoSaveId?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    requestHeaderExtra?: React.ReactNode;
    responseHeaderExtra?: React.ReactNode;
    responseCustomContent?: React.ReactNode;
    statusOverride?: string | number | null;
    showSendToFuzzer?: boolean;
}

export type ViewVersion = 'manual' | 'automated' | 'original' | 'diff';

export const HttpRequestViewerPane = React.memo(function HttpRequestViewerPane({
    request,
    reqViewMode: reqViewModeProp,
    resViewMode: resViewModeProp,
    onReqViewModeChange,
    onResViewModeChange,
    autoSaveId = 'aresius-req-res-viewer',
    emptyTitle = 'No Request Selected',
    emptyDescription = 'Choose a request row above to inspect its raw HTTP request and response payload.',
    requestHeaderExtra,
    responseHeaderExtra,
    responseCustomContent,
    statusOverride,
    showSendToFuzzer = true,
}: HttpRequestViewerPaneProps) {
    const [internalReqMode, setInternalReqMode] = useState<'raw' | 'pretty'>('raw');
    const [internalResMode, setInternalResMode] = useState<'raw' | 'pretty'>('raw');

    // Default to the most relevant edited view or original
    const initialReqVersion: ViewVersion = request?.requestEditType === 'automated' ? 'automated' : 'manual';
    const initialResVersion: ViewVersion = request?.responseEditType === 'automated' ? 'automated' : 'manual';

    const [reqVersion, setReqVersion] = useState<ViewVersion>(initialReqVersion);
    const [resVersion, setResVersion] = useState<ViewVersion>(initialResVersion);

    // Reset view version when selected request changes
    useEffect(() => {
        const defaultReq = request?.requestEditType === 'automated' ? 'automated' : 'manual';
        const defaultRes = request?.responseEditType === 'automated' ? 'automated' : 'manual';
        setReqVersion(defaultReq);
        setResVersion(defaultRes);
    }, [request?.id]);

    const currentReqMode = reqViewModeProp ?? internalReqMode;
    const currentResMode = resViewModeProp ?? internalResMode;

    const handleReqModeChange = useCallback(
        (mode: 'raw' | 'pretty') => {
            if (onReqViewModeChange) {
                onReqViewModeChange(mode);
            } else {
                setInternalReqMode(mode);
            }
        },
        [onReqViewModeChange]
    );

    const handleResModeChange = useCallback(
        (mode: 'raw' | 'pretty') => {
            if (onResViewModeChange) {
                onResViewModeChange(mode);
            } else {
                setInternalResMode(mode);
            }
        },
        [onResViewModeChange]
    );

    const hasReqModifications = useMemo(() => {
        if (!request) return false;
        return (
            !!request.requestEditType ||
            !!request.requestAutoPatch ||
            !!request.requestManualPatch
        );
    }, [request]);

    const hasResModifications = useMemo(() => {
        if (!request) return false;
        return (
            !!request.responseEditType ||
            !!request.responseAutoPatch ||
            !!request.responseManualPatch
        );
    }, [request]);

    // Reconstruct request payloads using Delta Patches on demand
    const originalReq = useMemo(() => {
        if (!request) return '';
        return request.rawRequest || '';
    }, [request]);

    const autoReq = useMemo(() => {
        if (!request) return '';
        if (request.requestAutoPatch) {
            return applyDeltaPatch(originalReq, request.requestAutoPatch);
        }
        return originalReq;
    }, [request, originalReq]);

    const manualReq = useMemo(() => {
        if (!request) return '';
        if (request.requestEditType === 'both') {
            if (request.requestManualPatch) {
                return applyDeltaPatch(autoReq, request.requestManualPatch);
            }
            return autoReq;
        }
        if (request.requestEditType === 'manual') {
            if (request.requestManualPatch) {
                return applyDeltaPatch(originalReq, request.requestManualPatch);
            }
            return originalReq;
        }
        return autoReq;
    }, [request, originalReq, autoReq]);

    const activeRawRequest = useMemo(() => {
        if (!request) return '';
        if (reqVersion === 'original') return originalReq;
        if (reqVersion === 'automated') return autoReq;
        if (reqVersion === 'manual') return manualReq;
        return manualReq || request.rawRequest;
    }, [request, reqVersion, originalReq, autoReq, manualReq]);

    // Reconstruct response payloads using Delta Patches on demand
    const originalRes = useMemo(() => {
        if (!request) return '';
        return request.rawResponse || '';
    }, [request]);

    const autoRes = useMemo(() => {
        if (!request) return '';
        if (request.responseAutoPatch) {
            return applyDeltaPatch(originalRes, request.responseAutoPatch);
        }
        return originalRes;
    }, [request, originalRes]);

    const manualRes = useMemo(() => {
        if (!request) return '';
        if (request.responseEditType === 'both') {
            if (request.responseManualPatch) {
                return applyDeltaPatch(autoRes, request.responseManualPatch);
            }
            return autoRes;
        }
        if (request.responseEditType === 'manual') {
            if (request.responseManualPatch) {
                return applyDeltaPatch(originalRes, request.responseManualPatch);
            }
            return originalRes;
        }
        return autoRes;
    }, [request, originalRes, autoRes]);

    const activeRawResponse = useMemo(() => {
        if (!request) return '';
        if (resVersion === 'original') return originalRes;
        if (resVersion === 'automated') return autoRes;
        if (resVersion === 'manual') return manualRes;
        return manualRes || request.rawResponse;
    }, [request, resVersion, originalRes, autoRes, manualRes]);

    const prettyReq = useMemo(
        () => (activeRawRequest ? formatHttpMessagePretty(activeRawRequest) : ''),
        [activeRawRequest]
    );

    const prettyRes = useMemo(
        () => (activeRawResponse ? formatHttpMessagePretty(activeRawResponse) : ''),
        [activeRawResponse]
    );

    const parsedRes = useMemo(() => splitHttpMessage(activeRawResponse), [activeRawResponse]);

    const resContentType = useMemo(() => {
        const ctHeader = parsedRes.headersList.find((h) => h.name.toLowerCase() === 'content-type');
        if (!ctHeader) return '';
        const rawCt = ctHeader.value.split(';')[0].trim();
        return rawCt.replace(/^application\//i, '').replace(/^text\//i, '');
    }, [parsedRes.headersList]);

    if (!request) {
        return (
            <div className="h-full flex items-center justify-center bg-card/10">
                <EmptyState
                    icon={FileText}
                    title={emptyTitle}
                    description={emptyDescription}
                />
            </div>
        );
    }

    const reqHasAuto = request.requestEditType === 'automated' || request.requestEditType === 'both' || !!request.requestAutoPatch;
    const reqHasManual = request.requestEditType === 'manual' || request.requestEditType === 'both' || !!request.requestManualPatch;

    const resHasAuto = request.responseEditType === 'automated' || request.responseEditType === 'both' || !!request.responseAutoPatch;
    const resHasManual = request.responseEditType === 'manual' || request.responseEditType === 'both' || !!request.responseManualPatch;

    return (
        <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId} className="h-full min-h-0">
            {/* Request Pane */}
            <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden border-r border-border/50">
                {/* Request Header Bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-card/60 border-b border-border/50 text-xs shrink-0 select-none">
                    <div className="flex items-center gap-2 min-w-0">
                        <MethodBadge method={request.method} className="px-1.5 py-0.5 font-bold" />
                        <span className="font-mono text-xs text-foreground/90 truncate max-w-[240px]" title={request.path}>
                            {request.path || '/'}
                        </span>
                        {requestHeaderExtra}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* Dropdown for Original vs Automated vs Manual vs Differentiation Request */}
                        {hasReqModifications && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-mono font-medium transition-colors shadow-xs select-none border ${
                                            reqVersion === 'diff'
                                                ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30'
                                                : reqVersion === 'automated'
                                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 border-purple-500/30'
                                                : reqVersion === 'manual'
                                                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 border-sky-500/30'
                                                : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/30'
                                        }`}
                                    >
                                        {reqVersion === 'diff' ? (
                                            <GitCompare className="w-3 h-3 text-emerald-500" />
                                        ) : reqVersion === 'automated' ? (
                                            <Sparkles className="w-3 h-3 text-purple-500" />
                                        ) : reqVersion === 'manual' ? (
                                            <SlidersHorizontal className="w-3 h-3 text-sky-500" />
                                        ) : (
                                            <FileText className="w-3 h-3 text-blue-500" />
                                        )}
                                        <span>
                                            {reqVersion === 'manual'
                                                ? request.requestEditType === 'both' ? 'Manual Edit (Final)' : 'Manual Edit'
                                                : reqVersion === 'automated'
                                                ? 'Automated Edit'
                                                : reqVersion === 'original'
                                                ? 'Original'
                                                : 'Differentiation'}
                                        </span>
                                        <ChevronDown className="w-3 h-3 opacity-70" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="text-xs font-mono min-w-[190px]">
                                    {/* Manual Edit Item */}
                                    {reqHasManual && (
                                        <DropdownMenuItem
                                            onClick={() => setReqVersion('manual')}
                                            className={`flex items-center justify-between cursor-pointer ${
                                                reqVersion === 'manual' ? 'font-semibold text-sky-600 dark:text-sky-400' : ''
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-sky-500" />
                                                <span>{request.requestEditType === 'both' ? 'Manual Edit (Final)' : 'Manual Edit'}</span>
                                                <span className="text-[9px] text-muted-foreground">(Intercept)</span>
                                            </div>
                                            {reqVersion === 'manual' && <Check className="w-3.5 h-3.5 ml-2" />}
                                        </DropdownMenuItem>
                                    )}

                                    {/* Automated Edit Item */}
                                    {reqHasAuto && (
                                        <DropdownMenuItem
                                            onClick={() => setReqVersion('automated')}
                                            className={`flex items-center justify-between cursor-pointer ${
                                                reqVersion === 'automated' ? 'font-semibold text-purple-600 dark:text-purple-400' : ''
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-purple-500" />
                                                <span>Automated Edit</span>
                                                <span className="text-[9px] text-muted-foreground">(M&R)</span>
                                            </div>
                                            {reqVersion === 'automated' && <Check className="w-3.5 h-3.5 ml-2" />}
                                        </DropdownMenuItem>
                                    )}

                                    {/* Original Item */}
                                    <DropdownMenuItem
                                        onClick={() => setReqVersion('original')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            reqVersion === 'original' ? 'font-semibold text-blue-500' : ''
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                                            <span>Original</span>
                                        </div>
                                        {reqVersion === 'original' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Differentiation Item */}
                                    <DropdownMenuItem
                                        onClick={() => setReqVersion('diff')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            reqVersion === 'diff' ? 'font-semibold text-emerald-500' : ''
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <GitCompare className="w-3.5 h-3.5 text-emerald-500" />
                                            <span>Differentiation</span>
                                        </div>
                                        {reqVersion === 'diff' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {reqVersion !== 'diff' && (
                            <ViewModeTabs mode={currentReqMode} onChange={handleReqModeChange} />
                        )}
                    </div>
                </div>

                {/* Request Content */}
                {reqVersion === 'diff' ? (
                    <div className="flex-1 min-h-0 overflow-hidden bg-background">
                        <HttpMessageDiffViewer
                            original={originalReq}
                            automated={request.requestEditType === 'both' ? autoReq : undefined}
                            edited={request.requestEditType === 'automated' ? autoReq : manualReq}
                            title={`Request: ${request.method} ${request.path}`}
                            editType={request.requestEditType}
                        />
                    </div>
                ) : (
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="flex-1 min-h-0 overflow-auto bg-background">
                                <CodeMirrorEditor
                                    value={currentReqMode === 'pretty' ? prettyReq : activeRawRequest}
                                    isPretty={currentReqMode === 'pretty'}
                                />
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-56 text-xs">
                            <RequestCopyActions rawRequest={activeRawRequest} host={request.host} />

                            <ContextMenuSeparator />

                            <SendToReplayer rawRequest={activeRawRequest} />

                            {showSendToFuzzer && (
                                <SendToFuzzer rawRequest={activeRawRequest} host={request.host || ''} />
                            )}
                        </ContextMenuContent>
                    </ContextMenu>
                )}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Response Pane */}
            <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
                {/* Response Header Bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-card/60 border-b border-border/50 text-xs shrink-0 select-none">
                    <div className="flex items-center gap-2 min-w-0">
                        <HttpStatusBadge status={statusOverride !== undefined ? statusOverride : request.statusCode} />

                        {request.responseTimeMs !== undefined && request.responseTimeMs > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                                <Clock className="w-3 h-3 text-muted-foreground/70" />
                                {request.responseTimeMs} ms
                            </span>
                        )}

                        {request.responseLength !== undefined && request.responseLength > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                                <HardDrive className="w-3 h-3 text-muted-foreground/70" />
                                {request.responseLength} B
                            </span>
                        )}

                        {resContentType && (
                            <Badge variant="outline" className="text-[9px] uppercase px-1.5 py-0 h-4 border-border/60 text-muted-foreground">
                                {resContentType}
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {responseHeaderExtra}
                        {/* Dropdown for Original vs Automated vs Manual vs Differentiation Response */}
                        {hasResModifications && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-mono font-medium transition-colors shadow-xs select-none border ${
                                            resVersion === 'diff'
                                                ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30'
                                                : resVersion === 'automated'
                                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 border-purple-500/30'
                                                : resVersion === 'manual'
                                                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 border-sky-500/30'
                                                : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/30'
                                        }`}
                                    >
                                        {resVersion === 'diff' ? (
                                            <GitCompare className="w-3 h-3 text-emerald-500" />
                                        ) : resVersion === 'automated' ? (
                                            <Sparkles className="w-3 h-3 text-purple-500" />
                                        ) : resVersion === 'manual' ? (
                                            <SlidersHorizontal className="w-3 h-3 text-sky-500" />
                                        ) : (
                                            <FileText className="w-3 h-3 text-blue-500" />
                                        )}
                                        <span>
                                            {resVersion === 'manual'
                                                ? request.responseEditType === 'both' ? 'Manual Edit (Final)' : 'Manual Edit'
                                                : resVersion === 'automated'
                                                ? 'Automated Edit'
                                                : resVersion === 'original'
                                                ? 'Original'
                                                : 'Differentiation'}
                                        </span>
                                        <ChevronDown className="w-3 h-3 opacity-70" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="text-xs font-mono min-w-[190px]">
                                    {/* Manual Edit Item */}
                                    {resHasManual && (
                                        <DropdownMenuItem
                                            onClick={() => setResVersion('manual')}
                                            className={`flex items-center justify-between cursor-pointer ${
                                                resVersion === 'manual' ? 'font-semibold text-sky-600 dark:text-sky-400' : ''
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-sky-500" />
                                                <span>{request.responseEditType === 'both' ? 'Manual Edit (Final)' : 'Manual Edit'}</span>
                                                <span className="text-[9px] text-muted-foreground">(Intercept)</span>
                                            </div>
                                            {resVersion === 'manual' && <Check className="w-3.5 h-3.5 ml-2" />}
                                        </DropdownMenuItem>
                                    )}

                                    {/* Automated Edit Item */}
                                    {resHasAuto && (
                                        <DropdownMenuItem
                                            onClick={() => setResVersion('automated')}
                                            className={`flex items-center justify-between cursor-pointer ${
                                                resVersion === 'automated' ? 'font-semibold text-purple-600 dark:text-purple-400' : ''
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-purple-500" />
                                                <span>Automated Edit</span>
                                                <span className="text-[9px] text-muted-foreground">(M&R)</span>
                                            </div>
                                            {resVersion === 'automated' && <Check className="w-3.5 h-3.5 ml-2" />}
                                        </DropdownMenuItem>
                                    )}

                                    {/* Original Item */}
                                    <DropdownMenuItem
                                        onClick={() => setResVersion('original')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            resVersion === 'original' ? 'font-semibold text-blue-500' : ''
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                                            <span>Original</span>
                                        </div>
                                        {resVersion === 'original' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Differentiation Item */}
                                    <DropdownMenuItem
                                        onClick={() => setResVersion('diff')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            resVersion === 'diff' ? 'font-semibold text-emerald-500' : ''
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <GitCompare className="w-3.5 h-3.5 text-emerald-500" />
                                            <span>Differentiation</span>
                                        </div>
                                        {resVersion === 'diff' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {resVersion !== 'diff' && !responseCustomContent && (
                            <ViewModeTabs mode={currentResMode} onChange={handleResModeChange} />
                        )}
                    </div>
                </div>

                {/* Response Content */}
                {responseCustomContent ? (
                    <div className="flex-1 min-h-0 overflow-auto bg-card">
                        {responseCustomContent}
                    </div>
                ) : resVersion === 'diff' ? (
                    <div className="flex-1 min-h-0 overflow-hidden bg-background">
                        <HttpMessageDiffViewer
                            original={originalRes}
                            automated={request.responseEditType === 'both' ? autoRes : undefined}
                            edited={request.responseEditType === 'automated' ? autoRes : manualRes}
                            title={`Response: ${request.statusCode}`}
                            editType={request.responseEditType}
                        />
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 overflow-auto bg-background">
                        <CodeMirrorEditor
                            value={currentResMode === 'pretty' ? prettyRes : activeRawResponse}
                            isPretty={currentResMode === 'pretty'}
                        />
                    </div>
                )}
            </ResizablePanel>
        </ResizablePanelGroup>
    );
});

export default HttpRequestViewerPane;
