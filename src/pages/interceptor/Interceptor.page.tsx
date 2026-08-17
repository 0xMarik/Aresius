import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { codeMirrorScrollTheme } from '@/components/codemirror-scroll.theme';
import { http } from '@/components/http-parser.component';
import { BaseRow } from '@/components/Table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MethodBadge from '@/components/MethodBadge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from '@/components/ui/resizable';
import { ColumnDef } from '@tanstack/react-table';
import {

    Trash2,
    Shield,
    ShieldAlert,
    Globe,
    Wand2,
    Files,
    Inbox,
    Send,
    Antenna,
    Crosshair,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { useInterceptSettings } from '@/hooks/useInterceptPoller';
import {
    setSelectedId,
    removeQueueItem,
    clearQueue,
    selectInterceptor,
    InterceptItem,
} from '@/store/slices/interceptorSlice';
import { parseRequest, parseResponse } from '@/components/utils';
import { formatHttpMessage } from './http-pretty';
import LightDataTable from '@/components/LightDataTable';
import HttpRequestFormatWarning from '@/components/HttpRequestFormatWarning';
import { EmptyState } from '@/components/ui/empty-state';
import { selectActiveScope } from '@/store/slices/scopeSlice';



/* -------------------------------------------------------------------------- */
/*  Row Interfaces for TanStack Table (extends BaseRow with numeric `id`)     */
/* -------------------------------------------------------------------------- */

interface RequestRowItem extends BaseRow {
    id: number;
    originalId: string;
    host: string;
    method: string;
    path: string;
    item: InterceptItem;
}

interface ResponseRowItem extends BaseRow {
    id: number;
    originalId: string;
    requestId: string;
    requestPath: string;
    status: string;
    item: InterceptItem;
}

/* -------------------------------------------------------------------------- */
/*  CodeMirror 6 Raw HTTP Message Editor Component                            */
/* -------------------------------------------------------------------------- */

interface RawMessageEditorProps {
    value: string;
    onChange?: (val: string) => void;
    readOnly?: boolean;
}

const RawMessageEditor: React.FC<RawMessageEditorProps> = ({
    value,
    onChange,
    readOnly = false,
}) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (!editorRef.current) return;

        if (!viewRef.current) {
            const extensions = [
                basicSetup,
                http(),
                oneDark,
                codeMirrorScrollTheme,
                EditorView.theme({
                    '&': {
                        height: '100%',
                        fontSize: '12px',
                        backgroundColor: '#0d1117',
                    },
                    '.cm-scroller': { overflow: 'auto' },
                    '.cm-content': { fontFamily: 'JetBrains Mono, Menlo, monospace' },
                }),
                EditorView.lineWrapping,
            ];

            if (readOnly) {
                extensions.push(EditorState.readOnly.of(true));
            } else if (onChange) {
                extensions.push(
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            onChange(update.state.doc.sliceString(0, update.state.doc.length, '\r\n'));
                        }
                    })
                );
            }

            const state = EditorState.create({
                doc: value,
                extensions,
            });

            viewRef.current = new EditorView({
                state,
                parent: editorRef.current,
            });
        }
    }, []);

    // Sync external doc changes to editor without losing cursor position when possible
    useEffect(() => {
        if (viewRef.current) {
            const currentDoc = viewRef.current.state.doc.toString();
            if (currentDoc !== value) {
                viewRef.current.dispatch({
                    changes: {
                        from: 0,
                        to: currentDoc.length,
                        insert: value,
                    },
                });
            }
        }
    }, [value]);

    useEffect(() => {
        return () => {
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
    }, []);

    return <div ref={editorRef} className="h-full w-full overflow-hidden " />;
};

/* -------------------------------------------------------------------------- */
/*  Main Interceptor Page Component                                           */
/* -------------------------------------------------------------------------- */

const InterceptorPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const interceptorState = useAppSelector(selectInterceptor(projectId));
    const queue = interceptorState.queue;
    const settings = interceptorState.settings;
    const selectedId = interceptorState.selectedId;
    const activeScope = useAppSelector(selectActiveScope(projectId));
    const { updateSettings } = useInterceptSettings();

    // const [activeTab, setActiveTab] = useState<'requests' | 'responses'>('requests');
    const [actionLoading, setActionLoading] = useState<boolean>(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    // Selected response tracking (separately selectable or reactive to request selection)
    const [selectedResponseIdState, setSelectedResponseIdState] = useState<string | null>(null);

    // Pretty formatting states for request and response detail panels
    const [isReqPretty, setIsReqPretty] = useState<boolean>(false);
    const [isResPretty, setIsResPretty] = useState<boolean>(false);

    // ── Sequential display-ID assignment ────────────────────────────────────
    // A stable map from backend item.id → sequential display number shared
    // across both requests and responses. The counter never resets mid-session
    // so forwarding request #1 makes the next new item (a response) get #3, etc.
    const displayIdMapRef = useRef<Map<string, number>>(new Map());
    const displayIdCounterRef = useRef<number>(0);

    // Assign IDs synchronously during render (before any useMemos) so that
    // getDisplayId() always returns a valid number when row builders run.
    // Mutating refs during render is safe here because it is idempotent —
    // the same item.id always maps to the same counter value.
    for (const item of queue) {
        if (!displayIdMapRef.current.has(item.id)) {
            displayIdCounterRef.current += 1;
            displayIdMapRef.current.set(item.id, displayIdCounterRef.current);
        }
    }

    const getDisplayId = (backendId: string): number =>
        displayIdMapRef.current.get(backendId) ?? 0;
    // ────────────────────────────────────────────────────────────────────────

    // Filter queue items by type
    const requestItems = useMemo(
        () => queue.filter((item) => item.itemType === 'request'),
        [queue]
    );
    const responseItems = useMemo(
        () => queue.filter((item) => item.itemType === 'response'),
        [queue]
    );

    // Sync active scope to backend intercept settings whenever activeScope or settings change
    useEffect(() => {
        const activeScopePayload = activeScope
            ? {
                id: activeScope.id,
                name: activeScope.name,
                color: activeScope.color,
                allow: activeScope.allow.map((a) => ({ id: a.id, pattern: a.pattern })),
                deny: activeScope.deny.map((d) => ({ id: d.id, pattern: d.pattern })),
            }
            : null;

        updateSettings({
            ...settings,
            scopeFilterEnabled: settings.scopeFilterEnabled ?? false,
            activeScope: activeScopePayload,
        });
    }, [activeScope, settings.scopeFilterEnabled, settings.requestsEnabled, settings.responsesEnabled]);



    // Active selected items
    const selectedRequestItem = useMemo(() => {
        if (!selectedId) return requestItems[0] || null;
        return requestItems.find((item) => item.id === selectedId) || requestItems[0] || null;
    }, [requestItems, selectedId]);

    const selectedResponseItem = useMemo(() => {
        if (selectedResponseIdState) {
            const found = responseItems.find((item) => item.id === selectedResponseIdState);
            if (found) return found;
        }
        // Reactive fallback: match response for selected request by index or host/timestamp proximity
        if (selectedRequestItem) {
            const match = responseItems.find((res) => res.host === selectedRequestItem.host);
            if (match) return match;
        }
        return responseItems[0] || null;
    }, [responseItems, selectedResponseIdState, selectedRequestItem]);

    // Content buffers for editing
    const [editedReqContent, setEditedReqContent] = useState<string>('');
    const [editedResContent, setEditedResContent] = useState<string>('');

    // Sync edited request content on selection change
    useEffect(() => {
        if (selectedRequestItem) {
            setEditedReqContent(
                isReqPretty
                    ? formatHttpMessage(selectedRequestItem.rawMessage)
                    : selectedRequestItem.rawMessage
            );
            setValidationError(null);
        } else {
            setEditedReqContent('');
        }
    }, [selectedRequestItem?.id, selectedRequestItem?.rawMessage, isReqPretty]);

    // Sync edited response content on selection change
    useEffect(() => {
        if (selectedResponseItem) {
            setEditedResContent(
                isResPretty
                    ? formatHttpMessage(selectedResponseItem.rawMessage)
                    : selectedResponseItem.rawMessage
            );
        } else {
            setEditedResContent('');
        }
    }, [selectedResponseItem?.id, selectedResponseItem?.rawMessage, isResPretty]);

    /* ---------------------------------------------------------------------- */
    /*  Handlers for Forward & Drop Actions                                   */
    /* ---------------------------------------------------------------------- */

    const handleForwardRequest = async () => {
        if (!selectedRequestItem) return;
        setActionLoading(true);
        setValidationError(null);

        const isModified = editedReqContent !== selectedRequestItem.rawMessage;
        const payload = {
            id: selectedRequestItem.id,
            modifiedMessage: isModified ? editedReqContent : null,
        };


        try {
            await invoke('forward_intercept_item', { payload });
            if (projectId) dispatch(removeQueueItem({ id: selectedRequestItem.id, projectId }));
        } catch (err: any) {
            console.error('Failed to forward request:', err);
            setValidationError(typeof err === 'string' ? err : err.message || 'Validation error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDropRequest = async () => {
        if (!selectedRequestItem) return;
        setActionLoading(true);
        try {
            await invoke('drop_intercept_item', { id: selectedRequestItem.id });
            if (projectId) dispatch(removeQueueItem({ id: selectedRequestItem.id, projectId }));
        } catch (err) {
            console.error('Failed to drop request:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleForwardResponse = async () => {
        if (!selectedResponseItem) return;
        setActionLoading(true);
        const isModified = editedResContent !== selectedResponseItem.rawMessage;
        const payload = {
            id: selectedResponseItem.id,
            modifiedMessage: isModified ? editedResContent : null,
        };

        try {
            await invoke('forward_intercept_item', { payload });
            if (projectId) dispatch(removeQueueItem({ id: selectedResponseItem.id, projectId }));
        } catch (err: any) {
            console.error('Failed to forward response:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDropResponse = async () => {
        if (!selectedResponseItem) return;
        setActionLoading(true);
        try {
            await invoke('drop_intercept_item', { id: selectedResponseItem.id });
            if (projectId) dispatch(removeQueueItem({ id: selectedResponseItem.id, projectId }));
        } catch (err) {
            console.error('Failed to drop response:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDropAll = async () => {
        if (queue.length === 0) return;
        setActionLoading(true);
        try {
            await invoke('drop_all_intercept_items');
            if (projectId) dispatch(clearQueue(projectId));
        } catch (err) {
            console.error('Failed to drop all items:', err);
        } finally {
            setActionLoading(false);
        }
    };

    // Forward all queued items of the given type (unmodified).
    // Called when the user disables interception for that type so nothing stays stuck.
    const handleForwardAllOfType = async (type: 'request' | 'response') => {
        const items = queue.filter((item) => item.itemType === type);
        if (items.length === 0) return;
        setActionLoading(true);
        try {
            await Promise.all(
                items.map((item) =>
                    invoke('forward_intercept_item', {
                        payload: { id: item.id, modifiedMessage: null },
                    }).then(() => {
                        if (projectId) dispatch(removeQueueItem({ id: item.id, projectId }));
                    })
                )
            );
        } catch (err) {
            console.error(`Failed to forward all ${type}s:`, err);
        } finally {
            setActionLoading(false);
        }
    };

    /* ---------------------------------------------------------------------- */
    /*  DataTable Data Adaptors & Column Definitions                          */
    /* ---------------------------------------------------------------------- */

    const requestRows: RequestRowItem[] = useMemo(() => {
        return requestItems.map((item) => {
            const parsed = parseRequest(item.rawMessage);
            const numericId = getDisplayId(item.id);
            return {
                id: numericId,
                originalId: item.id,
                host: item.host,
                method: parsed.method || item.methodOrStatus || 'GET',
                path: parsed.path || '/',
                item,
            };
        });
    }, [requestItems, queue]);

    const responseRows: ResponseRowItem[] = useMemo(() => {
        return responseItems.map((item) => {
            const parsed = parseResponse(item.rawMessage);
            const numericId = getDisplayId(item.id);
            return {
                id: numericId,
                originalId: item.id,
                requestId: `#${numericId}`,
                requestPath: item.host,
                status: parsed.statusCode ? `${parsed.statusCode} ${parsed.statusText}` : item.methodOrStatus || '200 OK',
                item,
            };
        });
    }, [responseItems, queue]);

    const requestColumns = useMemo<ColumnDef<RequestRowItem, any>[]>(
        () => [
            {
                accessorKey: 'id',
                id: 'displayId',
                header: 'ID',
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-muted-foreground">
                        #{row.original.id}
                    </span>
                ),
                size: 60,
            },
            {
                accessorKey: 'host',
                id: 'host',
                header: 'Host',
                cell: ({ row }) => (
                    <span className="font-mono text-xs truncate max-w-[120px] block">
                        {row.original.host}
                    </span>
                ),
            },
            {
                accessorKey: 'method',
                id: 'method',
                header: 'Method',
                cell: ({ row }) => <MethodBadge method={row.original.method} />,
                size: 80,
            },
            {
                accessorKey: 'path',
                id: 'path',
                header: 'Path',
                cell: ({ row }) => (
                    <span className="font-mono text-xs truncate text-foreground/90 block">
                        {row.original.path}
                    </span>
                ),
            },
        ],
        []
    );

    const responseColumns = useMemo<ColumnDef<ResponseRowItem, any>[]>(
        () => [
            {
                accessorKey: 'id',
                id: 'displayId',
                header: 'ID',
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-muted-foreground">
                        #{row.original.id}
                    </span>
                ),
                size: 60,
            },
            {
                accessorKey: 'requestId',
                id: 'requestId',
                header: 'Request',
                cell: ({ row }) => (
                    <span className="font-mono text-xs truncate text-foreground/90 block">
                        {row.original.requestPath}
                    </span>
                ),
            },
            {
                accessorKey: 'status',
                id: 'status',
                header: 'Status',
                cell: ({ row }) => {
                    const status = row.original.status;
                    const is2xx = status.startsWith('2');
                    const is3xx = status.startsWith('3');
                    const is4xx = status.startsWith('4');
                    const is5xx = status.startsWith('5');
                    const statusColor = is2xx
                        ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30'
                        : is3xx
                            ? 'text-amber-400 bg-amber-950/40 border-amber-500/30'
                            : is4xx || is5xx
                                ? 'text-rose-400 bg-rose-950/40 border-rose-500/30'
                                : 'text-muted-foreground bg-muted/40 border-border';
                    return (
                        <Badge
                            variant="outline"
                            className={`text-[10px] font-mono px-1.5 py-0 ${statusColor}`}
                        >
                            {status}
                        </Badge>
                    );
                },
                size: 100,
            },
        ],
        []
    );

    const requestRowsRef = useRef(requestRows);
    useEffect(() => {
        requestRowsRef.current = requestRows;
    }, [requestRows]);

    const responseRowsRef = useRef(responseRows);
    useEffect(() => {
        responseRowsRef.current = responseRows;
    }, [responseRows]);

    const selectedIdRef = useRef(selectedId);
    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const handleSelectRequestRow = useCallback(
        (idNum: number | null) => {
            if (!projectId) return;
            if (idNum === null) {
                if (selectedIdRef.current !== null) {
                    dispatch(setSelectedId({ id: null, projectId }));
                }
                return;
            }
            const match = requestRowsRef.current.find((r) => r.id === idNum);
            if (match && match.originalId !== selectedIdRef.current) {
                dispatch(setSelectedId({ id: match.originalId, projectId }));
            }
        },
        [dispatch, projectId]
    );

    const handleSelectResponseRow = useCallback(
        (idNum: number | null) => {
            if (idNum === null) {
                setSelectedResponseIdState((prev) => (prev !== null ? null : prev));
                return;
            }
            const match = responseRowsRef.current.find((r) => r.id === idNum);
            if (match) {
                setSelectedResponseIdState((prev) => (prev !== match.originalId ? match.originalId : prev));
            }
        },
        []
    );

    /* ---------------------------------------------------------------------- */
    /*  Render Component                                                      */
    /* ---------------------------------------------------------------------- */

    return (
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
            {/* Top Bar: Requests / Responses Tabs & Live Capture State Controls */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/60 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-3">
                    {/* Live Capture Switches */}
                    <div className="flex items-center gap-3 bg-muted/30 px-2.5 py-1 rounded-md border text-xs">
                        <div className="flex items-center space-x-1.5">
                            <Switch
                                id="top-req-switch"
                                checked={settings.requestsEnabled}
                                onCheckedChange={async (val) => {
                                    if (!val) await handleForwardAllOfType('request');
                                    updateSettings({ ...settings, requestsEnabled: val });
                                }}
                            />
                            <Label htmlFor="top-req-switch" className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                                Intercept Request
                            </Label>
                        </div>
                        <div className="h-3 w-px bg-border" />
                        <div className="flex items-center space-x-1.5">
                            <Switch
                                id="top-res-switch"
                                checked={settings.responsesEnabled}
                                onCheckedChange={async (val) => {
                                    if (!val) await handleForwardAllOfType('response');
                                    updateSettings({ ...settings, responsesEnabled: val });
                                }}
                            />
                            <Label htmlFor="top-res-switch" className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                                Intercept Response
                            </Label>
                        </div>
                        <div className="h-3 w-px bg-border" />
                        {/* Scope filter toggle */}
                        <div className="flex items-center space-x-1.5">
                            <Switch
                                id="top-scope-switch"
                                checked={settings.scopeFilterEnabled ?? false}
                                onCheckedChange={(val) => {
                                    updateSettings({ ...settings, scopeFilterEnabled: val });
                                }}
                                disabled={!activeScope}
                            />
                            <Label
                                htmlFor="top-scope-switch"
                                className={`cursor-pointer text-[11px] font-medium flex items-center gap-1 ${!activeScope ? 'text-muted-foreground/40' : 'text-muted-foreground'
                                    }`}
                            >
                                <Crosshair className="w-3 h-3" />
                                Scope Filter
                                {activeScope && (
                                    <span
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{ backgroundColor: activeScope.color }}
                                    />
                                )}
                            </Label>
                        </div>
                    </div>

                    {queue.length > 0 && (
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={handleDropAll}
                            disabled={actionLoading}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Drop All ({queue.length})
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 relative">
                {!(settings.requestsEnabled || settings.responsesEnabled) && (
                    <EmptyState
                        icon={Antenna}
                        title="Traffic Interceptor Standby"
                        description="Enable Intercept Request or Intercept Response in the top bar to begin capturing and editing HTTP traffic in real time."
                    />
                )}
                <ResizablePanelGroup direction="horizontal">
                    {/* -------------------------------------------------------------- */}
                    {/* Left Pane: Requests Side                                       */}
                    {/* -------------------------------------------------------------- */}
                    <ResizablePanel defaultSize={50} minSize={30} hidden={!settings.requestsEnabled}>
                        <ResizablePanelGroup direction="vertical">
                            {/* Top Left: Request Queue Table */}
                            <ResizablePanel defaultSize={45} minSize={20}>
                                <div className="flex flex-col h-full bg-background border-r border-border">
                                    <div className="px-3 py-1.5 border-b bg-card/30 flex items-center justify-between shrink-0">
                                        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                                            <Globe className="w-3.5 h-3.5 text-primary" />
                                            Request Queue ({requestItems.length})
                                        </span>
                                    </div>
                                    <div className="flex-1 min-h-0 relative">
                                        {
                                            requestItems.length === 0 ? (
                                                <EmptyState
                                                    icon={Globe}
                                                    title="No requests queued"
                                                    description="Queuing allows you to inspect and modify outgoing requests before they reach the server."
                                                />
                                            ) : (
                                                <LightDataTable
                                                    data={requestRows}
                                                    columns={requestColumns}
                                                    fillHeight
                                                    onSelectRow={handleSelectRequestRow}
                                                />
                                            )
                                        }
                                    </div>
                                </div>
                            </ResizablePanel>

                            <ResizableHandle withHandle />

                            {/* Bottom Left: Request Detail Panel */}
                            <ResizablePanel defaultSize={55} minSize={20}>
                                <div className="flex flex-col h-full bg-background border-r border-border min-w-0">
                                    {selectedRequestItem ? (
                                        <>
                                            {/* Panel Top Header Bar */}
                                            <div className="p-2 border-b bg-card/40 flex items-center justify-between shrink-0 gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs font-mono font-medium truncate text-foreground">
                                                        https://{selectedRequestItem.host}
                                                    </span>
                                                    <HttpRequestFormatWarning rawRequest={editedReqContent} />
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        className="h-7 px-3 text-xs"
                                                        onClick={handleDropRequest}
                                                        disabled={actionLoading}
                                                    >
                                                        Drop
                                                    </Button>

                                                    <Button
                                                        variant="default"
                                                        size="sm"
                                                        className="h-7 px-3 text-xs font-medium gap-1"
                                                        onClick={handleForwardRequest}
                                                        disabled={actionLoading}
                                                    >
                                                        <Send className="w-3 h-3" />
                                                        Forward
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* Error notification if validation fails */}
                                            {validationError && (
                                                <div className="bg-destructive/10 border-b border-destructive/20 p-2 text-destructive text-xs font-mono flex items-center gap-2">
                                                    <ShieldAlert className="w-4 h-4 shrink-0" />
                                                    <span>{validationError}</span>
                                                </div>
                                            )}

                                            {/* CodeMirror 6 Raw Request Editor */}
                                            <div className="flex-1 min-h-0 relative">
                                                <RawMessageEditor
                                                    value={editedReqContent}
                                                    onChange={setEditedReqContent}
                                                />
                                            </div>

                                            {/* Panel Bottom Footer Bar */}
                                            <div className="p-1.5 border-t bg-card/30 flex items-center justify-between shrink-0">
                                                <Button
                                                    variant={isReqPretty ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-6 text-[11px] gap-1 px-2"
                                                    onClick={() => setIsReqPretty((prev) => !prev)}
                                                >
                                                    <Wand2 className="w-3 h-3" />
                                                    Pretty
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <EmptyState
                                            icon={Shield}
                                            title="No request selected"
                                            description="Select an intercepted request from the queue above to inspect or edit its headers and body."
                                        />
                                    )}
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </ResizablePanel>

                    {(settings.responsesEnabled && settings.requestsEnabled) && <ResizableHandle withHandle />}

                    <ResizablePanel defaultSize={50} minSize={30} hidden={!settings.responsesEnabled}>
                        <ResizablePanelGroup direction="vertical">
                            {/* Top Right: Response Queue Table */}
                            <ResizablePanel defaultSize={45} minSize={20}>
                                <div className="flex flex-col h-full bg-background">
                                    <div className="px-3 py-1.5 border-b bg-card/30 flex items-center justify-between shrink-0">
                                        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                                            <Inbox className="w-3.5 h-3.5 text-primary" />
                                            Response Queue ({responseItems.length})
                                        </span>
                                    </div>                                     <div className="flex-1 min-h-0 relative">
                                        {responseItems.length === 0 ? (
                                            <EmptyState
                                                icon={Inbox}
                                                title="No responses queued"
                                                description="Queuing responses allows you to inspect and modify server responses before they reach your browser."
                                            />
                                        ) : (

                                            <LightDataTable
                                                data={responseRows}
                                                columns={responseColumns}
                                                fillHeight
                                                onSelectRow={handleSelectResponseRow}
                                            />
                                        )}
                                    </div>
                                </div>
                            </ResizablePanel>

                            <ResizableHandle withHandle />

                            {/* Bottom Right: Response Detail Panel */}
                            <ResizablePanel defaultSize={55} minSize={20}>
                                <div className="flex flex-col h-full bg-background min-w-0">
                                    {selectedResponseItem ? (
                                        <>
                                            {/* Panel Top Header Bar */}
                                            <div className="p-2 border-b bg-card/40 flex items-center justify-between shrink-0 gap-2">
                                                <span className="text-xs font-mono font-medium text-foreground truncate">
                                                    Response for {selectedResponseItem.host}
                                                </span>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        className="h-7 px-3 text-xs"
                                                        onClick={handleDropResponse}
                                                        disabled={actionLoading}
                                                    >
                                                        Drop
                                                    </Button>

                                                    <Button
                                                        variant="default"
                                                        size="sm"
                                                        className="h-7 px-3 text-xs font-medium gap-1"
                                                        onClick={handleForwardResponse}
                                                        disabled={actionLoading}
                                                    >
                                                        <Send className="w-3 h-3" />
                                                        Forward
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* CodeMirror 6 Raw Response Editor */}
                                            <div className="flex-1 min-h-0 relative">
                                                <RawMessageEditor
                                                    value={editedResContent}
                                                    onChange={setEditedResContent}
                                                />
                                            </div>

                                            {/* Panel Bottom Footer Bar */}
                                            <div className="p-1.5 border-t bg-card/30 flex items-center justify-between shrink-0">
                                                <Button
                                                    variant={isResPretty ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-6 text-[11px] gap-1 px-2"
                                                    onClick={() => setIsResPretty((prev) => !prev)}
                                                >
                                                    <Wand2 className="w-3 h-3" />
                                                    Pretty
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <EmptyState
                                            icon={Files}
                                            title="No response selected"
                                            description="Select a queued response from above to inspect or edit its body and headers."
                                        />
                                    )}
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
};

export default InterceptorPage;
