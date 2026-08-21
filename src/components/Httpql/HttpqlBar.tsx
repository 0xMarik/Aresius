import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { getHttpqlSuggestions, AutocompleteSuggestion } from '@/lib/httpql/autocomplete';
import HttpqlCheatsheetModal from './HttpqlCheatsheetModal';
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

    const inputRef = useRef<HTMLInputElement>(null);
    const [inputValue, setInputValue] = useState(value);
    const [isValid, setIsValid] = useState<boolean>(true);
    const [validationError, setValidationError] = useState<string | null>(null);

    // Autocomplete state
    const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
    const [replacementRange, setReplacementRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

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

    // Sync from outer prop changes
    useEffect(() => {
        setInputValue(value);
    }, [value]);

    // Live validation debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!inputValue.trim()) {
                setIsValid(true);
                setValidationError(null);
                return;
            }
            invoke<{ isValid: boolean; error?: string }>('validate_httpql', { query: inputValue })
                .then((res) => {
                    setIsValid(res.isValid);
                    setValidationError(res.error || null);
                })
                .catch(() => {
                    setIsValid(true);
                    setValidationError(null);
                });
        }, 150);

        return () => clearTimeout(timer);
    }, [inputValue]);

    // Handle suggestion trigger
    const updateSuggestions = useCallback((text: string, pos: number) => {
        const dynamicPresets = effectivePresets.map((p) => ({
            alias: p.alias,
            name: p.label,
            description: p.description,
        }));
        const { suggestions: list, startPos, endPos } = getHttpqlSuggestions(text, pos, dynamicPresets);
        setSuggestions(list);
        setSelectedIndex(0);
        setShowSuggestions(list.length > 0);
        setReplacementRange({ start: startPos, end: endPos });
    }, [effectivePresets]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVal = e.target.value;
        setInputValue(newVal);
        onChange(newVal);
        const cursor = e.target.selectionStart ?? newVal.length;
        updateSuggestions(newVal, cursor);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showSuggestions && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % suggestions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (suggestions[selectedIndex]) {
                    e.preventDefault();
                    applySuggestion(suggestions[selectedIndex]);
                    return;
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowSuggestions(false);
                return;
            }
        }

        if (e.key === 'Enter') {
            // Save to recent history
            if (inputValue.trim()) {
                setHistoryQueries((prev) => {
                    const filtered = prev.filter((q) => q !== inputValue.trim());
                    const updated = [inputValue.trim(), ...filtered].slice(0, 15);
                    try {
                        localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(updated));
                    } catch {}
                    return updated;
                });
            }
            setShowSuggestions(false);
        }
    };

    const applySuggestion = (suggestion: AutocompleteSuggestion) => {
        const text = inputValue;
        const before = text.slice(0, replacementRange.start);
        const after = text.slice(replacementRange.end);
        const newText = before + suggestion.replacement + (after.startsWith(' ') || suggestion.replacement.endsWith(' ') ? after : (after ? ' ' + after : ''));

        setInputValue(newText);
        onChange(newText);

        const newPos = before.length + suggestion.replacement.length;

        if (suggestion.hasMoreLayers) {
            // Keep suggestions open and immediately query the next layer
            updateSuggestions(newText, newPos);
        } else {
            setShowSuggestions(false);
        }

        // Put focus back and position cursor
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(newPos, newPos);
            }
        }, 10);
    };

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
        onChange('');
        setShowSuggestions(false);
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

                    <Input
                        ref={inputRef}
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => {
                            if (inputValue) {
                                const cursor = inputRef.current?.selectionStart ?? inputValue.length;
                                updateSuggestions(inputValue, cursor);
                            }
                        }}
                        onBlur={() => {
                            // Delay hiding suggestions so click events on dropdown register
                            setTimeout(() => setShowSuggestions(false), 200);
                        }}
                        placeholder={placeholder}
                        className="pl-24 pr-16 h-8 text-xs font-mono bg-background border-border/80 focus-visible:ring-1 focus-visible:ring-primary placeholder:font-sans placeholder:text-muted-foreground/60"
                        spellCheck={false}
                        autoComplete="off"
                    />

                    {/* Right side controls inside input */}
                    <div className="absolute right-2 flex items-center gap-1.5 z-10">
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
                                            ? 'Valid HTTPQL syntax'
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

                    {/* Autocomplete Suggestions Popup anchored right under input */}
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-[calc(100%+3px)] left-0 w-full max-w-lg max-h-48 overflow-y-auto bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-md p-0.5 text-xs divide-y divide-border/20 z-50">
                            {suggestions.map((s, idx) => (
                                <div
                                    key={s.id}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        applySuggestion(s);
                                    }}
                                    className={`px-2.5 py-1 rounded flex items-center justify-between cursor-pointer transition-colors ${
                                        idx === selectedIndex
                                            ? 'bg-primary text-primary-foreground font-medium'
                                            : 'hover:bg-accent/60 text-foreground'
                                    }`}
                                >
                                    <span className="font-mono text-[11.5px] truncate">
                                        {s.displayText || s.text}
                                    </span>
                                    <span
                                        className={`text-[10.5px] truncate max-w-[220px] ml-2 ${
                                            idx === selectedIndex ? 'text-primary-foreground/80' : 'text-muted-foreground'
                                        }`}
                                    >
                                        {s.description}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
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
                                        onChange(saved.query);
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
                                        onChange(q);
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

            {/* Cheatsheet Modal */}
            <HttpqlCheatsheetModal
                open={cheatsheetOpen}
                onOpenChange={setCheatsheetOpen}
                presets={effectivePresets}
                onSelectQuery={(q) => {
                    setInputValue(q);
                    onChange(q);
                }}
            />
        </div>
    );
};

export default HttpqlBar;
