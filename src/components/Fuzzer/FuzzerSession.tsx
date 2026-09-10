import React, { useCallback, useMemo, useState, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Layers, Plus, SlidersVertical, History, Search, X, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    addFuzzSession,
    deleteFuzzSession,
    deleteFuzzHistory,
    renameFuzzSession,
    setSelectedFuzz,
    setFuzzerExpandedIds,
    persistFuzzerUiState,
    selectFuzzerSessionTree,
    equalFuzzerSessionTree,
} from '@/store/slices/fuzzerSlice';
import { RsTree, TreeNode, TreeNodeRenderProps, HighlightedText } from 'rstree-ui';
import { RunningDot } from '@/components/ui/RunningDot';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';

const FuzzSession: React.FC = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    // High-performance selector: only re-renders when sessions/histories are created/selected
    // or run status toggles, completely ignoring high-frequency progress/worker ticks.
    const { activeSessionIndex, activeHistoryIndex, expandedIds, sessions } = useAppSelector(
        selectFuzzerSessionTree(projectId),
        equalFuzzerSessionTree
    );

    const totalSessions = sessions.length;

    const [searchTerm, setSearchTerm] = useState('');
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [removingItem, setRemovingItem] = useState<{
        type: 'session' | 'history';
        sessIdx: number;
        histIdx: number | null;
        label: string;
    } | null>(null);
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const data: TreeNode<unknown>[] = useMemo(() =>
        sessions.map((s, colIndex) => ({
            id: `${colIndex}`,
            label: s.name || `Session ${colIndex + 1}`,
            children: s.histories.map((h, sessIndex) => ({
                id: `${colIndex}-${sessIndex}`,
                label: h.date,
            })),
        })),
        [sessions]
    );

    const selectedIds = useMemo(() => {
        if (activeSessionIndex === null || activeSessionIndex === undefined) return [];
        return [
            activeHistoryIndex === null || activeHistoryIndex === undefined
                ? `${activeSessionIndex}`
                : `${activeSessionIndex}-${activeHistoryIndex}`
        ];
    }, [activeSessionIndex, activeHistoryIndex]);

    const handleCreateFuzzSession = useCallback(() => {
        if (projectId) {
            dispatch(addFuzzSession({ name: "Session", targetUrl: "", isItFuzzerPage: true, projectId }));
            invoke('create_fuzzer_session_db', {
                projectId,
                name: "Session",
                targetUrl: "",
                rawRequest: "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n",
            }).catch(console.error);
            dispatch(persistFuzzerUiState(projectId));
        }
    }, [dispatch, projectId]);

    const handleExpand = useCallback((ids: string[]) => {
        if (!projectId) return;
        dispatch(setFuzzerExpandedIds({ projectId, expandedIds: ids }));
        dispatch(persistFuzzerUiState(projectId));
    }, [dispatch, projectId]);

    const handleSelection = useCallback((value: string[]) => {
        if (!projectId) return;
        if (value.length >= 1) {
            if (value[0].includes("-")) {
                const [sessionId, historyId] = value[0].split("-");
                const sessIdx = Number(sessionId);
                const histIdx = Number(historyId);
                dispatch(setSelectedFuzz({ sessionIndex: sessIdx, historyIndex: histIdx, projectId }));
            } else {
                const sessIdx = Number(value[0]);
                dispatch(setSelectedFuzz({ sessionIndex: sessIdx, historyIndex: null, projectId }));
            }
        } else {
            dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null, projectId }));
        }
        dispatch(persistFuzzerUiState(projectId));
    }, [dispatch, projectId]);

    const handleConfirmRemove = async () => {
        if (!removingItem || !projectId) return;
        const item = removingItem;
        setRemoveDialogOpen(false);
        setRemovingItem(null);

        try {
            if (item.type === 'session') {
                dispatch(deleteFuzzSession({ sessionIndex: item.sessIdx, projectId }));
                await invoke('delete_fuzzer_session_db', {
                    projectId,
                    sessionIndex: item.sessIdx,
                });
            } else if (item.type === 'history' && item.histIdx !== null) {
                dispatch(deleteFuzzHistory({
                    sessionIndex: item.sessIdx,
                    historyIndex: item.histIdx,
                    projectId,
                }));
                await invoke('delete_fuzzer_history_db', {
                    projectId,
                    sessionIndex: item.sessIdx,
                    historyIndex: item.histIdx,
                });
            }
            dispatch(persistFuzzerUiState(projectId));
        } catch (err) {
            console.error('Failed to delete fuzzer item:', err);
            toast.error(typeof err === 'string' ? err : 'Failed to delete item', { position: 'top-center' });
        }
    };

    const handleSaveInline = (sessIdx: number) => {
        if (!editingNodeId || !projectId) return;
        const trimmed = editingText.trim();
        if (trimmed) {
            dispatch(renameFuzzSession({ sessionIndex: sessIdx, name: trimmed, projectId }));
            invoke('save_fuzzer_session_draft', {
                projectId,
                sessionIndex: sessIdx,
                name: trimmed,
            }).catch(console.error);
        }
        setEditingNodeId(null);
    };

    const renderNode = (node: TreeNode<unknown>, props: TreeNodeRenderProps<unknown>) => {
        const isHistory = node.id.includes('-');
        const [sessIdxStr, histIdxStr] = node.id.split('-');
        const sessIdx = Number(sessIdxStr);
        const histIdx = isHistory ? Number(histIdxStr) : null;

        const s = sessions[sessIdx];
        const isCurrentActiveSession = !isHistory && sessIdx === activeSessionIndex && activeHistoryIndex !== null && activeHistoryIndex !== undefined;
        const isSelected = isHistory
            ? sessIdx === activeSessionIndex && histIdx === activeHistoryIndex
            : sessIdx === activeSessionIndex && (activeHistoryIndex === null || activeHistoryIndex === undefined);

        const isRunning = isHistory
            ? s?.histories[histIdx!]?.isRunning
            : s?.histories.some((h) => h.isRunning);

        const isEditing = editingNodeId === node.id;

        const handleNodeClick = (e: React.MouseEvent) => {
            if (!projectId || isEditing) return;
            e.stopPropagation();
            if (isSelected) {
                // Clicking an already selected item deselects it
                dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null, projectId }));
            } else if (isHistory) {
                dispatch(setSelectedFuzz({ sessionIndex: sessIdx, historyIndex: histIdx, projectId }));
            } else {
                // Clicking the session / payload node switches directly to the payload editor
                dispatch(setSelectedFuzz({ sessionIndex: sessIdx, historyIndex: null, projectId }));
            }
            dispatch(persistFuzzerUiState(projectId));
        };

        const handleEditClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isHistory) return;
            setEditingNodeId(node.id);
            setEditingText(s?.name || `Session ${sessIdx + 1}`);
        };

        const handleRemoveClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            setRemovingItem({
                type: isHistory ? 'history' : 'session',
                sessIdx,
                histIdx,
                label: isHistory ? (s?.histories[histIdx!]?.date || node.label) : (s?.name || node.label),
            });
            setRemoveDialogOpen(true);
        };

        return (
            <div
                onClick={handleNodeClick}
                className={cn(
                    "flex items-center justify-between w-full group/node py-0.5 min-w-0 transition-colors rounded-sm pr-1 cursor-pointer",
                    isCurrentActiveSession && "text-primary font-medium",
                    isSelected && "text-accent-foreground font-medium"
                )}
            >
                {isEditing ? (
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1" onClick={(e) => e.stopPropagation()}>
                        <SlidersVertical className="w-3.5 h-3.5 text-primary shrink-0" />
                        <Input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveInline(sessIdx);
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingNodeId(null);
                                }
                            }}
                            onBlur={() => handleSaveInline(sessIdx)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            autoFocus
                            className="h-5 text-xs font-mono px-1 py-0 bg-background border-primary/50 flex-1 min-w-0 shadow-none focus-visible:ring-1 focus-visible:ring-primary"
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
                        {!isHistory ? (
                            <SlidersVertical
                                className={cn(
                                    "w-3.5 h-3.5 shrink-0 transition-colors",
                                    isCurrentActiveSession || isSelected ? "text-primary" : "text-muted-foreground/70"
                                )}
                            />
                        ) : (
                            <History
                                className={cn(
                                    "w-3 h-3 shrink-0 transition-colors",
                                    isSelected ? "text-primary" : "text-muted-foreground/60"
                                )}
                            />
                        )}
                        <span
                            className={cn(
                                "truncate text-xs font-mono select-none transition-colors",
                                !isHistory
                                    ? (isCurrentActiveSession || isSelected ? "font-semibold text-foreground" : "font-medium text-foreground/80")
                                    : (isSelected ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground")
                            )}
                        >
                            <HighlightedText text={node.label} matches={props.node.searchMatches || []} />
                        </span>

                        {!isHistory && s && s.histories.length > 0 && (
                            <span
                                className={cn(
                                    "text-[9px] font-mono ml-auto mr-1 px-1.5 py-0.2 rounded-full transition-colors",
                                    isCurrentActiveSession || isSelected
                                        ? "bg-primary/15 text-primary font-semibold"
                                        : "text-muted-foreground/50 bg-muted/30"
                                )}
                            >
                                {s.histories.length}
                            </span>
                        )}
                    </div>
                )}

                {isRunning && (
                    <RunningDot className="ml-1 shrink-0" />
                )}

                {!isEditing && (
                    <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover/node:opacity-100 transition-opacity">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground/70 transition-colors data-[state=open]:opacity-100"
                                >
                                    <MoreHorizontal className="w-3 h-3" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36 text-xs">
                                {!isHistory && (
                                    <DropdownMenuItem onClick={handleEditClick}>
                                        <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                    onClick={handleRemoveClick}
                                >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-card/30 border-r border-border/40 select-none overflow-hidden">
            {/* Minimal Header Bar */}
            <div className="flex items-center justify-between px-3 h-10 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Sessions
                    </span>
                    {totalSessions > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground">
                            {totalSessions}
                        </span>
                    )}
                </div>

                <TooltipProvider delayDuration={200}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleCreateFuzzSession}
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            >
                                <Plus className="w-3.5 h-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[11px] py-0.5 px-2">
                            New Fuzzing Session
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {/* Integrated Slim Search Bar */}
            <div className="p-2 border-b border-border/20 shrink-0">
                <div className="relative flex items-center">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                    <Input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Filter sessions..."
                        className="h-7 text-xs font-mono pl-8 pr-7 bg-muted/20 hover:bg-muted/40 focus-visible:bg-background border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40 rounded-md"
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-0.5 rounded"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Tree Area */}
            <div
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1.5 cursor-default"
                onClick={(e) => {
                    if (!projectId) return;
                    if (e.target === e.currentTarget && (activeSessionIndex !== null || activeHistoryIndex !== null)) {
                        dispatch(setSelectedFuzz({ sessionIndex: null, historyIndex: null, projectId }));
                        dispatch(persistFuzzerUiState(projectId));
                    }
                }}
            >
                {sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center px-4 gap-2 text-muted-foreground">
                        <Layers className="w-8 h-8 opacity-20" />
                        <p className="text-xs">No fuzzing sessions</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCreateFuzzSession}
                            className="h-7 text-xs gap-1 font-medium mt-1"
                        >
                            <Plus className="w-3 h-3" /> Create Session
                        </Button>
                    </div>
                ) : (
                    <RsTree
                        key={`${projectId || 'fuzzer'}-${activeSessionIndex ?? 'none'}-${activeHistoryIndex ?? 'none'}`}
                        searchTerm={searchTerm}
                        className="!h-full bg-transparent border-none"
                        data={data}
                        renderNode={renderNode}
                        treeLineClassName="!border-border/30"
                        treeNodeClassName="
                            !bg-transparent
                            !text-muted-foreground
                            hover:!bg-accent/40 hover:!text-foreground
                            aria-selected:!bg-accent/70 aria-selected:!text-accent-foreground aria-selected:font-medium
                            rounded-md text-xs font-mono transition-colors py-0.5
                        "
                        selectedIds={selectedIds}
                        expandedIds={expandedIds}
                        onExpand={handleExpand}
                        onSelect={handleSelection}
                        clickToToggle={false}
                        showIcons={false}
                        virtualizeEnabled={true}
                    />
                )}
            </div>

            {/* Confirmation Dialog */}
            <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">
                            Delete {removingItem?.type === 'session' ? 'Session' : 'Fuzz History'}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground pt-1">
                            Are you sure you want to delete <span className="font-semibold text-foreground">"{removingItem?.label}"</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setRemoveDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleConfirmRemove}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default React.memo(FuzzSession);