import { useState, useRef, useMemo, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    selectAllScopes,
    selectActiveScopeId,
    importScopeRules,
} from '@/store/slices/scopeSlice';
import {
    parseBurpScope,
    type ParsedScopeRule,
} from '@/utils/burpScopeParser';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    FileJson,
    Upload,
    Check,
    AlertCircle,
    CheckCircle2,
    ShieldCheck,
    ShieldX,
    FileUp,
    Search,
    Layers,
    Replace,
    PlusCircle,
    Code2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Modal Props ─────────────────────────────────────────────────────────────

interface BurpScopeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function BurpScopeModal({
    open,
    onOpenChange,
}: BurpScopeModalProps) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const scopes = useAppSelector(selectAllScopes(projectId));
    const activeScopeId = useAppSelector(selectActiveScopeId(projectId));

    const fileInputRef = useRef<HTMLInputElement>(null);

    // ─── Import State ───
    const [rawJson, setRawJson] = useState<string>('');
    const [fileName, setFileName] = useState<string | null>(null);
    const [importMode, setImportMode] = useState<'merge' | 'replace' | 'create'>('create');
    const [selectedTargetScopeId, setSelectedTargetScopeId] = useState<string>('');
    const [newScopeName, setNewScopeName] = useState<string>('Burp Imported Scope');
    const [previewFilter, setPreviewFilter] = useState<'all' | 'allow' | 'deny'>('all');
    const [filterQuery, setFilterQuery] = useState<string>('');

    // Default target scope selection and strategy
    useEffect(() => {
        if (scopes.length === 0) {
            setImportMode('create');
        } else {
            if (activeScopeId) {
                setSelectedTargetScopeId(activeScopeId);
            } else {
                setSelectedTargetScopeId(scopes[0].id);
            }
        }
    }, [activeScopeId, scopes]);

    // Parse JSON in real-time
    const parseResult = useMemo(() => {
        if (!rawJson.trim()) return null;
        return parseBurpScope(rawJson);
    }, [rawJson]);

    // File upload handler
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setRawJson(content || '');
            if (file.name) {
                const base = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
                const formatted = base.charAt(0).toUpperCase() + base.slice(1);
                setNewScopeName(formatted || 'Burp Imported Scope');
            }
        };
        reader.readAsText(file);
    };

    // Confirm Import handler
    const handleConfirmImport = () => {
        if (!parseResult || !parseResult.success || !projectId) return;

        const effectiveMode = scopes.length === 0 ? 'create' : importMode;

        dispatch(
            importScopeRules({
                include: parseResult.include,
                exclude: parseResult.exclude,
                mode: effectiveMode,
                scopeId: effectiveMode === 'create' ? undefined : (selectedTargetScopeId || undefined),
                scopeName: newScopeName.trim() || 'Burp Imported Scope',
                projectId,
            })
        );

        // Reset and close
        setRawJson('');
        setFileName(null);
        onOpenChange(false);
    };

    // Filter preview items
    const filteredPreviewRules = useMemo(() => {
        if (!parseResult || !parseResult.success) return [];
        let items: { list: 'allow' | 'deny'; rule: ParsedScopeRule }[] = [];

        if (previewFilter === 'all' || previewFilter === 'allow') {
            items = items.concat(parseResult.include.map((r) => ({ list: 'allow', rule: r })));
        }
        if (previewFilter === 'all' || previewFilter === 'deny') {
            items = items.concat(parseResult.exclude.map((r) => ({ list: 'deny', rule: r })));
        }

        if (filterQuery.trim()) {
            const q = filterQuery.toLowerCase();
            items = items.filter((item) => item.rule.pattern.toLowerCase().includes(q));
        }

        return items;
    }, [parseResult, previewFilter, filterQuery]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border-border/80 shadow-2xl bg-card">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b border-border/50 bg-muted/20 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-md bg-primary/10 text-primary border border-primary/20">
                            <FileJson className="w-5 h-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-semibold">
                                Import Burp Suite Scope
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Import Burp Suite JSON configuration (Advanced Mode regex rules or Simple Mode prefixes).
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {/* Import Content Body */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-6 gap-4 m-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
                        {/* Left: Input & Options */}
                        <div className="flex flex-col gap-3 min-h-0">
                            {/* File Upload and Paste Section */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                    <Code2 className="w-3.5 h-3.5 text-primary" />
                                    Burp Scope JSON
                                </span>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="h-6 text-[11px] gap-1 px-2 border-border/60"
                                >
                                    <FileUp className="w-3 h-3" />
                                    {fileName ? 'Change File' : 'Upload .json'}
                                </Button>
                            </div>

                            <Textarea
                                placeholder={`Paste Burp Suite JSON scope export here...\nExample:\n{\n  "target": {\n    "scope": {\n      "advanced_mode": true,\n      "include": [\n        { "enabled": true, "host": "^.*\\\\.target\\\\.com$", "protocol": "any" }\n      ]\n    }\n  }\n}`}
                                value={rawJson}
                                onChange={(e) => {
                                    setRawJson(e.target.value);
                                    setFileName(null);
                                }}
                                className="flex-1 font-mono text-[11px] resize-none bg-muted/30 border-border/60 leading-relaxed p-3 focus-visible:ring-primary/40"
                            />

                            {/* Destination / Strategy */}
                            {scopes.length > 0 ? (
                                <div className="flex flex-col gap-2 pt-1 border-t border-border/40">
                                    <span className="text-[11px] font-medium text-muted-foreground">Import Strategy</span>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setImportMode('merge')}
                                            className={cn(
                                                'flex flex-col items-center justify-center p-2 rounded-md border text-[11px] font-medium transition-all text-center gap-1',
                                                importMode === 'merge'
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                            )}
                                        >
                                            <Layers className="w-3.5 h-3.5" />
                                            Merge
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setImportMode('replace')}
                                            className={cn(
                                                'flex flex-col items-center justify-center p-2 rounded-md border text-[11px] font-medium transition-all text-center gap-1',
                                                importMode === 'replace'
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                            )}
                                        >
                                            <Replace className="w-3.5 h-3.5" />
                                            Overwrite
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setImportMode('create')}
                                            className={cn(
                                                'flex flex-col items-center justify-center p-2 rounded-md border text-[11px] font-medium transition-all text-center gap-1',
                                                importMode === 'create'
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                            )}
                                        >
                                            <PlusCircle className="w-3.5 h-3.5" />
                                            New Scope
                                        </button>
                                    </div>

                                    {importMode === 'create' ? (
                                        <div className="flex flex-col gap-1 mt-1">
                                            <span className="text-[10px] text-muted-foreground">New Scope Name</span>
                                            <Input
                                                placeholder="e.g. Target Bounty Scope"
                                                value={newScopeName}
                                                onChange={(e) => setNewScopeName(e.target.value)}
                                                className="h-7 text-[11px] bg-muted/30"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1 mt-1">
                                            <span className="text-[10px] text-muted-foreground">Target Scope</span>
                                            <select
                                                value={selectedTargetScopeId}
                                                onChange={(e) => setSelectedTargetScopeId(e.target.value)}
                                                className="h-7 text-[11px] rounded-md border border-border/60 bg-muted/30 px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                {scopes.map((s) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name} ({s.allow.length} allow, {s.deny.length} deny)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-1.5 pt-1 border-t border-border/40">
                                    <span className="text-[11px] font-medium text-muted-foreground">Scope Name</span>
                                    <Input
                                        placeholder="e.g. Target Bounty Scope"
                                        value={newScopeName}
                                        onChange={(e) => setNewScopeName(e.target.value)}
                                        className="h-7 text-[11px] bg-muted/30"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Right: Validation & Live Preview */}
                        <div className="flex flex-col gap-2 min-h-0 border border-border/50 rounded-lg p-3 bg-muted/10">
                            <div className="flex items-center justify-between shrink-0">
                                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    Live Preview
                                </span>
                                {parseResult?.success && (
                                    <div className="flex items-center gap-1.5">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                            {parseResult.include.length} Allow
                                        </Badge>
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-rose-500/10 text-rose-400 border-rose-500/30">
                                            {parseResult.exclude.length} Deny
                                        </Badge>
                                    </div>
                                )}
                            </div>

                            {/* Validation Feedback Banner */}
                            {parseResult ? (
                                parseResult.success ? (
                                    <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 flex items-center gap-2 shrink-0">
                                        <Check className="w-3.5 h-3.5 shrink-0" />
                                        <span>
                                            Valid Burp {parseResult.advancedMode ? 'Advanced Mode (Regex)' : 'Simple Mode (Prefix)'} Scope detected ({parseResult.totalRulesCount} total rules).
                                        </span>
                                    </div>
                                ) : (
                                    <div className="p-2 rounded-md bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400 flex items-center gap-2 shrink-0">
                                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                        <span className="truncate">{parseResult.error}</span>
                                    </div>
                                )
                            ) : (
                                <div className="p-2 rounded-md bg-muted/40 border border-border/40 text-[11px] text-muted-foreground shrink-0">
                                    Paste JSON or upload a file to preview parsed rules.
                                </div>
                            )}

                            {/* Filter & Search in Preview */}
                            {parseResult?.success && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="relative flex-1">
                                        <Search className="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
                                        <Input
                                            placeholder="Filter rules..."
                                            value={filterQuery}
                                            onChange={(e) => setFilterQuery(e.target.value)}
                                            className="h-7 pl-6 text-[11px] bg-muted/30"
                                        />
                                    </div>
                                    <div className="flex rounded-md border border-border/60 bg-muted/30 p-0.5 text-[10px]">
                                        <button
                                            type="button"
                                            onClick={() => setPreviewFilter('all')}
                                            className={cn('px-2 py-0.5 rounded', previewFilter === 'all' && 'bg-accent text-accent-foreground font-medium')}
                                        >
                                            All
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPreviewFilter('allow')}
                                            className={cn('px-2 py-0.5 rounded', previewFilter === 'allow' && 'bg-emerald-500/20 text-emerald-400 font-medium')}
                                        >
                                            Allow
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPreviewFilter('deny')}
                                            className={cn('px-2 py-0.5 rounded', previewFilter === 'deny' && 'bg-rose-500/20 text-rose-400 font-medium')}
                                        >
                                            Deny
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Rules List Preview */}
                            <div className="flex-1 min-h-[160px] overflow-y-auto rounded-md border border-border/40 bg-background/50 p-1 flex flex-col gap-1">
                                {parseResult?.success ? (
                                    filteredPreviewRules.length === 0 ? (
                                        <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground/60">
                                            No matching rules in preview
                                        </div>
                                    ) : (
                                        filteredPreviewRules.map(({ list, rule }) => (
                                            <div
                                                key={rule.id}
                                                className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30 border border-border/30 text-[11px]"
                                            >
                                                {list === 'allow' ? (
                                                    <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                                                ) : (
                                                    <ShieldX className="w-3 h-3 text-rose-400 shrink-0" />
                                                )}
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        'text-[9px] px-1 py-0 uppercase tracking-wider',
                                                        list === 'allow'
                                                            ? 'text-emerald-400 border-emerald-500/30'
                                                            : 'text-rose-400 border-rose-500/30'
                                                    )}
                                                >
                                                    {list}
                                                </Badge>
                                                <span className="font-mono text-foreground/90 truncate flex-1">
                                                    {rule.pattern}
                                                </span>
                                                <Badge
                                                    variant="secondary"
                                                    className="text-[9px] px-1 py-0 text-muted-foreground bg-muted/50 font-normal"
                                                >
                                                    {rule.type}
                                                </Badge>
                                            </div>
                                        ))
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center p-4 text-muted-foreground/50">
                                        <FileJson className="w-6 h-6" />
                                        <span className="text-[11px]">No rules loaded</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Import Footer Actions */}
                    <DialogFooter className="border-t border-border/40 pt-3 flex items-center justify-between shrink-0">
                        <div className="text-[11px] text-muted-foreground">
                            {parseResult?.success ? (
                                <span>
                                    Ready to import <strong className="text-foreground">{parseResult.totalRulesCount}</strong> rules into{' '}
                                    <strong className="text-foreground">
                                        {scopes.length === 0 || importMode === 'create'
                                            ? newScopeName || 'New Scope'
                                            : scopes.find((s) => s.id === selectedTargetScopeId)?.name || 'Scope'}
                                    </strong>
                                </span>
                            ) : (
                                <span>Please provide valid Burp JSON to continue</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                className="h-7 text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={!parseResult?.success || parseResult.totalRulesCount === 0}
                                onClick={handleConfirmImport}
                                className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                            >
                                <Upload className="w-3.5 h-3.5" />
                                Import {parseResult?.totalRulesCount ? `(${parseResult.totalRulesCount} Rules)` : ''}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
