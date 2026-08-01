import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { http } from '@/components/http-parser.component';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useInterceptPoller } from '@/hooks/useInterceptPoller';
import {
    setSelectedId,
    removeQueueItem,
    clearQueue,
} from '@/store/slices/interceptorSlice';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Play,
    Trash2,
    Shield,
    ShieldAlert,
    ShieldOff,
    ArrowRight,
    Globe,
    Clock,
} from 'lucide-react';

const InterceptorPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const { queue, settings, selectedId } = useAppSelector((state) => state.interceptor);
    const { updateSettings } = useInterceptPoller();

    const selectedItem = queue.find((item) => item.id === selectedId) || null;
    const [editedContent, setEditedContent] = useState<string>('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<boolean>(false);

    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    const editorViewRef = useRef<EditorView | null>(null);

    // Sync selected item raw message to editor content state
    useEffect(() => {
        if (selectedItem) {
            setEditedContent(selectedItem.rawMessage);
            setValidationError(null);
        } else {
            setEditedContent('');
            setValidationError(null);
        }
    }, [selectedItem?.id, selectedItem?.rawMessage]);

    // Initialize or update CodeMirror 6 Editor
    useEffect(() => {
        if (!editorContainerRef.current) return;

        if (!editorViewRef.current) {
            const startState = EditorState.create({
                doc: editedContent,
                extensions: [
                    basicSetup,
                    http(),
                    oneDark,
                    EditorView.theme({
                        '&': {
                            height: '100%',
                            fontSize: '13px',
                            backgroundColor: '#0d1117',
                        },
                        '.cm-scroller': { overflow: 'auto' },
                        '.cm-content': { fontFamily: 'JetBrains Mono, Menlo, monospace' },
                    }),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            setEditedContent(update.state.doc.toString());
                            setValidationError(null);
                        }
                    }),
                ],
            });

            editorViewRef.current = new EditorView({
                state: startState,
                parent: editorContainerRef.current,
            });
        } else {
            const currentDoc = editorViewRef.current.state.doc.toString();
            if (currentDoc !== editedContent) {
                editorViewRef.current.dispatch({
                    changes: {
                        from: 0,
                        to: currentDoc.length,
                        insert: editedContent,
                    },
                });
            }
        }
    }, [selectedItem?.id]);

    // Cleanup editor on unmount
    useEffect(() => {
        return () => {
            if (editorViewRef.current) {
                editorViewRef.current.destroy();
                editorViewRef.current = null;
            }
        };
    }, []);

    // Per-scope live toggle handlers
    const handleToggleRequests = () => {
        updateSettings({
            ...settings,
            requestsEnabled: !settings.requestsEnabled,
        });
    };

    const handleToggleResponses = () => {
        updateSettings({
            ...settings,
            responsesEnabled: !settings.responsesEnabled,
        });
    };

    const handlePreset = (req: boolean, res: boolean) => {
        updateSettings({
            requestsEnabled: req,
            responsesEnabled: res,
        });
    };

    // Forward single item
    const handleForward = async (andSelectNext: boolean = false) => {
        if (!selectedItem) return;
        setActionLoading(true);
        setValidationError(null);

        const isModified = editedContent !== selectedItem.rawMessage;
        const payload = {
            id: selectedItem.id,
            modifiedMessage: isModified ? editedContent : null,
        };

        try {
            await invoke('forward_intercept_item', { payload });
            dispatch(removeQueueItem(selectedItem.id));

            if (andSelectNext && queue.length > 1) {
                const remaining = queue.filter((i) => i.id !== selectedItem.id);
                if (remaining.length > 0) {
                    dispatch(setSelectedId(remaining[0].id));
                }
            }
        } catch (err: any) {
            console.error('Failed to forward item:', err);
            setValidationError(typeof err === 'string' ? err : err.message || 'Validation error');
        } finally {
            setActionLoading(false);
        }
    };

    // Drop single item
    const handleDrop = async () => {
        if (!selectedItem) return;
        setActionLoading(true);
        try {
            await invoke('drop_intercept_item', { id: selectedItem.id });
            dispatch(removeQueueItem(selectedItem.id));
        } catch (err) {
            console.error('Failed to drop item:', err);
        } finally {
            setActionLoading(false);
        }
    };

    // Drop all items in queue
    const handleDropAll = async () => {
        if (queue.length === 0) return;
        setActionLoading(true);
        try {
            await invoke('drop_all_intercept_items');
            dispatch(clearQueue());
        } catch (err) {
            console.error('Failed to drop all items:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const isIntercepting = settings.requestsEnabled || settings.responsesEnabled;

    return (
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-card/50 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        {isIntercepting ? (
                            <ShieldAlert className="w-5 h-5 text-emerald-400 animate-pulse" />
                        ) : (
                            <ShieldOff className="w-5 h-5 text-muted-foreground" />
                        )}
                        <span className="font-semibold text-sm tracking-wide">
                            Proxy Intercept
                        </span>
                    </div>

                    <div className="h-4 w-px bg-border" />

                    {/* Scope Switches */}
                    <div className="flex items-center gap-4 bg-muted/30 px-3 py-1 rounded-md border">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="req-intercept"
                                checked={settings.requestsEnabled}
                                onCheckedChange={handleToggleRequests}
                            />
                            <Label htmlFor="req-intercept" className="cursor-pointer text-xs font-medium">
                                Requests
                            </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                            <Switch
                                id="res-intercept"
                                checked={settings.responsesEnabled}
                                onCheckedChange={handleToggleResponses}
                            />
                            <Label htmlFor="res-intercept" className="cursor-pointer text-xs font-medium">
                                Responses
                            </Label>
                        </div>
                    </div>

                    {/* Presets */}
                    <div className="flex items-center gap-1">
                        <Button
                            variant={settings.requestsEnabled && settings.responsesEnabled ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => handlePreset(true, true)}
                        >
                            Intercept All
                        </Button>
                        <Button
                            variant={settings.requestsEnabled && !settings.responsesEnabled ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => handlePreset(true, false)}
                        >
                            Req Only
                        </Button>
                        <Button
                            variant={!settings.requestsEnabled && settings.responsesEnabled ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => handlePreset(false, true)}
                        >
                            Res Only
                        </Button>
                        <Button
                            variant={!settings.requestsEnabled && !settings.responsesEnabled ? 'secondary' : 'outline'}
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => handlePreset(false, false)}
                        >
                            Passthrough
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Badge variant={isIntercepting ? 'default' : 'outline'} className={isIntercepting ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
                        {settings.requestsEnabled && settings.responsesEnabled
                            ? 'BOTH ACTIVE'
                            : settings.requestsEnabled
                            ? 'REQUESTS ACTIVE'
                            : settings.responsesEnabled
                            ? 'RESPONSES ACTIVE'
                            : 'PASSTHROUGH'}
                    </Badge>

                    {queue.length > 0 && (
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={handleDropAll}
                            disabled={actionLoading}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Drop All ({queue.length})
                        </Button>
                    )}
                </div>
            </div>

            {/* Main Split Body */}
            <div className="flex flex-1 min-h-0 divide-x divide-border">
                {/* Left Sidebar: Held Queue Items */}
                <div className="w-72 flex flex-col bg-muted/10 shrink-0">
                    <div className="p-2.5 border-b bg-card/30 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Held Items ({queue.length})
                        </span>
                        {queue.length > 0 && (
                            <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Waiting
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                        {queue.length === 0 ? (
                            <div className="p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                                <Shield className="w-8 h-8 opacity-30" />
                                <p className="text-xs">No held traffic</p>
                                <p className="text-[10px] opacity-70">
                                    {isIntercepting
                                        ? 'Matching in-flight traffic will pause here'
                                        : 'Turn on intercept to hold requests/responses'}
                                </p>
                            </div>
                        ) : (
                            queue.map((item) => {
                                const isSelected = item.id === selectedId;
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => dispatch(setSelectedId(item.id))}
                                        className={`p-2.5 cursor-pointer transition-colors hover:bg-accent/50 ${
                                            isSelected ? 'bg-accent border-l-2 border-primary font-medium' : ''
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1 mb-1">
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] uppercase font-mono px-1.5 py-0 ${
                                                    item.itemType === 'request'
                                                        ? 'border-cyan-500/50 text-cyan-400 bg-cyan-950/30'
                                                        : 'border-purple-500/50 text-purple-400 bg-purple-950/30'
                                                }`}
                                            >
                                                {item.itemType === 'request' ? 'REQ' : 'RES'}
                                            </Badge>
                                            <span className="text-[10px] font-mono text-muted-foreground">
                                                {new Date(Number(item.timestamp)).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div className="text-xs font-mono truncate text-foreground mb-0.5">
                                            {item.methodOrStatus}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1 font-mono">
                                            <Globe className="w-3 h-3 shrink-0" />
                                            {item.host}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right Panel: CodeMirror Raw Message Editor & Actions */}
                <div className="flex-1 flex flex-col bg-background min-w-0">
                    {selectedItem ? (
                        <>
                            {/* Item Toolbar */}
                            <div className="p-2 border-b bg-card/30 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant="default"
                                        className={
                                            selectedItem.itemType === 'request'
                                                ? 'bg-cyan-600 hover:bg-cyan-600'
                                                : 'bg-purple-600 hover:bg-purple-600'
                                        }
                                    >
                                        Intercepted {selectedItem.itemType.toUpperCase()}
                                    </Badge>
                                    <span className="text-xs font-mono text-muted-foreground truncate max-w-md">
                                        {selectedItem.host} — {selectedItem.methodOrStatus}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                                        onClick={() => handleForward(false)}
                                        disabled={actionLoading}
                                    >
                                        <Play className="w-3.5 h-3.5 fill-white" />
                                        Forward
                                    </Button>

                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="h-8 gap-1"
                                        onClick={() => handleForward(true)}
                                        disabled={actionLoading || queue.length <= 1}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                        Forward & Next
                                    </Button>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1 border-rose-500/50 text-rose-400 hover:bg-rose-950/30"
                                        onClick={handleDrop}
                                        disabled={actionLoading}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Drop
                                    </Button>
                                </div>
                            </div>

                            {/* Validation error notification */}
                            {validationError && (
                                <div className="bg-rose-950/60 border-b border-rose-800 p-2 text-rose-200 text-xs font-mono flex items-center gap-2">
                                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                                    <span>{validationError}</span>
                                </div>
                            )}

                            {/* CodeMirror 6 Editor */}
                            <div className="flex-1 min-h-0 relative">
                                <div ref={editorContainerRef} className="absolute inset-0" />
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                            <Shield className="w-12 h-12 opacity-20" />
                            <p className="text-sm">No item selected</p>
                            <p className="text-xs opacity-70">
                                Select an intercepted item from the left queue to view and edit raw HTTP headers & body.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InterceptorPage;
