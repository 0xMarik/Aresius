import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    selectAllFilters,
    selectSelectedFilter,
    selectFiltersState,
    setSelectedFilterId,
    createLocalFilterDraft,
    saveFilterToDb,
    togglePresetInterception,
    deleteFilterFromDb,
    resetDefaultFiltersDb,
    fetchFiltersForProject,
    PresetFilter,
} from '@/store/slices/filtersSlice';
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    ListFilter,
    Plus,
    Trash2,
    Save,
    RotateCcw,
    Search,
    CheckCircle2,
    AlertCircle,
    Antenna,
    SlidersHorizontal,
    Code2,
    Check,
    X,
    Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const FiltersPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const filtersState = useAppSelector(selectFiltersState(projectId));
    const filters = useAppSelector(selectAllFilters(projectId));
    const selectedFilter = useAppSelector(selectSelectedFilter(projectId));

    const [searchQuery, setSearchQuery] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Form state for editing
    const [name, setName] = useState('');
    const [alias, setAlias] = useState('');
    const [expression, setExpression] = useState('');
    const [description, setDescription] = useState('');
    const [badge, setBadge] = useState('');
    const [applyInInterception, setApplyInInterception] = useState(false);

    // Live validation state for the expression
    const [isValid, setIsValid] = useState<boolean>(true);
    const [validationError, setValidationError] = useState<string | null>(null);

    // Sandbox / Test state
    const [testMethod, setTestMethod] = useState('GET');
    const [testHost, setTestHost] = useState('api.example.com');
    const [testPath, setTestPath] = useState('/users');
    const [testCode, setTestCode] = useState('200');
    const [testResult, setTestResult] = useState<boolean | null>(null);

    // Load filters on project mount
    useEffect(() => {
        if (projectId && !filtersState.isLoaded) {
            dispatch(fetchFiltersForProject(projectId));
        }
    }, [projectId, filtersState.isLoaded, dispatch]);

    // Sync form inputs when selection changes
    useEffect(() => {
        if (selectedFilter) {
            setName(selectedFilter.name);
            setAlias(selectedFilter.alias);
            setExpression(selectedFilter.expression);
            setDescription(selectedFilter.description || '');
            setBadge(selectedFilter.badge || '');
            setApplyInInterception(selectedFilter.applyInInterception || false);
            setSaveSuccess(false);
        } else {
            setName('');
            setAlias('');
            setExpression('');
            setDescription('');
            setBadge('');
            setApplyInInterception(false);
        }
    }, [selectedFilter?.id, selectedFilter?.updatedAt]);

    // Live expression validation debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!expression.trim()) {
                setIsValid(true);
                setValidationError(null);
                return;
            }
            invoke<{ isValid: boolean; error?: string }>('validate_httpql', { query: expression })
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
    }, [expression]);

    // Filter list by search query
    const filteredList = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        if (!q) return filters;
        return filters.filter(
            (f) =>
                f.name.toLowerCase().includes(q) ||
                f.alias.toLowerCase().includes(q) ||
                f.expression.toLowerCase().includes(q) ||
                f.badge.toLowerCase().includes(q)
        );
    }, [filters, searchQuery]);

    // Check for unsaved changes
    const hasChanges = useMemo(() => {
        if (!selectedFilter) return false;
        return (
            name !== selectedFilter.name ||
            alias !== selectedFilter.alias ||
            expression !== selectedFilter.expression ||
            description !== (selectedFilter.description || '') ||
            badge !== (selectedFilter.badge || '') ||
            applyInInterception !== selectedFilter.applyInInterception
        );
    }, [selectedFilter, name, alias, expression, description, badge, applyInInterception]);

    // Handlers
    const handleSelectFilter = (filterId: string) => {
        if (!projectId) return;
        dispatch(setSelectedFilterId({ projectId, filterId }));
    };

    const handleCreateNew = () => {
        if (!projectId) return;
        const newId = `filter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const defaultAlias = `custom-filter-${filters.length + 1}`;
        const newFilter: PresetFilter = {
            id: newId,
            projectId,
            name: `New Filter ${filters.length + 1}`,
            alias: defaultAlias,
            expression: 'req.method.eq:"GET"',
            description: '',
            badge: 'Custom',
            applyInInterception: false,
            sortOrder: filters.length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        dispatch(createLocalFilterDraft({ projectId, filter: newFilter }));
        dispatch(saveFilterToDb({ projectId, filter: newFilter }));
    };

    const handleToggleInterception = async (checked: boolean) => {
        setApplyInInterception(checked);
        if (selectedFilter && projectId) {
            dispatch(togglePresetInterception({
                projectId,
                id: selectedFilter.id,
                applyInInterception: checked,
            }));
        }
    };

    const handleSave = async () => {
        if (!projectId || !selectedFilter) return;
        if (!name.trim()) return;

        const cleanAlias = alias
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-');

        const updated: PresetFilter = {
            ...selectedFilter,
            name: name.trim(),
            alias: cleanAlias || 'filter',
            expression: expression.trim(),
            description: description.trim(),
            badge: badge.trim(),
            applyInInterception,
            updatedAt: Date.now(),
        };

        setIsSaving(true);
        try {
            await dispatch(saveFilterToDb({ projectId, filter: updated })).unwrap();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            console.error('Failed to save filter:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!projectId) return;
        if (window.confirm('Are you sure you want to delete this preset filter?')) {
            await dispatch(deleteFilterFromDb({ projectId, id }));
        }
    };

    const handleResetDefaults = async () => {
        if (!projectId) return;
        if (
            window.confirm(
                'Reset all preset filters to system defaults? Any custom presets in this project will be removed.'
            )
        ) {
            await dispatch(resetDefaultFiltersDb(projectId));
        }
    };

    const handleRevert = () => {
        if (selectedFilter) {
            setName(selectedFilter.name);
            setAlias(selectedFilter.alias);
            setExpression(selectedFilter.expression);
            setDescription(selectedFilter.description || '');
            setBadge(selectedFilter.badge || '');
            setApplyInInterception(selectedFilter.applyInInterception || false);
        }
    };

    // Quick insert token into expression
    const handleInsertToken = (token: string) => {
        setExpression((prev) => {
            const trimmed = prev.trim();
            if (!trimmed) return token;
            return `${trimmed} and ${token}`;
        });
    };

    // Live Sandbox evaluation
    const handleTestExpression = () => {
        if (!expression.trim()) {
            setTestResult(true);
            return;
        }

        // Simple client-side evaluator for testing feedback
        try {
            const exprLower = expression.toLowerCase();
            let matches = true;

            if (exprLower.includes('req.method') && !exprLower.includes(testMethod.toLowerCase())) {
                matches = false;
            }
            if (exprLower.includes('req.host') && !testHost.toLowerCase().includes('example')) {
                matches = false;
            }
            if (exprLower.includes('resp.code') && exprLower.includes('gte:400') && Number(testCode) < 400) {
                matches = false;
            }

            setTestResult(matches);
        } catch {
            setTestResult(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-card/60 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                        <SlidersHorizontal className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-sm font-semibold text-foreground tracking-tight">
                                Preset Filters
                            </h1>
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                {filters.length} {filters.length === 1 ? 'filter' : 'filters'}
                            </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Configure global HTTPQL filter presets for HTTP history, search autocomplete, and interception.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2.5 gap-1.5 text-muted-foreground hover:text-foreground"
                        onClick={handleResetDefaults}
                        title="Restore system default presets"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Reset Defaults</span>
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs px-3 gap-1.5 font-medium shadow-sm"
                        onClick={handleCreateNew}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Filter</span>
                    </Button>
                </div>
            </div>

            {/* Main Resizable 2-Column Split */}
            <div className="flex-1 min-h-0 relative">
                <ResizablePanelGroup direction="horizontal" autoSaveId="discovery-filters-layout">
                    {/* ── LEFT COLUMN: Filter List ── */}
                    <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
                        <div className="flex flex-col h-full border-r border-border bg-card/20">
                            {/* Search box */}
                            <div className="p-2.5 border-b border-border/70 bg-card/40">
                                <div className="relative flex items-center">
                                    <Search className="w-3.5 h-3.5 absolute left-2.5 text-muted-foreground" />
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search preset filters..."
                                        className="h-7 pl-8 pr-2 text-xs bg-background/80"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* List of preset filters */}
                            <div className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-border/20">
                                {filteredList.length === 0 ? (
                                    <div className="py-12 px-4 text-center">
                                        <ListFilter className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                                        <p className="text-xs font-medium text-foreground">No preset filters found</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            {searchQuery ? 'Try clearing your search term' : 'Click "+ New Filter" to create one'}
                                        </p>
                                    </div>
                                ) : (
                                    filteredList.map((item) => {
                                        const isSelected = selectedFilter?.id === item.id;
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={() => handleSelectFilter(item.id)}
                                                className={cn(
                                                    'group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all border flex items-center justify-between gap-2',
                                                    isSelected
                                                        ? 'bg-primary/10 border-primary/40 shadow-sm'
                                                        : 'bg-card/40 border-border/40 hover:bg-accent/40 hover:border-border/70 text-foreground'
                                                )}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span
                                                        className={cn(
                                                            'font-medium text-xs truncate',
                                                            isSelected ? 'text-primary font-semibold' : 'text-foreground'
                                                        )}
                                                    >
                                                        {item.name}
                                                    </span>
                                                    {item.badge && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[9.5px] px-1.5 py-0 h-4 font-normal text-muted-foreground shrink-0"
                                                        >
                                                            {item.badge}
                                                        </Badge>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {item.applyInInterception && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="flex items-center text-amber-500 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold">
                                                                        <Antenna className="w-3 h-3" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="text-xs">
                                                                    Active in Interception
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}

                                                    <button
                                                        onClick={(e) => handleDelete(item.id, e)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-rose-500 rounded transition-opacity"
                                                        title="Delete preset"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* ── RIGHT COLUMN: Filter Editor & Sandbox ── */}
                    <ResizablePanel defaultSize={65} minSize={40}>
                        {selectedFilter ? (
                            <div className="flex flex-col h-full bg-background overflow-y-auto">
                                {/* Editor Header */}
                                <div className="p-3 border-b bg-card/30 flex items-center justify-between shrink-0 gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Code2 className="w-4 h-4 text-primary shrink-0" />
                                        <div className="truncate">
                                            <h2 className="text-xs font-semibold text-foreground truncate">
                                                {name || selectedFilter.name}
                                            </h2>
                                            <span className="text-[10.5px] font-mono text-muted-foreground">
                                                preset:"{alias || selectedFilter.alias}"
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {hasChanges && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                                                onClick={handleRevert}
                                            >
                                                Revert
                                            </Button>
                                        )}
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            className="h-7 text-xs px-2.5 gap-1"
                                            onClick={() => handleDelete(selectedFilter.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                            <span className="hidden sm:inline">Delete</span>
                                        </Button>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            className={cn(
                                                'h-7 text-xs px-3 gap-1.5 font-medium transition-all',
                                                saveSuccess && 'bg-emerald-600 hover:bg-emerald-600 text-white'
                                            )}
                                            onClick={handleSave}
                                            disabled={isSaving || !name.trim() || !isValid}
                                        >
                                            {saveSuccess ? (
                                                <>
                                                    <Check className="w-3.5 h-3.5" />
                                                    Saved!
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-3.5 h-3.5" />
                                                    Save Changes
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Form Fields */}
                                <div className="p-4 space-y-4 flex-1">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Name Input */}
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">Display Name</Label>
                                            <Input
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="e.g. Hide Static Assets"
                                                className="h-8 text-xs font-medium"
                                            />
                                            <p className="text-[10.5px] text-muted-foreground">
                                                User-friendly label shown in presets chips and menus.
                                            </p>
                                        </div>

                                        {/* Alias Input */}
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">Preset Alias / Identifier</Label>
                                            <div className="relative flex items-center">
                                                <span className="absolute left-2.5 text-[11px] font-mono text-muted-foreground select-none">
                                                    preset:
                                                </span>
                                                <Input
                                                    value={alias}
                                                    onChange={(e) => setAlias(e.target.value.toLowerCase())}
                                                    placeholder="hide-static"
                                                    className="h-8 pl-16 text-xs font-mono"
                                                />
                                            </div>
                                            <p className="text-[10.5px] text-muted-foreground">
                                                Query alias used in HTTPQL (e.g. <code className="font-mono">preset:"{alias || 'alias'}"</code>).
                                            </p>
                                        </div>
                                    </div>

                                    {/* Expression Editor */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-medium flex items-center gap-1.5">
                                                HTTPQL Expression
                                                {/* Syntax Status */}
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="flex items-center cursor-help">
                                                                {isValid ? (
                                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                                                ) : (
                                                                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                                                                )}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="right" className="text-xs">
                                                            {isValid
                                                                ? 'Valid HTTPQL syntax'
                                                                : `Syntax error: ${validationError || 'Invalid expression'}`}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </Label>

                                            <span className="text-[10.5px] text-muted-foreground">
                                                Supports chaining with <code className="font-mono">and</code>,{' '}
                                                <code className="font-mono">or</code>, and nested{' '}
                                                <code className="font-mono">preset:"..."</code>
                                            </span>
                                        </div>

                                        <Textarea
                                            value={expression}
                                            onChange={(e) => setExpression(e.target.value)}
                                            placeholder='e.g. req.method.eq:"POST" and resp.code.gte:400'
                                            className="font-mono text-xs min-h-[85px] bg-muted/20 border-border/80 leading-relaxed"
                                            spellCheck={false}
                                        />

                                        {/* Quick insert token chips */}
                                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                            <span className="text-[10px] uppercase font-semibold text-muted-foreground/70">
                                                Insert:
                                            </span>
                                            {[
                                                'req.method:"GET"',
                                                'req.method:"POST"',
                                                'resp.code:200',
                                                'resp.code.gte:400',
                                                'req.host.cont:"example.com"',
                                                'resp.header["content-type"].cont:"json"',
                                                'preset:"hide-static"',
                                            ].map((token) => (
                                                <button
                                                    key={token}
                                                    type="button"
                                                    onClick={() => handleInsertToken(token)}
                                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 transition-colors"
                                                >
                                                    + {token}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Interception Checkbox & Settings */}
                                    <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-start gap-2.5">
                                                <Antenna className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                                                <div>
                                                    <Label htmlFor="interception-switch" className="text-xs font-semibold cursor-pointer">
                                                        Apply this filter in interception
                                                    </Label>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        When enabled, the Proxy Interceptor evaluates this filter during capture, and HTTP History filters the table by default with a toggleable switch.
                                                    </p>
                                                </div>
                                            </div>
                                            <Switch
                                                id="interception-switch"
                                                checked={applyInInterception}
                                                onCheckedChange={handleToggleInterception}
                                            />
                                        </div>
                                    </div>

                                    {/* Optional Badge & Description */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">Category Badge (Optional)</Label>
                                            <Input
                                                value={badge}
                                                onChange={(e) => setBadge(e.target.value)}
                                                placeholder="e.g. Noise, API, Errors, Perf"
                                                className="h-8 text-xs font-mono"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-medium">Description (Optional)</Label>
                                            <Input
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                placeholder="Short notes on this filter's purpose"
                                                className="h-8 text-xs"
                                            />
                                        </div>
                                    </div>

                                    {/* ── Live Test Sandbox Widget ── */}
                                    <div className="p-3 rounded-lg border border-border/70 bg-card/40 space-y-3 mt-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <Play className="w-3.5 h-3.5 text-primary" />
                                                <span className="text-xs font-semibold text-foreground">
                                                    Live Filter Tester
                                                </span>
                                            </div>
                                            {testResult !== null && (
                                                <div
                                                    className={cn(
                                                        'flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border',
                                                        testResult
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                                    )}
                                                >
                                                    {testResult ? (
                                                        <>
                                                            <Check className="w-3 h-3" />
                                                            MATCHES (TRUE)
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X className="w-3 h-3" />
                                                            NO MATCH (FALSE)
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <div>
                                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                    Method
                                                </label>
                                                <Input
                                                    value={testMethod}
                                                    onChange={(e) => setTestMethod(e.target.value)}
                                                    className="h-7 text-[11px] font-mono"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                    Host
                                                </label>
                                                <Input
                                                    value={testHost}
                                                    onChange={(e) => setTestHost(e.target.value)}
                                                    className="h-7 text-[11px] font-mono"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                    Path
                                                </label>
                                                <Input
                                                    value={testPath}
                                                    onChange={(e) => setTestPath(e.target.value)}
                                                    className="h-7 text-[11px] font-mono"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                    Status
                                                </label>
                                                <Input
                                                    value={testCode}
                                                    onChange={(e) => setTestCode(e.target.value)}
                                                    className="h-7 text-[11px] font-mono"
                                                />
                                            </div>
                                        </div>

                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs px-3 gap-1.5 w-full sm:w-auto"
                                            onClick={handleTestExpression}
                                        >
                                            <Play className="w-3 h-3 text-primary" />
                                            Test Expression Against Sample Data
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                                <SlidersHorizontal className="w-12 h-12 text-muted-foreground/30 mb-3" />
                                <h3 className="text-sm font-semibold text-foreground">No Preset Filter Selected</h3>
                                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                                    Select a filter from the list on the left to inspect and edit its expression, or click "+ New Filter" to add one.
                                </p>
                            </div>
                        )}
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
};

export default FiltersPage;
