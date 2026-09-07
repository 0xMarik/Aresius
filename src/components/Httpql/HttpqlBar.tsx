import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Search,
    X,
    CheckCircle2,
    AlertCircle,
    Bookmark,
    History,
    HelpCircle,
    Plus,
    Trash2,
    Antenna,
} from 'lucide-react';
import { HTTPQL_PRESETS } from '@/lib/httpql/httpql';
import HttpqlCheatsheetModal from './HttpqlCheatsheetModal';
import HttpqlCodeEditor, { HttpqlCodeEditorRef } from './HttpqlCodeEditor';
import { useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { selectAllFilters } from '@/store/slices/filtersSlice';

export interface HttpqlBarProps {
    value: string;
    onChange: (query: string) => void;
    placeholder?: string;
    className?: string;
    applyFilterChecked?: boolean;
    onApplyFilterChange?: (checked: boolean) => void;
}

interface SavedQuery {
    id: string;
    name: string;
    query: string;
    timestamp: number;
}

const STORAGE_SAVED_KEY = 'aresius_httpql_saved_queries';
const STORAGE_HISTORY_KEY = 'aresius_httpql_history';

export const HttpqlBar: React.FC<HttpqlBarProps> = ({
    value,
    onChange,
    placeholder = 'Query traffic with HTTPQL (e.g. req.method:"POST" and resp.code.ge:400)...',
    className = '',
    applyFilterChecked,
    onApplyFilterChange,
}) => {
    const projectId = useProjectId();
    const storeFilters = useAppSelector(selectAllFilters(projectId));

    const effectivePresets = React.useMemo(() => {
        if (storeFilters && storeFilters.length > 0) {
            return storeFilters.map((f) => ({
                id: f.id,
                label: f.name,
                alias: f.alias,
                description: f.description || `Preset filter: ${f.name}`,
                query: `preset:"${f.alias}"`,
                expression: f.expression,
                badge: f.badge || (f.applyInInterception ? 'Interception' : undefined),
            }));
        }
        return HTTPQL_PRESETS.map((p) => ({
            id: p.id,
            label: p.label,
            alias: p.id,
            description: p.description,
            query: p.query,
            expression: p.query,
            badge: p.badge,
        }));
    }, [storeFilters]);

    const dynamicPresets = React.useMemo(() => {
        return effectivePresets.map((p) => ({
            alias: p.alias,
            name: p.label,
            description: p.description,
        }));
    }, [effectivePresets]);

    const inputRef = useRef<HttpqlCodeEditorRef>(null);
    const [inputValue, setInputValue] = useState(value);
    const [isValid, setIsValid] = useState<boolean>(true);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [showSyntaxErrorBanner, setShowSyntaxErrorBanner] = useState<boolean>(false);

    // Track the last valid query and the last emitted query to parent
    const lastValidQueryRef = useRef<string>(value || '');
    const lastEmittedValueRef = useRef<string>(value || '');
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const emitQuery = React.useCallback((query: string) => {
        lastEmittedValueRef.current = query;
        onChangeRef.current(query);
    }, []);

    // History and saved queries
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_SAVED_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    const [historyQueries, setHistoryQueries] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    const [cheatsheetOpen, setCheatsheetOpen] = useState<boolean>(false);
    const [newQueryName, setNewQueryName] = useState<string>('');

    // Sync from outer prop changes (only when external change differs from what was emitted)
    useEffect(() => {
        if (value !== lastEmittedValueRef.current) {
            setInputValue(value || '');
            lastValidQueryRef.current = value || '';
            lastEmittedValueRef.current = value || '';
            setIsValid(true);
            setValidationError(null);
            setShowSyntaxErrorBanner(false);
        }
    }, [value]);

    // Live validation debounce: validates syntax as user types for status icon feedback ONLY.
    // DOES NOT emit queries or trigger filtering while typing.
    useEffect(() => {
        const trimmed = inputValue.trim();
        if (!trimmed) {
            setIsValid(true);
            setValidationError(null);
            setShowSyntaxErrorBanner(false);
            return;
        }

        const timer = setTimeout(() => {
            invoke<{ isValid: boolean; error?: string }>('validate_httpql', { query: inputValue })
                .then((res) => {
                    if (res.isValid) {
                        setIsValid(true);
                        setValidationError(null);
                        setShowSyntaxErrorBanner(false);
                    } else {
                        setIsValid(false);
                        setValidationError(res.error || 'Invalid expression');
                    }
                })
                .catch(() => {
                    setIsValid(true);
                    setValidationError(null);
                    setShowSyntaxErrorBanner(false);
                });
        }, 150);

        return () => clearTimeout(timer);
    }, [inputValue]);

    const handleSaveToHistory = React.useCallback((queryToSave: string) => {
        const trimmed = queryToSave.trim();
        if (!trimmed) return;
        setHistoryQueries((prev) => {
            const filtered = prev.filter((q) => q !== trimmed);
            const updated = [trimmed, ...filtered].slice(0, 15);
            try {
                localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(updated));
            } catch {}
            return updated;
        });
    }, []);

    // Strict submit handler: applied ONLY on Enter or explicit preset/history click
    const handleSubmit = React.useCallback(async (queryToSubmit: string) => {
        const trimmed = queryToSubmit.trim();
        if (!trimmed) {
            setIsValid(true);
            setValidationError(null);
            setShowSyntaxErrorBanner(false);
            lastValidQueryRef.current = '';
            emitQuery('');
            return;
        }

        try {
            const res = await invoke<{ isValid: boolean; error?: string }>('validate_httpql', { query: trimmed });
            if (res.isValid) {
                setIsValid(true);
                setValidationError(null);
                setShowSyntaxErrorBanner(false);
                lastValidQueryRef.current = trimmed;
                handleSaveToHistory(trimmed);
                emitQuery(trimmed);
            } else {
                setIsValid(false);
                setValidationError(res.error || 'Invalid expression');
                setShowSyntaxErrorBanner(true);
                // DO NOT trigger filtering if syntax is incorrect!
            }
        } catch {
            setIsValid(false);
            setValidationError('Failed to validate query syntax');
            setShowSyntaxErrorBanner(true);
        }
    }, [emitQuery, handleSaveToHistory]);

    const handleSaveCurrentQuery = () => {
        if (!inputValue.trim() || !newQueryName.trim()) return;
        const newSaved: SavedQuery = {
            id: String(Date.now()),
            name: newQueryName.trim(),
            query: inputValue.trim(),
            timestamp: Date.now(),
        };
        const updated = [newSaved, ...savedQueries];
        setSavedQueries(updated);
        try {
            localStorage.setItem(STORAGE_SAVED_KEY, JSON.stringify(updated));
        } catch {}
        setNewQueryName('');
    };

    const handleDeleteSavedQuery = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = savedQueries.filter((q) => q.id !== id);
        setSavedQueries(updated);
        try {
            localStorage.setItem(STORAGE_SAVED_KEY, JSON.stringify(updated));
        } catch {}
    };

    const clearInput = () => {
        setInputValue('');
        setIsValid(true);
        setValidationError(null);
        setShowSyntaxErrorBanner(false);
        lastValidQueryRef.current = '';
        emitQuery('');
        inputRef.current?.focus();
    };

    return (
        <div className={`flex flex-col gap-1.5 px-3 py-2 bg-card/40 border-b border-border/70 ${className}`}>
            {/* Search Input Row */}
            <div className="relative flex items-center gap-1.5">
                {/* Cheatsheet icon button at left of HTTPQL input */}
                <TooltipProvider delayDuration={150}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setCheatsheetOpen(true)}
                                aria-label="HTTPQL cheatsheet and syntax reference"
                            >
                                <HelpCircle className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="text-xs">
                            HTTPQL Reference &amp; Cheatsheet
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <div className="relative flex-1 flex items-center">
                    {/* HTTPQL Prefix Badge */}
                    <div className="absolute left-2.5 flex items-center gap-1 pointer-events-none text-muted-foreground z-10">
                        <Search className="w-3.5 h-3.5 text-muted-foreground/70" />
                        <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-primary/80 bg-primary/10 px-1 py-0.2 rounded border border-primary/20">
                            HTTPQL
                        </span>
                    </div>

                    <HttpqlCodeEditor
                        ref={inputRef}
                        value={inputValue}
                        onChange={(val) => {
                            setInputValue(val);
                        }}
                        onSubmit={(val) => {
                            handleSubmit(val);
                        }}
                        placeholder={placeholder}
                        dynamicPresets={dynamicPresets}
                        recentSearches={historyQueries}
                    />

                    {/* Right side controls inside input */}
                    <div className="absolute right-2 flex items-center gap-1.5 z-10">
                        {/* Keyboard hint (↵ Enter) */}
                        {inputValue.trim() && (
                            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9px] text-muted-foreground/70 bg-muted/40 rounded border border-border/50 font-mono select-none">
                                ↵ Enter
                            </kbd>
                        )}

                        {/* Validation Status Indicator */}
                        {inputValue.trim() && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center cursor-help">
                                            {isValid ? (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                            ) : (
                                                <AlertCircle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                                            )}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="text-xs">
                                        {isValid
                                            ? 'Valid HTTPQL syntax — Press Enter to filter'
                                            : `Syntax error: ${validationError || 'Invalid expression'}`}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}

                        {/* Clear button */}
                        {inputValue && (
                            <button
                                type="button"
                                onClick={clearInput}
                                className="p-0.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted/60 transition-colors"
                                title="Clear query"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* History & Saved Queries Dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs gap-1.5 shrink-0">
                            <Bookmark className="w-3.5 h-3.5 text-primary" />
                            <span className="hidden sm:inline">Saved</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-y-auto">
                        {inputValue.trim() && (
                            <>
                                <div className="p-2 flex items-center gap-1.5">
                                    <Input
                                        value={newQueryName}
                                        onChange={(e) => setNewQueryName(e.target.value)}
                                        placeholder="Name this query..."
                                        className="h-7 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSaveCurrentQuery();
                                            }
                                        }}
                                    />
                                    <Button
                                        size="sm"
                                        className="h-7 text-xs px-2 shrink-0 gap-1"
                                        disabled={!newQueryName.trim()}
                                        onClick={handleSaveCurrentQuery}
                                    >
                                        <Plus className="w-3 h-3" />
                                        Save
                                    </Button>
                                </div>
                                <DropdownMenuSeparator />
                            </>
                        )}

                        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Saved Presets
                        </DropdownMenuLabel>
                        {savedQueries.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground italic">No saved queries yet</div>
                        ) : (
                            savedQueries.map((saved) => (
                                <DropdownMenuItem
                                    key={saved.id}
                                    className="flex items-center justify-between text-xs py-1.5 cursor-pointer group"
                                    onClick={() => {
                                        setInputValue(saved.query);
                                        handleSubmit(saved.query);
                                    }}
                                >
                                    <div className="flex flex-col truncate pr-2">
                                        <span className="font-medium text-foreground">{saved.name}</span>
                                        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                                            {saved.query}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-500 rounded transition-opacity"
                                        onClick={(e) => handleDeleteSavedQuery(saved.id, e)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </DropdownMenuItem>
                            ))
                        )}

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                            <History className="w-3 h-3" /> Recent Queries
                        </DropdownMenuLabel>
                        {historyQueries.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground italic">No recent history</div>
                        ) : (
                            historyQueries.map((q, idx) => (
                                <DropdownMenuItem
                                    key={idx}
                                    className="text-xs font-mono py-1.5 truncate cursor-pointer text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        setInputValue(q);
                                        handleSubmit(q);
                                    }}
                                >
                                    <span className="truncate">{q}</span>
                                </DropdownMenuItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Apply Filter Button (Interception Preset Filter on History) */}
                {onApplyFilterChange !== undefined && (
                    <Button
                        type="button"
                        variant={applyFilterChecked ? 'secondary' : 'outline'}
                        size="sm"
                        className={`h-8 px-2.5 text-xs gap-1.5 shrink-0 transition-all ${
                            applyFilterChecked
                                ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium hover:bg-amber-500/25'
                                : 'text-muted-foreground hover:text-foreground opacity-75 hover:opacity-100'
                        }`}
                        onClick={() => onApplyFilterChange(!applyFilterChecked)}
                        title={
                            applyFilterChecked
                                ? 'Interception preset filters applied to history table. Click to disable.'
                                : 'Interception preset filters disabled on history table. Click to apply.'
                        }
                    >
                        <Antenna className={`w-3.5 h-3.5 ${applyFilterChecked ? 'text-amber-500' : 'text-muted-foreground'}`} />
                        <span>Apply Filter</span>
                        <div
                            className={`w-1.5 h-1.5 rounded-full ${
                                applyFilterChecked ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/30'
                            }`}
                        />
                    </Button>
                )}
            </div>

            {/* Syntax Error Banner (shown only when user pressed Enter with invalid syntax) */}
            {showSyntaxErrorBanner && !isValid && validationError && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-xs font-mono animate-in fade-in duration-150">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                            Syntax error: {validationError}
                        </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wider font-sans font-medium">
                        Filter not applied
                    </span>
                </div>
            )}

            {/* Cheatsheet Modal */}
            <HttpqlCheatsheetModal
                open={cheatsheetOpen}
                onOpenChange={setCheatsheetOpen}
                presets={effectivePresets}
                onSelectQuery={(q) => {
                    setInputValue(q);
                    handleSubmit(q);
                }}
            />
        </div>
    );
};

export default HttpqlBar;
