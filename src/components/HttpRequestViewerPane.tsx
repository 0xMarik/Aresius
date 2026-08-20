import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Clock, HardDrive, FileText, ChevronDown, Check, Sparkles } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import MethodBadge from '@/components/MethodBadge';
import { HttpStatusBadge } from '@/components/HttpStatusBadge';
import { ViewModeTabs } from '@/components/ViewModeTabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
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
}

export const HttpRequestViewerPane = React.memo(function HttpRequestViewerPane({
    request,
    reqViewMode: reqViewModeProp,
    resViewMode: resViewModeProp,
    onReqViewModeChange,
    onResViewModeChange,
    autoSaveId = 'aresius-req-res-viewer',
    emptyTitle = 'No Request Selected',
    emptyDescription = 'Choose a request row above to inspect its raw HTTP request and response payload.',
}: HttpRequestViewerPaneProps) {
    const [internalReqMode, setInternalReqMode] = useState<'raw' | 'pretty'>('raw');
    const [internalResMode, setInternalResMode] = useState<'raw' | 'pretty'>('raw');

    const [reqVersion, setReqVersion] = useState<'edited' | 'original'>('edited');
    const [resVersion, setResVersion] = useState<'edited' | 'original'>('edited');

    // Reset view version to 'edited' when a different request is selected
    useEffect(() => {
        setReqVersion('edited');
        setResVersion('edited');
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
        return (
            !!request?.originalRawRequest &&
            request.originalRawRequest !== request.rawRequest
        );
    }, [request?.originalRawRequest, request?.rawRequest]);

    const hasResModifications = useMemo(() => {
        return (
            !!request?.originalRawResponse &&
            request.originalRawResponse !== request.rawResponse
        );
    }, [request?.originalRawResponse, request?.rawResponse]);

    const activeRawRequest = useMemo(() => {
        if (!request) return '';
        if (hasReqModifications && reqVersion === 'original' && request.originalRawRequest) {
            return request.originalRawRequest;
        }
        return request.rawRequest;
    }, [request, hasReqModifications, reqVersion]);

    const activeRawResponse = useMemo(() => {
        if (!request) return '';
        if (hasResModifications && resVersion === 'original' && request.originalRawResponse) {
            return request.originalRawResponse;
        }
        return request.rawResponse;
    }, [request, hasResModifications, resVersion]);

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
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* Dropdown for Original vs Edited Request */}
                        {hasReqModifications && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-mono font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30 transition-colors shadow-xs select-none"
                                    >
                                        <Sparkles className="w-3 h-3 text-amber-500" />
                                        <span>{reqVersion === 'edited' ? 'Edited' : 'Original'}</span>
                                        <ChevronDown className="w-3 h-3 opacity-70" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="text-xs font-mono min-w-[130px]">
                                    <DropdownMenuItem
                                        onClick={() => setReqVersion('edited')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            reqVersion === 'edited' ? 'font-semibold text-primary' : ''
                                        }`}
                                    >
                                        <span>Edited</span>
                                        {reqVersion === 'edited' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => setReqVersion('original')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            reqVersion === 'original' ? 'font-semibold text-primary' : ''
                                        }`}
                                    >
                                        <span>Original</span>
                                        {reqVersion === 'original' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        <ViewModeTabs mode={currentReqMode} onChange={handleReqModeChange} />
                    </div>
                </div>

                {/* Request Content with Right-Click Context Menu */}
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

                        <SendToFuzzer rawRequest={activeRawRequest} host={request.host || ''} />
                    </ContextMenuContent>
                </ContextMenu>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Response Pane */}
            <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
                {/* Response Header Bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-card/60 border-b border-border/50 text-xs shrink-0 select-none">
                    <div className="flex items-center gap-2 min-w-0">
                        <HttpStatusBadge status={request.statusCode} />

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
                        {/* Dropdown for Original vs Edited Response */}
                        {hasResModifications && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-mono font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30 transition-colors shadow-xs select-none"
                                    >
                                        <Sparkles className="w-3 h-3 text-amber-500" />
                                        <span>{resVersion === 'edited' ? 'Edited' : 'Original'}</span>
                                        <ChevronDown className="w-3 h-3 opacity-70" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="text-xs font-mono min-w-[130px]">
                                    <DropdownMenuItem
                                        onClick={() => setResVersion('edited')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            resVersion === 'edited' ? 'font-semibold text-primary' : ''
                                        }`}
                                    >
                                        <span>Edited</span>
                                        {resVersion === 'edited' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => setResVersion('original')}
                                        className={`flex items-center justify-between cursor-pointer ${
                                            resVersion === 'original' ? 'font-semibold text-primary' : ''
                                        }`}
                                    >
                                        <span>Original</span>
                                        {resVersion === 'original' && <Check className="w-3.5 h-3.5 ml-2" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        <ViewModeTabs mode={currentResMode} onChange={handleResModeChange} />
                    </div>
                </div>

                {/* Response Content */}
                <div className="flex-1 min-h-0 overflow-auto bg-background">
                    <CodeMirrorEditor
                        value={currentResMode === 'pretty' ? prettyRes : activeRawResponse}
                        isPretty={currentResMode === 'pretty'}
                    />
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
});

export default HttpRequestViewerPane;
