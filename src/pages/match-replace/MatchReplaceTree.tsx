import React, { useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
    SlidersHorizontal,
    Crosshair,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { MatchReplaceCollection, MatchReplaceRule } from './types';

interface RemoveTarget {
    id: string;
    type: 'collection' | 'rule';
    colId: string;
    ruleId?: string;
    label: string;
}

interface MatchReplaceTreeProps {
    collections: MatchReplaceCollection[];
    selectedCollectionId: string | null;
    selectedRuleId: string | null;
    onSelectRule: (colId: string, ruleId: string) => void;
    onToggleRule: (colId: string, ruleId: string, enabled: boolean) => void;
    onCreateCollection: () => void;
    onCreateRule: (colId: string) => void;
    onRenameCollection: (colId: string, newName: string) => void;
    onRenameRule: (colId: string, ruleId: string, newName: string) => void;
    onDeleteCollection: (colId: string) => void;
    onDeleteRule: (colId: string, ruleId: string) => void;
}

export const MatchReplaceTree: React.FC<MatchReplaceTreeProps> = ({
    collections,
    selectedCollectionId,
    selectedRuleId,
    onSelectRule,
    onToggleRule,
    onCreateCollection,
    onCreateRule,
    onRenameCollection,
    onRenameRule,
    onDeleteCollection,
    onDeleteRule,
}) => {
    const [expandedColIds, setExpandedColIds] = useState<string[]>(() =>
        collections.map((c) => c.id)
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [removingItem, setRemovingItem] = useState<RemoveTarget | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const toggleExpand = (colId: string) => {
        setExpandedColIds((prev) =>
            prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
        );
    };

    const totalRules = useMemo(() => {
        return collections.reduce((acc, c) => acc + c.rules.length, 0);
    }, [collections]);

    const activeRulesCount = useMemo(() => {
        return collections.reduce(
            (acc, c) => acc + c.rules.filter((r) => r.enabled).length,
            0
        );
    }, [collections]);

    const filteredCollections = useMemo(() => {
        if (!searchTerm.trim()) return collections;
        const term = searchTerm.toLowerCase();
        return collections
            .map((col) => {
                const matchesCol = col.name.toLowerCase().includes(term);
                const matchingRules = col.rules.filter(
                    (r) =>
                        r.name.toLowerCase().includes(term) ||
                        r.match.toLowerCase().includes(term) ||
                        r.replace.toLowerCase().includes(term) ||
                        r.comment.toLowerCase().includes(term)
                );
                if (matchesCol || matchingRules.length > 0) {
                    return {
                        ...col,
                        rules: matchesCol ? col.rules : matchingRules,
                    };
                }
                return null;
            })
            .filter((c): c is MatchReplaceCollection => c !== null);
    }, [collections, searchTerm]);

    const handleSaveInline = (colId: string, ruleId?: string) => {
        if (!editingNodeId) return;
        const trimmed = editingText.trim();
        if (trimmed) {
            if (ruleId) {
                onRenameRule(colId, ruleId, trimmed);
            } else {
                onRenameCollection(colId, trimmed);
            }
        }
        setEditingNodeId(null);
    };

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        colId: string,
        ruleId?: string
    ) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveInline(colId, ruleId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditingNodeId(null);
        }
    };

    const handleConfirmRemove = () => {
        if (!removingItem) return;
        if (removingItem.type === 'collection') {
            onDeleteCollection(removingItem.colId);
        } else if (removingItem.type === 'rule' && removingItem.ruleId) {
            onDeleteRule(removingItem.colId, removingItem.ruleId);
        }
        setRemoveDialogOpen(false);
        setRemovingItem(null);
    };

    return (
        <div className="flex flex-col h-full bg-card/30 border-r border-border/40 select-none overflow-hidden">
            {/* Header Bar */}
            <div className="flex items-center justify-between px-3 h-10 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Rules
                    </span>
                    {totalRules > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground" title={`${activeRulesCount} enabled / ${totalRules} total`}>
                            {activeRulesCount}/{totalRules}
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
                                    onClick={onCreateCollection}
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
                </div>
            </div>

            {/* Slim Search Bar */}
            <div className="p-2 border-b border-border/20 shrink-0">
                <div className="relative flex items-center">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                    <Input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Filter rules..."
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
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1.5 space-y-1">
                {filteredCollections.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center px-4 gap-2 text-muted-foreground">
                        <SlidersHorizontal className="w-8 h-8 opacity-20" />
                        <p className="text-xs">No match & replace rules found</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onCreateCollection}
                            className="h-7 text-xs gap-1 font-medium mt-1"
                        >
                            <FolderPlus className="w-3 h-3" /> Create Collection
                        </Button>
                    </div>
                ) : (
                    filteredCollections.map((col) => {
                        const isExpanded = expandedColIds.includes(col.id);
                        const isEditingCol = editingNodeId === `col::${col.id}`;

                        return (
                            <div key={col.id} className="space-y-0.5">
                                {/* Collection Row */}
                                <div
                                    onClick={() => toggleExpand(col.id)}
                                    className={cn(
                                        "flex items-center justify-between w-full px-2 py-1 rounded-md text-xs font-mono group/col cursor-pointer transition-colors hover:bg-accent/40",
                                        selectedCollectionId === col.id && !selectedRuleId && "bg-accent/60 font-medium"
                                    )}
                                >
                                    {isEditingCol ? (
                                        <div
                                            className="flex items-center gap-1.5 flex-1 min-w-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {isExpanded ? (
                                                <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                                            ) : (
                                                <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                                            )}
                                            <Input
                                                value={editingText}
                                                onChange={(e) => setEditingText(e.target.value)}
                                                onKeyDown={(e) => handleKeyDown(e, col.id)}
                                                onBlur={() => handleSaveInline(col.id)}
                                                autoFocus
                                                className="h-5 text-xs font-mono px-1 py-0 bg-background border-primary/50 flex-1 shadow-none focus-visible:ring-1 focus-visible:ring-primary"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                            {isExpanded ? (
                                                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
                                            ) : (
                                                <Folder className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
                                            )}
                                            <span className="truncate font-semibold text-foreground/80 text-[11px]">
                                                {col.name}
                                            </span>
                                            {col.rules.length > 0 && (
                                                <span className="text-[9px] font-mono ml-auto mr-1 px-1.5 py-0.2 rounded-full bg-muted/40 text-muted-foreground/70">
                                                    {col.rules.length}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {!isEditingCol && (
                                        <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover/col:opacity-100 transition-opacity">
                                            <TooltipProvider delayDuration={300}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onCreateRule(col.id);
                                                            }}
                                                            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground/70 transition-colors"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="text-[11px] py-0.5 px-2">
                                                        New rule in {col.name}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground/70 transition-colors"
                                                    >
                                                        <MoreHorizontal className="w-3 h-3" />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-36 text-xs">
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setEditingNodeId(`col::${col.id}`);
                                                            setEditingText(col.name);
                                                        }}
                                                    >
                                                        <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                        onClick={() => {
                                                            setRemovingItem({
                                                                id: col.id,
                                                                type: 'collection',
                                                                colId: col.id,
                                                                label: col.name,
                                                            });
                                                            setRemoveDialogOpen(true);
                                                        }}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )}
                                </div>

                                {/* Rules List */}
                                {isExpanded && (
                                    <div className="pl-3.5 border-l border-border/30 ml-2.5 space-y-0.5">
                                        {col.rules.length === 0 ? (
                                            <div
                                                onClick={() => onCreateRule(col.id)}
                                                className="flex items-center gap-1.5 text-muted-foreground/60 hover:text-primary transition-colors text-[11px] py-1 px-1.5 select-none font-mono cursor-pointer group/add rounded"
                                            >
                                                <Plus className="w-3 h-3 text-muted-foreground/60 group-hover/add:text-primary transition-colors shrink-0" />
                                                <span className="truncate italic">Add a rule</span>
                                            </div>
                                        ) : (
                                            col.rules.map((rule: MatchReplaceRule) => {
                                                const isSelected = selectedRuleId === rule.id;
                                                const isEditingRule = editingNodeId === `rule::${rule.id}`;

                                                return (
                                                    <div
                                                        key={rule.id}
                                                        onClick={() => onSelectRule(col.id, rule.id)}
                                                        className={cn(
                                                            "flex items-center justify-between w-full px-2 py-1 rounded-md text-xs font-mono group/rule cursor-pointer transition-colors",
                                                            isSelected
                                                                ? "bg-accent/80 text-accent-foreground font-medium"
                                                                : "hover:bg-accent/40 text-muted-foreground hover:text-foreground"
                                                        )}
                                                    >
                                                        {isEditingRule ? (
                                                            <div
                                                                className="flex items-center gap-1.5 flex-1 min-w-0"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <Input
                                                                    value={editingText}
                                                                    onChange={(e) => setEditingText(e.target.value)}
                                                                    onKeyDown={(e) => handleKeyDown(e, col.id, rule.id)}
                                                                    onBlur={() => handleSaveInline(col.id, rule.id)}
                                                                    autoFocus
                                                                    className="h-5 text-xs font-mono px-1 py-0 bg-background border-primary/50 flex-1 shadow-none focus-visible:ring-1 focus-visible:ring-primary"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                <div
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="flex items-center shrink-0"
                                                                >
                                                                    <Checkbox
                                                                        checked={rule.enabled}
                                                                        onCheckedChange={(checked) => {
                                                                            onToggleRule(col.id, rule.id, checked === true);
                                                                        }}
                                                                        className="h-3.5 w-3.5 rounded"
                                                                    />
                                                                </div>

                                                                <span
                                                                    className={cn(
                                                                        "truncate text-[11px]",
                                                                        rule.enabled
                                                                            ? (isSelected ? "text-foreground font-semibold" : "text-foreground/90")
                                                                            : "text-muted-foreground/60 line-through"
                                                                    )}
                                                                    title={rule.name}
                                                                >
                                                                    {rule.name}
                                                                </span>

                                                                {rule.onlyInScope && (
                                                                    <TooltipProvider delayDuration={300}>
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <span className="shrink-0 ml-auto mr-0.5 text-muted-foreground/50 hover:text-primary transition-colors">
                                                                                    <Crosshair className="w-3 h-3" />
                                                                                </span>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent side="right" className="text-[10px] py-0.5 px-1.5">
                                                                                Only in scope
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TooltipProvider>
                                                                )}
                                                            </div>
                                                        )}

                                                        {!isEditingRule && (
                                                            <div className="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover/rule:opacity-100 transition-opacity">
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                                        <button
                                                                            type="button"
                                                                            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground/70 transition-colors"
                                                                        >
                                                                            <MoreHorizontal className="w-3 h-3" />
                                                                        </button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end" className="w-36 text-xs">
                                                                        <DropdownMenuItem
                                                                            onClick={() => {
                                                                                setEditingNodeId(`rule::${rule.id}`);
                                                                                setEditingText(rule.name);
                                                                            }}
                                                                        >
                                                                            <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuItem
                                                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                                            onClick={() => {
                                                                                setRemovingItem({
                                                                                    id: rule.id,
                                                                                    type: 'rule',
                                                                                    colId: col.id,
                                                                                    ruleId: rule.id,
                                                                                    label: rule.name,
                                                                                });
                                                                                setRemoveDialogOpen(true);
                                                                            }}
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                                                        </DropdownMenuItem>
                                                                    </DropdownMenuContent>
                                                                </DropdownMenu>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Remove Confirmation Dialog */}
            <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">
                            Delete {removingItem?.type === 'collection' ? 'Collection' : 'Rule'}
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
