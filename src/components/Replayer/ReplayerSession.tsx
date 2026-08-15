import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useReplayerTree } from '@/context/ReplayerContext';
import { useProjectId } from '@/hooks/useProjectId';
import { RsTree, TreeNode, HighlightedText, TreeNodeRenderProps } from 'rstree-ui';
import {
    Plus,
    Folder,
    FolderOpen,
    FolderPlus,
    Search,
    X,
    MoreHorizontal,
    Pencil,
    Trash2,
    Layers,
    FileCode2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
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
import { cn } from '@/lib/utils';

interface RemoveTarget {
    id: string;
    type: 'collection' | 'session';
    colId: string;
    sessId?: string;
    label: string;
}

function parseTreeNodeId(nodeId: string): { isSession: boolean; isCreateAction: boolean; colId: string; sessId?: string } {
    if (nodeId.startsWith('sess::')) {
        const parts = nodeId.split('::');
        return { isSession: true, isCreateAction: false, colId: parts[1], sessId: parts[2] };
    }
    if (nodeId.startsWith('create_sess::')) {
        const parts = nodeId.split('::');
        return { isSession: false, isCreateAction: true, colId: parts[1] };
    }
    return { isSession: false, isCreateAction: false, colId: nodeId };
}

const ReplayerSession: React.FC = () => {
    const projectId = useProjectId();
    const {
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        isLoaded,
        selectSession,
        deselectSession,
        setExpandedIdsList,
        createCollection,
        createSession,
        renameCollection,
        renameSession,
        deleteCollection,
        deleteSession,
    } = useReplayerTree();

    const selectedIds = useMemo(() => {
        if (!selectedCollectionId || !selectedSessionId) return [];
        return [`sess::${selectedCollectionId}::${selectedSessionId}`];
    }, [selectedCollectionId, selectedSessionId]);

    const [searchTerm, setSearchTerm] = useState('');
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [removingItem, setRemovingItem] = useState<RemoveTarget | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const totalSessions = useMemo(() => {
        return collections.reduce((acc, c) => acc + c.sessions.length, 0);
    }, [collections]);

    const data: TreeNode<unknown>[] = useMemo(() => collections.map((collection, colIndex) => {
        const colId = collection.id;
        const isExpanded = expandedIds.includes(colId);

        const children = collection.sessions.length > 0
            ? collection.sessions.map((session, sessIndex) => ({
                id: `sess::${colId}::${session.id}`,
                label: session.name || `Session ${sessIndex + 1}`,
                icon: <FileCode2 className="w-3.5 h-3.5 text-muted-foreground/70" />,
            }))
            : [{
                id: `create_sess::${colId}`,
                label: 'Create a session',
                icon: <Plus className="w-3 h-3 text-muted-foreground/60" />,
            }];

        return {
            id: colId,
            label: collection.name || `Collection ${colIndex + 1}`,
            icon: isExpanded
                ? <FolderOpen className="w-3.5 h-3.5 text-muted-foreground/80" />
                : <Folder className="w-3.5 h-3.5 text-muted-foreground/80" />,
            children,
        };
    }), [collections, expandedIds]);

    const handleExpand = useCallback((newExpandedIds: string[]) => {
        setExpandedIdsList(newExpandedIds);
    }, [setExpandedIdsList]);

    const handleSelection = useCallback((value: string[]) => {
        if (!value || value.length === 0) {
            deselectSession();
            return;
        }
        const parsed = parseTreeNodeId(value[0]);
        if (parsed.isCreateAction && parsed.colId) {
            createSession(parsed.colId);
            return;
        }
        if (parsed.isSession && parsed.colId && parsed.sessId) {
            selectSession(parsed.colId, parsed.sessId);
        }
    }, [createSession, deselectSession, selectSession]);

    const handleConfirmRemove = async () => {
        if (!removingItem) return;
        if (removingItem.type === 'collection') {
            await deleteCollection(removingItem.colId);
        } else if (removingItem.type === 'session' && removingItem.sessId) {
            await deleteSession(removingItem.colId, removingItem.sessId);
        }
        setRemoveDialogOpen(false);
        setRemovingItem(null);
    };

    const handleNewSession = async () => {
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

    const renderNode = (node: TreeNode<unknown>, props: TreeNodeRenderProps<unknown>) => {
        const { isSession, isCreateAction, colId, sessId } = parseTreeNodeId(node.id);

        if (isCreateAction) {
            return (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        createSession(colId);
                    }}
                    className="flex items-center gap-1.5 w-full text-muted-foreground/60 hover:text-primary transition-colors text-[11px] py-1 select-none font-mono cursor-pointer group/add pl-1"
                >
                    <Plus className="w-3 h-3 text-muted-foreground/60 group-hover/add:text-primary transition-colors shrink-0" />
                    <span className="truncate italic">Create a session</span>
                </div>
            );
        }

        const isCollection = !isSession;
        const col = collections.find(c => c.id === colId);
        const colIndex = collections.findIndex(c => c.id === colId);
        const isDefaultCollection = isCollection && (colIndex === 0 || collections.length <= 1);
        const canDelete = isSession || !isDefaultCollection;

        const isCurrentActiveCollection = isCollection && colId === selectedCollectionId && selectedSessionId !== null;
        const isSelectedSession = isSession && sessId === selectedSessionId;
        const isEditing = editingNodeId === node.id;
        const isExpanded = isCollection && expandedIds.includes(colId);

        const handleSaveInline = () => {
            if (!editingNodeId) return;
            const trimmed = editingText.trim();
            if (trimmed) {
                if (isCollection) {
                    renameCollection(colId, trimmed);
                } else if (sessId) {
                    renameSession(colId, sessId, trimmed);
                }
            }
            setEditingNodeId(null);
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveInline();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditingNodeId(null);
            }
        };

        const handleEditClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            const currentLabel = isCollection
                ? (col?.name || 'Collection')
                : (col?.sessions.find(s => s.id === sessId)?.name || 'Session');

            setEditingNodeId(node.id);
            setEditingText(currentLabel);
        };

        const handleRemoveClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!canDelete) return;

            setRemovingItem({
                id: node.id,
                type: isCollection ? 'collection' : 'session',
                colId,
                sessId,
                label: node.label,
            });
            setRemoveDialogOpen(true);
        };

        const handleQuickAddSession = (e: React.MouseEvent) => {
            e.stopPropagation();
            createSession(colId);
        };

        return (
            <div
                className={cn(
                    "flex items-center justify-between w-full group/node py-0.5 min-w-0 transition-colors rounded-sm",
                    isCurrentActiveCollection && "text-primary font-medium",
                    isSelectedSession && "text-accent-foreground font-medium"
                )}
            >
                {isEditing ? (
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1" onClick={(e) => e.stopPropagation()}>
                        {isCollection ? (
                            isExpanded ? (
                                <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                            ) : (
                                <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                            )
                        ) : (
                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <Input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={handleSaveInline}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            autoFocus
                            className="h-5 text-xs font-mono px-1 py-0 bg-background border-primary/50 flex-1 min-w-0 shadow-none focus-visible:ring-1 focus-visible:ring-primary"
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
                        {isCollection ? (
                            isExpanded ? (
                                <FolderOpen className={cn("w-3.5 h-3.5 shrink-0 transition-colors", isCurrentActiveCollection ? "text-primary" : "text-foreground/70")} />
                            ) : (
                                <Folder className={cn("w-3.5 h-3.5 shrink-0 transition-colors", isCurrentActiveCollection ? "text-primary" : "text-muted-foreground/70")} />
                            )
                        ) : (
                            <FileCode2 className={cn("w-3.5 h-3.5 shrink-0 transition-colors", isSelectedSession ? "text-primary" : "text-muted-foreground/60")} />
                        )}
                        <span
                            className={cn(
                                "truncate text-xs font-mono select-none transition-colors",
                                isCollection
                                    ? (isCurrentActiveCollection ? "font-semibold text-foreground" : "font-medium text-foreground/80")
                                    : (isSelectedSession ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground")
                            )}
                        >
                            <HighlightedText text={node.label} matches={props.node.searchMatches || []} />
                        </span>

                        {isCollection && col && col.sessions.length > 0 && (
                            <span className={cn(
                                "text-[9px] font-mono ml-auto mr-1 px-1.5 py-0.2 rounded-full transition-colors",
                                isCurrentActiveCollection
                                    ? "bg-primary/15 text-primary font-semibold"
                                    : "text-muted-foreground/50 bg-muted/30"
                            )}>
                                {col.sessions.length}
                            </span>
                        )}
                    </div>
                )}

                {!isEditing && (
                    <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover/node:opacity-100 transition-opacity">
                        {isCollection && (
                            <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            onClick={handleQuickAddSession}
                                            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground/70 transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-[11px] py-0.5 px-2">
                                        New session in {col?.name || 'collection'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}

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
                                {isCollection && (
                                    <>
                                        <DropdownMenuItem onClick={handleQuickAddSession}>
                                            <Plus className="w-3.5 h-3.5 mr-2" /> New Session
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}
                                <DropdownMenuItem onClick={handleEditClick}>
                                    <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                                </DropdownMenuItem>
                                {canDelete && (
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                        onClick={handleRemoveClick}
                                    >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
                                    </DropdownMenuItem>
                                )}
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

                <div className="flex items-center gap-1">
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => createCollection()}
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                >
                                    <FolderPlus className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[11px] py-0.5 px-2">
                                New Collection
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleNewSession}
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[11px] py-0.5 px-2">
                                New Session
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
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
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1.5">
                {isLoaded && collections.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center px-4 gap-2 text-muted-foreground">
                        <Layers className="w-8 h-8 opacity-20" />
                        <p className="text-xs">No collections yet</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => createCollection()}
                            className="h-7 text-xs gap-1 font-medium mt-1"
                        >
                            <FolderPlus className="w-3 h-3" /> Create Collection
                        </Button>
                    </div>
                ) : (
                    isLoaded && (
                        <RsTree
                            key={`${projectId || 'replayer'}-${selectedSessionId ?? 'none'}`}
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
                            onSelect={handleSelection}
                            expandedIds={expandedIds}
                            onExpand={handleExpand}
                            clickToToggle={true}
                            showIcons={false}
                            virtualizeEnabled={true}
                        />
                    )
                )}
            </div>

            {/* Remove Confirmation Dialog */}
            <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">
                            Delete {removingItem?.type === 'collection' ? 'Collection' : 'Session'}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground pt-1">
                            Are you sure you want to delete <span className="font-semibold text-foreground">"{removingItem?.label}"</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setRemoveDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={handleConfirmRemove}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default React.memo(ReplayerSession);
