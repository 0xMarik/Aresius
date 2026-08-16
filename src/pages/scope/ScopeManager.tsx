import { useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    createScope,
    deleteScope,
    setScopeColor,
    setActiveScope,
    addRule,
    removeRule,
    selectAllScopes,
    selectActiveScopeId,
    type Scope,
} from '@/store/slices/scopeSlice';
import { isUrlInScope, isRegexPattern } from '@/lib/scopeMatcher';
import { BurpScopeModal } from './BurpScopeModal';
import { BurpExportModal } from './BurpExportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Check,
    X,
    Crosshair,
    ShieldCheck,
    ShieldX,
    CircleDot,
    Zap,
    Trash2,
    Upload,
    Download,
    HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Colour picker palette ──────────────────────────────────────────────────

const PALETTE = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
    '#f59e0b', '#84cc16', '#10b981', '#06b6d4',
    '#3b82f6', '#f97316',
];

// ─── Rule list sub-component ────────────────────────────────────────────────

interface RuleListProps {
    scopeId: string;
    list: 'allow' | 'deny';
    rules: Scope['allow'];
}

function RuleList({ scopeId, list, rules }: RuleListProps) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const [draft, setDraft] = useState('');

    const handleAdd = useCallback(() => {
        const trimmed = draft.trim();
        if (!trimmed || !projectId) return;
        dispatch(addRule({ scopeId, list, pattern: trimmed, projectId }));
        setDraft('');
    }, [draft, dispatch, scopeId, list, projectId]);

    const isAllow = list === 'allow';
    const accent = isAllow
        ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
        : 'text-rose-400 border-rose-500/30 bg-rose-500/10';
    const inputAccent = isAllow
        ? 'focus-visible:ring-emerald-500/40'
        : 'focus-visible:ring-rose-500/40';
    const btnAccent = isAllow
        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
        : 'bg-rose-600 hover:bg-rose-500 text-white';

    return (
        <div className="flex flex-col gap-2 flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2">
                <Badge
                    variant="outline"
                    className={cn('text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5', accent)}
                >
                    {isAllow ? <ShieldCheck className="w-2.5 h-2.5 mr-1" /> : <ShieldX className="w-2.5 h-2.5 mr-1" />}
                    {isAllow ? 'Allow' : 'Deny'}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/60 flex items-center gap-1" title="Supports Glob (*.example.com), Regex (^.*\.example\.com$), or Prefix URL">
                    <HelpCircle className="w-2.5 h-2.5" />
                    Glob / Regex
                </span>
            </div>

            {/* Add input */}
            <div className="flex gap-1.5">
                <Input
                    placeholder={isAllow ? '*.target.com or ^.*\\.target\\.com$' : 'internal.example.com or ^.*\\.secret\\.com$'}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                    className={cn('h-7 text-[11px] font-mono bg-muted/40 border-border/60', inputAccent)}
                />
                <Button
                    size="sm"
                    onClick={handleAdd}
                    disabled={!draft.trim()}
                    className={cn('h-7 px-2 shrink-0 text-[11px]', btnAccent)}
                >
                    <Plus className="w-3 h-3" />
                </Button>
            </div>

            {/* Rule items */}
            <div className="flex flex-col gap-1 min-h-[60px] max-h-[260px] overflow-y-auto pr-0.5">
                {rules.length === 0 ? (
                    <div className="flex items-center justify-center h-12 rounded-md border border-dashed border-border/40 text-[11px] text-muted-foreground/60">
                        No patterns — {isAllow ? 'nothing is in scope' : 'no denials'}
                    </div>
                ) : (
                    rules.map((rule) => {
                        const isRegex = isRegexPattern(rule.pattern);
                        return (
                            <div
                                key={rule.id}
                                className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/40 hover:border-border/70 transition-colors"
                            >
                                <span className="flex-1 font-mono text-[11px] text-foreground/80 truncate">{rule.pattern}</span>
                                {isRegex && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-purple-500/10 text-purple-400 border-purple-500/30">
                                        regex
                                    </Badge>
                                )}
                                <button
                                    onClick={() => {
                                        if (projectId) dispatch(removeRule({ scopeId, list, ruleId: rule.id, projectId }));
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400 transition-all"
                                    title="Remove rule"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// ─── URL Tester ─────────────────────────────────────────────────────────────

interface UrlTesterProps {
    scope: Scope;
}

function UrlTester({ scope }: UrlTesterProps) {
    const [url, setUrl] = useState('');

    const result = url.trim()
        ? isUrlInScope(scope, url.trim())
        : null;

    return (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/50 bg-muted/20">
            <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground">URL Tester</span>
            </div>

            <Input
                placeholder="https://example.com/path?query=1"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-7 text-[11px] font-mono bg-muted/40"
            />

            {result !== null && (
                <div
                    className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold border',
                        result
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    )}
                >
                    {result ? (
                        <>
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            IN SCOPE — URL matches allow rules and is not denied.
                        </>
                    ) : (
                        <>
                            <ShieldX className="w-3.5 h-3.5 shrink-0" />
                            OUT OF SCOPE — URL matches deny rules or does not match allow rules.
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── ScopeListItem Component ────────────────────────────────────────────────

interface ScopeListItemProps {
    scope: Scope;
    isSelected: boolean;
    isActive: boolean;
    onSelect: () => void;
}

function ScopeListItem({ scope, isSelected, isActive, onSelect }: ScopeListItemProps) {
    return (
        <div
            onClick={onSelect}
            className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer select-none transition-colors group text-[11px]',
                isSelected
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
        >
            <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: scope.color }}
            />
            <span className="truncate flex-1">{scope.name}</span>
            {isActive && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-primary/40 text-primary">
                    Active
                </Badge>
            )}
        </div>
    );
}

export default function ScopeManager() {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const scopes = useAppSelector(selectAllScopes(projectId));
    const activeScopeId = useAppSelector(selectActiveScopeId(projectId));

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportTargetScope, setExportTargetScope] = useState<Scope | null>(null);

    const selectedScope = scopes.find((s) => s.id === selectedId) ?? null;
    const effectiveSelectedScope =
        selectedScope ?? (scopes.length > 0 ? scopes[0] : null);

    const handleCreate = () => {
        const trimmed = newName.trim();
        if (!trimmed || !projectId) return;
        dispatch(createScope({ name: trimmed, projectId }));
        setNewName('');
    };

    const handleOpenImport = () => {
        setImportModalOpen(true);
    };

    const handleOpenExportForScope = (scope: Scope) => {
        setExportTargetScope(scope);
        setExportModalOpen(true);
    };

    return (
        <div className="flex h-full min-h-0 overflow-hidden bg-background">
            {/* ── LEFT PANEL: Scope list ── */}
            <div className="flex flex-col w-60 shrink-0 border-r border-border/50 bg-card/40">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Crosshair className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-[12px] font-semibold text-foreground">Scopes</span>
                        <span className="text-[10px] text-muted-foreground">({scopes.length})</span>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleOpenImport}
                        title="Import Burp Suite Scope JSON"
                        className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                    >
                        <Upload className="w-3 h-3" />
                        Import Burp
                    </Button>
                </div>

                {/* New scope input */}
                <div className="flex gap-1.5 px-2.5 py-2 border-b border-border/50">
                    <Input
                        placeholder="New scope name…"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        className="h-6 text-[11px] bg-muted/40"
                    />
                    <Button
                        size="sm"
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        className="h-6 px-1.5 shrink-0"
                    >
                        <Plus className="w-3 h-3" />
                    </Button>
                </div>

                {/* No active scope option */}
                <div
                    onClick={() => {
                        if (projectId) dispatch(setActiveScope({ scopeId: null, projectId }));
                    }}
                    className={cn(
                        'flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b border-border/30 transition-colors select-none',
                        activeScopeId === null
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                    )}
                >
                    <CircleDot className="w-2.5 h-2.5 shrink-0" />
                    <span className="text-[11px] font-medium">No Scope (all traffic)</span>
                    {activeScopeId === null && (
                        <Check className="w-2.5 h-2.5 ml-auto" />
                    )}
                </div>

                {/* Scope list */}
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                    {scopes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2.5 text-center px-4">


                        </div>
                    ) : (
                        scopes.map((scope) => (
                            <ScopeListItem
                                key={scope.id}
                                scope={scope}
                                isSelected={(effectiveSelectedScope?.id ?? null) === scope.id}
                                isActive={scope.id === activeScopeId}
                                onSelect={() => setSelectedId(scope.id)}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* ── RIGHT PANEL: Scope editor ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {effectiveSelectedScope ? (
                    <>
                        {/* Scope editor header */}
                        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 bg-card/20 shrink-0">
                            <div
                                className="w-3 h-3 rounded-full ring-2 ring-inset ring-white/10 shrink-0"
                                style={{ backgroundColor: effectiveSelectedScope.color }}
                            />
                            <span className="text-[13px] font-semibold text-foreground">{effectiveSelectedScope.name}</span>

                            {/* Color picker */}
                            <div className="flex items-center gap-1 ml-2">
                                {PALETTE.map((color) => (
                                    <button
                                        key={color}
                                        onClick={() => {
                                            if (projectId) dispatch(setScopeColor({ id: effectiveSelectedScope.id, color, projectId }));
                                        }}
                                        title={color}
                                        className={cn(
                                            'w-3.5 h-3.5 rounded-full transition-transform hover:scale-110 ring-1 ring-inset ring-white/10',
                                            effectiveSelectedScope.color === color && 'ring-2 ring-white/60 scale-110'
                                        )}
                                        style={{ backgroundColor: color }}
                                    />
                                ))}
                            </div>

                            {/* Scope Action Buttons: Export | Set Active / Deactivate | Delete */}
                            <div className="ml-auto flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenExportForScope(effectiveSelectedScope)}
                                    className="h-6 text-[11px] gap-1 border-border/60 hover:bg-muted/40 text-foreground"
                                    title="Export this scope to Burp Suite JSON"
                                >
                                    <Download className="w-3 h-3" />
                                    Export
                                </Button>

                                <div className="h-4 w-px bg-border/50 mx-0.5" />

                                {activeScopeId === effectiveSelectedScope.id ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            if (projectId) dispatch(setActiveScope({ scopeId: null, projectId }));
                                        }}
                                        className="h-6 text-[11px] border-primary/40 text-primary hover:bg-primary/10"
                                    >
                                        <Check className="w-3 h-3 mr-1" />
                                        Active — click to deactivate
                                    </Button>
                                ) : (
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            if (projectId) dispatch(setActiveScope({ scopeId: effectiveSelectedScope.id, projectId }));
                                        }}
                                        className="h-6 text-[11px]"
                                    >
                                        <Crosshair className="w-3 h-3 mr-1" />
                                        Set as Active
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        if (projectId) {
                                            dispatch(deleteScope({ id: effectiveSelectedScope.id, projectId }));
                                            setSelectedId(null);
                                        }
                                    }}
                                    className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete scope"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </Button>
                            </div>
                        </div>

                        {/* Allow + Deny lists */}
                        <div className="flex-1 min-h-0 overflow-y-auto p-4">
                            <div className="flex gap-4">
                                <RuleList
                                    scopeId={effectiveSelectedScope.id}
                                    list="allow"
                                    rules={effectiveSelectedScope.allow}
                                />
                                <div className="w-px bg-border/40 shrink-0" />
                                <RuleList
                                    scopeId={effectiveSelectedScope.id}
                                    list="deny"
                                    rules={effectiveSelectedScope.deny}
                                />
                            </div>

                            {/* URL Tester */}
                            <div className="mt-4">
                                <UrlTester scope={effectiveSelectedScope} />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                        <div className="p-4 rounded-full bg-muted/30 border border-border/30">
                            <Crosshair className="w-8 h-8 text-muted-foreground/40" />
                        </div>
                        <div>
                            <p className="text-[13px] font-medium text-muted-foreground">No scope selected</p>
                            <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
                                Create a scope on the left or import<br />a Burp Suite JSON configuration.
                            </p>
                            <Button
                                size="sm"
                                onClick={handleOpenImport}
                                className="mt-3 h-7 text-xs gap-1.5"
                            >
                                <Upload className="w-3.5 h-3.5" />
                                Import Burp Scope
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Burp Suite Import Modal Dialog ── */}
            <BurpScopeModal
                open={importModalOpen}
                onOpenChange={setImportModalOpen}
            />

            {/* ── Burp Suite Export Modal Dialog for specific scope ── */}
            <BurpExportModal
                open={exportModalOpen}
                onOpenChange={setExportModalOpen}
                scope={exportTargetScope}
            />
        </div>
    );
}
