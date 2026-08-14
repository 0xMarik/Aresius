import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useReplayerTree } from '@/context/ReplayerContext';
import { useProjectId } from '@/hooks/useProjectId';
import { RsTree, TreeNode, HighlightedText, TreeNodeRenderProps } from 'rstree-ui';
import { ChevronDownIcon, Plus, Folder, File, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

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

const ReplayerSession = () => {
    const projectId = useProjectId();
    const {
        collections,
        expandedIds,
        selectedCollectionId,
        selectedSessionId,
        isLoaded,
        selectSession,
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

    const data: TreeNode<unknown>[] = useMemo(() => collections.map((collection, colIndex) => {
        const colId = collection.id;
        const children = collection.sessions.length > 0
            ? collection.sessions.map((session, sessIndex) => ({
                id: `sess::${colId}::${session.id}`,
                label: session.name || `Session ${sessIndex + 1}`,
                icon: <File size={16} />,
            }))
            : [{
                id: `create_sess::${colId}`,
                label: 'Create a session',
                icon: <Plus size={14} />,
            }];

        return {
            id: colId,
            label: collection.name || `Collection ${colIndex + 1}`,
            icon: <Folder size={16} />,
            children,
        };
    }), [collections]);

    const handleExpand = useCallback((newExpandedIds: string[]) => {
        setExpandedIdsList(newExpandedIds);
    }, [setExpandedIdsList]);

    const handleSelection = useCallback((value: string[]) => {
        if (!value || value.length === 0) return;
        const parsed = parseTreeNodeId(value[0]);
        if (parsed.isCreateAction && parsed.colId) {
            createSession(parsed.colId);
            return;
        }
        if (parsed.isSession && parsed.colId && parsed.sessId) {
            selectSession(parsed.colId, parsed.sessId);
        }
    }, [createSession, selectSession]);

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

    const renderNode = (node: TreeNode<unknown>, props: TreeNodeRenderProps<unknown>) => {
        const { isSession, isCreateAction, colId, sessId } = parseTreeNodeId(node.id);

        if (isCreateAction) {
            return (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        createSession(colId);
                    }}
                    className="flex items-center gap-1.5 w-full text-muted-foreground/70 hover:text-primary transition-colors text-xs py-0.5 select-none font-mono cursor-pointer group/add"
                >
                    <Plus size={13} className="shrink-0 text-muted-foreground/70 group-hover/add:text-primary transition-colors" />
                    <span className="truncate italic">Create a session</span>
                </div>
            );
        }

        const isCollection = !isSession;
        const isCurrentActiveCollection = isCollection && colId === selectedCollectionId && selectedSessionId !== null;
        const isEditing = editingNodeId === node.id;

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
            const col = collections.find(c => c.id === colId);
            const currentLabel = isCollection
                ? (col?.name || 'Collection')
                : (col?.sessions.find(s => s.id === sessId)?.name || 'Session');

            setEditingNodeId(node.id);
            setEditingText(currentLabel);
        };

        const handleRemoveClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            setRemovingItem({
                id: node.id,
                type: isCollection ? 'collection' : 'session',
                colId,
                sessId,
                label: node.label,
            });
            setRemoveDialogOpen(true);
        };

        return (
            <div className={`flex items-center justify-between w-full group/node pr-1 min-w-0 ${isCurrentActiveCollection ? 'text-primary font-medium' : ''}`}>
                {isEditing ? (
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1" onClick={(e) => e.stopPropagation()}>
                        {isCollection ? (
                            <Folder size={15} className={`shrink-0 ${isCurrentActiveCollection ? 'text-primary' : 'text-muted-foreground'}`} />
                        ) : (
                            <File size={15} className="shrink-0 text-muted-foreground" />
                        )}
                        <Input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={handleSaveInline}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            autoFocus
                            className="h-6 text-[13px] font-mono px-1 py-0 bg-background border-primary/50 flex-1 min-w-0"
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
                        {isCollection ? (
                            <Folder size={15} className={`shrink-0 ${isCurrentActiveCollection ? 'text-primary' : 'text-muted-foreground'}`} />
                        ) : (
                            <File size={15} className="shrink-0 text-muted-foreground" />
                        )}
                        <span className={`truncate text-[13px] font-mono select-none ${isCurrentActiveCollection ? 'text-foreground font-semibold' : ''}`}>
                            <HighlightedText text={node.label} matches={props.node.searchMatches || []} />
                        </span>
                    </div>
                )}
                {!isEditing && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 p-0 opacity-0 group-hover/node:opacity-100 data-[state=open]:opacity-100 transition-opacity hover:bg-accent hover:text-accent-foreground shrink-0 ml-1"
                            >
                                <MoreHorizontal size={14} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onClick={handleEditClick}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                onClick={handleRemoveClick}
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        );
    };

    const handleNewSession = () => {
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
        <div className="h-full">
            <ButtonGroup className="my-2 mx-auto">
                <Button className="w-full" onClick={handleNewSession}>
                    <Plus /> New Session
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="default" className="pl-2!">
                            <ChevronDownIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => createCollection()}>
                            <Plus />
                            New Collection
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </ButtonGroup>
            <div className="rounded-lg p-1 w-full h-full">
                <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                />
                {isLoaded && (
                    <RsTree
                        key={projectId || 'replayer-tree'}
                        searchTerm={searchTerm}
                        className="!h-full bg-transparent border-none"
                        data={data}
                        renderNode={renderNode}
                        treeLineClassName="!border-border/40"
                        treeNodeClassName="
                            !bg-transparent
                            !text-muted-foreground
                            hover:!bg-accent/50 hover:!text-foreground
                            aria-selected:!bg-accent aria-selected:!text-accent-foreground
                            rounded-sm text-[13px] font-mono transition-colors
                        "
                        selectedIds={selectedIds}
                        onSelect={handleSelection}
                        expandedIds={expandedIds}
                        onExpand={handleExpand}
                        clickToToggle={true}
                        showIcons={false}
                        virtualizeEnabled={true}
                    />
                )}
            </div>

            {/* Remove Confirmation Dialog */}
            <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Delete {removingItem?.type === 'collection' ? 'Collection' : 'Session'}</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <span className="font-semibold text-foreground">"{removingItem?.label}"</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={() => setRemoveDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleConfirmRemove}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default React.memo(ReplayerSession);
