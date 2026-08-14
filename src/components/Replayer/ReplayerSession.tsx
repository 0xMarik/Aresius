import React, { useState, useMemo, useCallback } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useAppDispatch, useAppSelector } from '@/hooks/redux'
import { useProjectId } from '@/hooks/useProjectId'
import {
    addCollection,
    addSessionToCollection,
    selectColSess,
    setExpandedIds,
    removeCollection,
    removeSession,
    renameCollection,
    renameSession,
    selectReplayerState,
} from '@/store/slices/replayerSlice'
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
import { ReplayerCollection } from '@/types/replayer.type'

interface RemoveTarget {
    id: string;
    type: 'collection' | 'session';
    colIndex: number;
    sessIndex?: number;
    label: string;
}

const ReplayerSession = ({ collections }: { collections: ReplayerCollection[] }) => {
    const dispatch = useAppDispatch()
    const projectId = useProjectId()
    const { selectedCollectionIndex, expandedIds: reduxExpandedIds } = useAppSelector(selectReplayerState(projectId));
    const selectedSessionIndex = collections[selectedCollectionIndex]?.selectedSessionIndex ?? null;

    const selectedIds = useMemo(() => {
        if (selectedCollectionIndex < 0 || selectedCollectionIndex >= collections.length) return [];
        const col = collections[selectedCollectionIndex];
        if (!col) return [];
        const colId = col.id || `${selectedCollectionIndex}`;
        if (selectedSessionIndex !== null && selectedSessionIndex >= 0 && selectedSessionIndex < col.sessions.length) {
            const sess = col.sessions[selectedSessionIndex];
            const sessId = sess?.id || `${selectedSessionIndex}`;
            return [`sess::${colId}::${sessId}`];
        }
        return [];
    }, [selectedCollectionIndex, selectedSessionIndex, collections]);

    const expandedIds = useMemo(() => {
        return reduxExpandedIds || [];
    }, [reduxExpandedIds]);

    const [searchTerm, setSearchTerm] = useState('')

    // Inline edit state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');

    // Remove dialog state
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [removingItem, setRemovingItem] = useState<RemoveTarget | null>(null);

    const data: TreeNode<unknown>[] = useMemo(() => collections.map((collection, colIndex) => {
        const colId = collection.id || `${colIndex}`;
        return {
            id: colId,
            label: collection.name || `Collection ${colIndex + 1}`,
            icon: <Folder size={16} />,
            children: collection.sessions.map((session, sessIndex) => {
                const sessId = session.id || `${sessIndex}`;
                return {
                    id: `sess::${colId}::${sessId}`,
                    label: session.name || `Session ${sessIndex + 1} - ${session.url}`,
                    icon: <File size={16} />
                };
            })
        };
    }), [collections]);

    const handleExpand = useCallback((newExpandedIds: string[]) => {
        if (projectId) {
            dispatch(setExpandedIds({ expandedIds: newExpandedIds, projectId }));
        }
    }, [projectId, dispatch]);

    const handleSelection = useCallback((value: string[]) => {
        if (!value || value.length === 0 || !projectId) return;
        const selectedId = value[0];

        if (selectedId && selectedId.startsWith('sess::')) {
            const [_, colPart, sessPart] = selectedId.split('::');
            let colIdx = collections.findIndex((c, i) => c.id === colPart || `${i}` === colPart || `col_${i}` === colPart);
            if (colIdx === -1) colIdx = Number(colPart);
            if (colIdx >= 0 && colIdx < collections.length) {
                const col = collections[colIdx];
                let sessIdx = col.sessions.findIndex((s, i) => s.id === sessPart || `${i}` === sessPart);
                if (sessIdx === -1) sessIdx = Number(sessPart);
                dispatch(selectColSess({
                    collectionIndex: colIdx,
                    sessionIndex: sessIdx >= 0 && sessIdx < col.sessions.length ? sessIdx : (col.sessions.length > 0 ? 0 : null),
                    projectId
                }));
            }
        }
    }, [collections, projectId, dispatch]);

    const handleConfirmRemove = () => {
        if (!removingItem || !projectId) return;
        if (removingItem.type === 'collection') {
            dispatch(removeCollection({ collectionIndex: removingItem.colIndex, projectId }));
        } else if (removingItem.type === 'session' && removingItem.sessIndex !== undefined) {
            dispatch(removeSession({ collectionIndex: removingItem.colIndex, sessionIndex: removingItem.sessIndex, projectId }));
        }
        setRemoveDialogOpen(false);
        setRemovingItem(null);
    };

    const renderNode = (node: TreeNode<unknown>, props: TreeNodeRenderProps<unknown>) => {
        const isSession = node.id.startsWith('sess::');
        const isCollection = !isSession;

        let colIndex = -1;
        let sessIndex: number | undefined = undefined;

        if (isSession) {
            const [_, colPart, sessPart] = node.id.split('::');
            colIndex = collections.findIndex((c, i) => c.id === colPart || `${i}` === colPart || `col_${i}` === colPart);
            if (colIndex === -1) colIndex = Number(colPart);
            if (colIndex >= 0 && colIndex < collections.length) {
                sessIndex = collections[colIndex].sessions.findIndex((s, i) => s.id === sessPart || `${i}` === sessPart);
                if (sessIndex === -1) sessIndex = Number(sessPart);
            }
        } else {
            const colPart = node.id;
            colIndex = collections.findIndex((c, i) => c.id === colPart || `${i}` === colPart || `col_${i}` === colPart);
            if (colIndex === -1) colIndex = Number(colPart);
        }

        const isCurrentActiveCollection = isCollection && colIndex === selectedCollectionIndex && selectedSessionIndex !== null;
        const isEditing = editingNodeId === node.id;

        const handleSaveInline = () => {
            if (!editingNodeId || !projectId) return;
            const trimmed = editingText.trim();
            if (isCollection && colIndex >= 0) {
                dispatch(renameCollection({ collectionIndex: colIndex, name: trimmed, projectId }));
            } else if (sessIndex !== undefined && colIndex >= 0) {
                dispatch(renameSession({ collectionIndex: colIndex, sessionIndex: sessIndex, name: trimmed, projectId }));
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
                ? (collections[colIndex]?.name || `Collection ${colIndex + 1}`)
                : (collections[colIndex]?.sessions[sessIndex!]?.name || `Session ${sessIndex! + 1}`);

            setEditingNodeId(node.id);
            setEditingText(currentLabel);
        };

        const handleRemoveClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            setRemovingItem({
                id: node.id,
                type: isCollection ? 'collection' : 'session',
                colIndex,
                sessIndex,
                label: node.label
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

    return (
        <div className='h-full'>
            <ButtonGroup className="my-2 mx-auto">
                <Button className=' w-full' onClick={
                    () => {
                        if (projectId) {
                            const targetColIdx = (selectedCollectionIndex >= 0 && selectedCollectionIndex < collections.length)
                                ? selectedCollectionIndex
                                : 0;
                            dispatch(addSessionToCollection({ collectionIndex: targetColIdx, isItReplayerPage: true, projectId }));
                        }
                    }}><Plus /> New Session</Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="default" className="pl-2!">
                            <ChevronDownIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => {
                            if (projectId) dispatch(addCollection(projectId));
                        }}>
                            <Plus />
                            New Collection
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </ButtonGroup>
            <div className="rounded-lg p-1 w-full h-full ">
                <Input value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                />
                <RsTree
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
    )
}

export default ReplayerSession
