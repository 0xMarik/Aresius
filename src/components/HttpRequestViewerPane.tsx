import React, { useMemo, useState, useCallback } from 'react';
import { Clock, HardDrive, FileText } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeMirrorEditor } from '@/components/result-table.components';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import MethodBadge from '@/components/MethodBadge';
import { HttpStatusBadge } from '@/components/HttpStatusBadge';
import { ViewModeTabs } from '@/components/ViewModeTabs';
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

    const prettyReq = useMemo(
        () => (request?.rawRequest ? formatHttpMessagePretty(request.rawRequest) : ''),
        [request?.rawRequest]
    );

    const prettyRes = useMemo(
        () => (request?.rawResponse ? formatHttpMessagePretty(request.rawResponse) : ''),
        [request?.rawResponse]
    );

    const parsedRes = useMemo(() => splitHttpMessage(request?.rawResponse ?? ''), [request?.rawResponse]);

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

                    <div className="flex items-center gap-1.5 shrink-0">
                        <ViewModeTabs mode={currentReqMode} onChange={handleReqModeChange} />
                    </div>
                </div>

                {/* Request Content with Right-Click Context Menu */}
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className="flex-1 min-h-0 overflow-auto bg-background">
                            <CodeMirrorEditor
                                value={currentReqMode === 'pretty' ? prettyReq : request.rawRequest}
                                isPretty={currentReqMode === 'pretty'}
                            />
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56 text-xs">
                        <RequestCopyActions rawRequest={request.rawRequest} host={request.host} />

                        <ContextMenuSeparator />

                        <SendToReplayer rawRequest={request.rawRequest} />

                        <SendToFuzzer rawRequest={request.rawRequest} host={request.host || ''} />
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

                    <div className="flex items-center gap-1.5 shrink-0">
                        <ViewModeTabs mode={currentResMode} onChange={handleResModeChange} />
                    </div>
                </div>

                {/* Response Content */}
                <div className="flex-1 min-h-0 overflow-auto bg-background">
                    <CodeMirrorEditor
                        value={currentResMode === 'pretty' ? prettyRes : request.rawResponse}
                        isPretty={currentResMode === 'pretty'}
                    />
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
});

export default HttpRequestViewerPane;
