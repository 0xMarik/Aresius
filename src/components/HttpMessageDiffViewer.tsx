import React, { useMemo, useState } from 'react';
import * as Diff from 'diff';
import { Copy, Check, GitCompare, Columns2, Rows2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { EditType } from '@/types/http.type';

export interface HttpMessageDiffViewerProps {
    original: string;
    automated?: string | null;
    edited: string;
    title?: string;
    editType?: EditType | string | null;
}

export type DiffScope = 'combined' | 'auto_only' | 'manual_only' | 'final_only';

interface UnifiedDiffLine {
    type: 'added' | 'removed' | 'unchanged';
    oldLineNum: number | null;
    newLineNum: number | null;
    content: string;
    source?: 'automated' | 'manual' | null;
    wordDiffs?: Diff.Change[];
}

interface SplitDiffRow {
    left: {
        lineNum: number | null;
        content: string;
        type: 'removed' | 'unchanged' | 'empty';
        source?: 'automated' | 'manual' | null;
        wordDiffs?: Diff.Change[];
    } | null;
    right: {
        lineNum: number | null;
        content: string;
        type: 'added' | 'unchanged' | 'empty';
        source?: 'automated' | 'manual' | null;
        wordDiffs?: Diff.Change[];
    } | null;
}

export const HttpMessageDiffViewer: React.FC<HttpMessageDiffViewerProps> = ({
    original,
    automated,
    edited,
    title,
    editType,
}) => {
    const [viewLayout, setViewLayout] = useState<'unified' | 'split'>('unified');
    const [diffScope, setDiffScope] = useState<DiffScope>('combined');
    const [copied, setCopied] = useState(false);

    const hasBoth = editType === 'both' && automated !== undefined && automated !== null;

    // Determine base and target texts based on selected diff scope
    const { baseText, targetText, effectiveSource } = useMemo(() => {
        if (!hasBoth) {
            return {
                baseText: original || '',
                targetText: edited || '',
                effectiveSource: editType as 'automated' | 'manual' | null,
            };
        }

        switch (diffScope) {
            case 'auto_only':
                return {
                    baseText: original || '',
                    targetText: automated || '',
                    effectiveSource: 'automated' as const,
                };
            case 'manual_only':
                return {
                    baseText: automated || '',
                    targetText: edited || '',
                    effectiveSource: 'manual' as const,
                };
            case 'final_only':
                return {
                    baseText: original || '',
                    targetText: edited || '',
                    effectiveSource: null,
                };
            case 'combined':
            default:
                return {
                    baseText: original || '',
                    targetText: edited || '',
                    effectiveSource: null,
                };
        }
    }, [hasBoth, diffScope, original, automated, edited, editType]);

    // Sets of lines for automated vs manual attribution in combined mode
    const automatedLinesSet = useMemo(() => {
        if (!automated) return new Set<string>();
        return new Set(automated.replace(/\r\n/g, '\n').split('\n'));
    }, [automated]);

    const originalLinesSet = useMemo(() => {
        if (!original) return new Set<string>();
        return new Set(original.replace(/\r\n/g, '\n').split('\n'));
    }, [original]);

    // Compute diff chunks
    const diffResult = useMemo(() => {
        const lineChanges = Diff.diffLines(baseText, targetText, { newlineIsToken: false });

        let additions = 0;
        let deletions = 0;
        let autoAdditions = 0;
        let manualAdditions = 0;
        let oldLineCounter = 1;
        let newLineCounter = 1;

        const unifiedLines: UnifiedDiffLine[] = [];

        for (let i = 0; i < lineChanges.length; i++) {
            const change = lineChanges[i];
            const rawLines = change.value.replace(/\r\n/g, '\n').split('\n');
            if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
                rawLines.pop();
            }

            const nextChange = lineChanges[i + 1];
            const isPairedRemoved = change.removed && nextChange?.added;
            const isPairedAdded = change.added && i > 0 && lineChanges[i - 1]?.removed;

            let pairedWords: Diff.Change[] | null = null;
            if (isPairedRemoved && nextChange) {
                pairedWords = Diff.diffWordsWithSpace(change.value, nextChange.value);
            } else if (isPairedAdded) {
                const prevChange = lineChanges[i - 1];
                pairedWords = Diff.diffWordsWithSpace(prevChange.value, change.value);
            }

            if (change.added) {
                additions += rawLines.length;
                rawLines.forEach((line) => {
                    let source: 'automated' | 'manual' | null = effectiveSource || null;
                    if (!source && hasBoth && diffScope === 'combined') {
                        // Check whether this line originated from automated (M&R) or manual intercept
                        if (automatedLinesSet.has(line) && !originalLinesSet.has(line)) {
                            source = 'automated';
                            autoAdditions++;
                        } else {
                            source = 'manual';
                            manualAdditions++;
                        }
                    } else if (source === 'automated') {
                        autoAdditions++;
                    } else if (source === 'manual') {
                        manualAdditions++;
                    }

                    unifiedLines.push({
                        type: 'added',
                        oldLineNum: null,
                        newLineNum: newLineCounter++,
                        content: line,
                        source,
                        wordDiffs: pairedWords ? pairedWords.filter((w) => !w.removed) : undefined,
                    });
                });
            } else if (change.removed) {
                deletions += rawLines.length;
                rawLines.forEach((line) => {
                    let source: 'automated' | 'manual' | null = effectiveSource || null;
                    if (!source && hasBoth && diffScope === 'combined') {
                        if (!automatedLinesSet.has(line)) {
                            source = 'automated';
                        } else {
                            source = 'manual';
                        }
                    }

                    unifiedLines.push({
                        type: 'removed',
                        oldLineNum: oldLineCounter++,
                        newLineNum: null,
                        content: line,
                        source,
                        wordDiffs: pairedWords ? pairedWords.filter((w) => !w.added) : undefined,
                    });
                });
            } else {
                rawLines.forEach((line) => {
                    unifiedLines.push({
                        type: 'unchanged',
                        oldLineNum: oldLineCounter++,
                        newLineNum: newLineCounter++,
                        content: line,
                    });
                });
            }
        }

        // Build Split / Side-by-Side rows
        const splitRows: SplitDiffRow[] = [];
        let curOld = 1;
        let curNew = 1;

        for (let i = 0; i < lineChanges.length; i++) {
            const change = lineChanges[i];
            const nextChange = lineChanges[i + 1];

            const rawLines = change.value.replace(/\r\n/g, '\n').split('\n');
            if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
                rawLines.pop();
            }

            if (change.removed && nextChange?.added) {
                // Paired modification
                const nextLines = nextChange.value.replace(/\r\n/g, '\n').split('\n');
                if (nextLines.length > 1 && nextLines[nextLines.length - 1] === '') {
                    nextLines.pop();
                }

                const wordDiffs = Diff.diffWordsWithSpace(change.value, nextChange.value);
                const maxLen = Math.max(rawLines.length, nextLines.length);

                for (let j = 0; j < maxLen; j++) {
                    const leftLine = rawLines[j];
                    const rightLine = nextLines[j];

                    let leftSource = effectiveSource;
                    let rightSource = effectiveSource;

                    if (!effectiveSource && hasBoth && diffScope === 'combined') {
                        if (leftLine && !automatedLinesSet.has(leftLine)) {
                            leftSource = 'automated';
                        } else {
                            leftSource = 'manual';
                        }

                        if (rightLine && automatedLinesSet.has(rightLine) && !originalLinesSet.has(rightLine)) {
                            rightSource = 'automated';
                        } else {
                            rightSource = 'manual';
                        }
                    }

                    splitRows.push({
                        left: leftLine !== undefined
                            ? {
                                lineNum: curOld++,
                                content: leftLine,
                                type: 'removed',
                                source: leftSource,
                                wordDiffs: wordDiffs.filter((w) => !w.added),
                            }
                            : { lineNum: null, content: '', type: 'empty' },
                        right: rightLine !== undefined
                            ? {
                                lineNum: curNew++,
                                content: rightLine,
                                type: 'added',
                                source: rightSource,
                                wordDiffs: wordDiffs.filter((w) => !w.removed),
                            }
                            : { lineNum: null, content: '', type: 'empty' },
                    });
                }
                i++; // Skip paired item
            } else if (change.removed) {
                rawLines.forEach((line) => {
                    let source = effectiveSource;
                    if (!source && hasBoth && diffScope === 'combined') {
                        source = !automatedLinesSet.has(line) ? 'automated' : 'manual';
                    }

                    splitRows.push({
                        left: { lineNum: curOld++, content: line, type: 'removed', source },
                        right: { lineNum: null, content: '', type: 'empty' },
                    });
                });
            } else if (change.added) {
                rawLines.forEach((line) => {
                    let source = effectiveSource;
                    if (!source && hasBoth && diffScope === 'combined') {
                        source = automatedLinesSet.has(line) && !originalLinesSet.has(line) ? 'automated' : 'manual';
                    }

                    splitRows.push({
                        left: { lineNum: null, content: '', type: 'empty' },
                        right: { lineNum: curNew++, content: line, type: 'added', source },
                    });
                });
            } else {
                rawLines.forEach((line) => {
                    splitRows.push({
                        left: { lineNum: curOld++, content: line, type: 'unchanged' },
                        right: { lineNum: curNew++, content: line, type: 'unchanged' },
                    });
                });
            }
        }

        return {
            unifiedLines,
            splitRows,
            additions,
            deletions,
            autoAdditions,
            manualAdditions,
        };
    }, [baseText, targetText, effectiveSource, hasBoth, diffScope, automatedLinesSet, originalLinesSet]);

    const handleCopyPatch = () => {
        const patch = Diff.createPatch(
            title || 'http-message',
            baseText,
            targetText,
            hasBoth && diffScope === 'manual_only' ? 'Automated' : 'Original',
            hasBoth && diffScope === 'auto_only' ? 'Automated' : 'Final'
        );
        navigator.clipboard.writeText(patch);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const renderSourceBadge = (source?: 'automated' | 'manual' | null) => {
        if (source === 'automated') {
            return (
                <span className="inline-flex items-center px-1 py-0 text-[9px] font-semibold rounded bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30 mr-1.5 select-none shrink-0">
                    Auto
                </span>
            );
        }
        if (source === 'manual') {
            return (
                <span className="inline-flex items-center px-1 py-0 text-[9px] font-semibold rounded bg-sky-500/20 text-sky-600 dark:text-sky-300 border border-sky-500/30 mr-1.5 select-none shrink-0">
                    Manual
                </span>
            );
        }
        return null;
    };

    const renderWordDiffLine = (line: UnifiedDiffLine) => {
        if (!line.wordDiffs || line.wordDiffs.length === 0) {
            return <span>{line.content || ' '}</span>;
        }

        return (
            <span>
                {line.wordDiffs.map((part, idx) => {
                    if (part.added && line.type === 'added') {
                        return (
                            <span
                                key={idx}
                                className={`font-semibold rounded-xs px-0.5 ${
                                    line.source === 'automated'
                                        ? 'bg-purple-500/35 text-purple-100'
                                        : line.source === 'manual'
                                        ? 'bg-sky-500/35 text-sky-100'
                                        : 'bg-emerald-500/40 text-emerald-100'
                                }`}
                            >
                                {part.value}
                            </span>
                        );
                    }
                    if (part.removed && line.type === 'removed') {
                        return (
                            <span
                                key={idx}
                                className="bg-rose-500/40 text-rose-100 font-semibold rounded-xs px-0.5 line-through opacity-90"
                            >
                                {part.value}
                            </span>
                        );
                    }
                    return <span key={idx}>{part.value}</span>;
                })}
            </span>
        );
    };

    return (
        <div className="flex flex-col h-full w-full bg-background select-text font-mono text-xs overflow-hidden">
            {/* Diff Sub-Header / Toolbar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border/40 text-[11px] shrink-0 select-none">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <GitCompare className="w-3.5 h-3.5 text-primary" />
                        <span className="font-semibold text-foreground/80">Differentiation</span>
                    </div>

                    {/* Scope Selector when both edit types exist */}
                    {hasBoth ? (
                        <div className="flex items-center bg-background p-0.5 rounded border border-border/60 shadow-2xs text-[10px]">
                            <button
                                type="button"
                                onClick={() => setDiffScope('combined')}
                                className={`px-1.5 py-0.5 rounded-xs transition-colors ${
                                    diffScope === 'combined'
                                        ? 'bg-primary/20 text-primary font-semibold'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                All Changes
                            </button>
                            <button
                                type="button"
                                onClick={() => setDiffScope('auto_only')}
                                className={`px-1.5 py-0.5 rounded-xs transition-colors flex items-center gap-1 ${
                                    diffScope === 'auto_only'
                                        ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 font-semibold'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                Orig ➔ Auto
                            </button>
                            <button
                                type="button"
                                onClick={() => setDiffScope('manual_only')}
                                className={`px-1.5 py-0.5 rounded-xs transition-colors flex items-center gap-1 ${
                                    diffScope === 'manual_only'
                                        ? 'bg-sky-500/20 text-sky-600 dark:text-sky-300 font-semibold'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                                Auto ➔ Manual
                            </button>
                            <button
                                type="button"
                                onClick={() => setDiffScope('final_only')}
                                className={`px-1.5 py-0.5 rounded-xs transition-colors ${
                                    diffScope === 'final_only'
                                        ? 'bg-primary/20 text-primary font-semibold'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                Orig ➔ Final
                            </button>
                        </div>
                    ) : editType === 'automated' ? (
                        <Badge
                            variant="outline"
                            className="h-4.5 px-1.5 py-0 text-[10px] font-mono font-medium border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400"
                        >
                            Automated (Match & Replace)
                        </Badge>
                    ) : editType === 'manual' ? (
                        <Badge
                            variant="outline"
                            className="h-4.5 px-1.5 py-0 text-[10px] font-mono font-medium border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        >
                            Manual (Interception)
                        </Badge>
                    ) : null}

                    {/* Stats badges */}
                    <div className="flex items-center gap-1">
                        <Badge
                            variant="outline"
                            className="h-4.5 px-1.5 py-0 text-[10px] font-mono font-medium border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        >
                            +{diffResult.additions}
                        </Badge>
                        <Badge
                            variant="outline"
                            className="h-4.5 px-1.5 py-0 text-[10px] font-mono font-medium border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        >
                            -{diffResult.deletions}
                        </Badge>
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {/* Unified vs Split Layout Toggle */}
                    <div className="flex items-center bg-background p-0.5 rounded border border-border/50 shadow-2xs">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setViewLayout('unified')}
                                        className={`h-5 w-5 rounded-xs p-0 ${
                                            viewLayout === 'unified'
                                                ? 'bg-primary/15 text-primary'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <Rows2 className="w-3 h-3" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-[10px]">
                                    Unified View
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setViewLayout('split')}
                                        className={`h-5 w-5 rounded-xs p-0 ${
                                            viewLayout === 'split'
                                                ? 'bg-primary/15 text-primary'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <Columns2 className="w-3 h-3" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-[10px]">
                                    Split View
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    {/* Copy Patch */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCopyPatch}
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                >
                                    {copied ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px]">
                                {copied ? 'Patch Copied!' : 'Copy Patch'}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Diff Content View */}
            <div className="flex-1 min-h-0 overflow-auto">
                {viewLayout === 'unified' ? (
                    /* Unified Diff View */
                    <table className="w-full border-collapse font-mono text-[11px] leading-relaxed select-text">
                        <tbody>
                            {diffResult.unifiedLines.map((line, idx) => {
                                const isAdd = line.type === 'added';
                                const isDel = line.type === 'removed';

                                return (
                                    <tr
                                        key={idx}
                                        className={`group transition-colors ${
                                            isAdd
                                                ? line.source === 'automated'
                                                    ? 'bg-purple-500/10 hover:bg-purple-500/15 text-purple-900 dark:text-purple-200'
                                                    : line.source === 'manual'
                                                    ? 'bg-sky-500/10 hover:bg-sky-500/15 text-sky-900 dark:text-sky-200'
                                                    : 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                                                : isDel
                                                ? 'bg-rose-500/10 hover:bg-rose-500/15 text-rose-800 dark:text-rose-300'
                                                : 'hover:bg-muted/30 text-foreground/80'
                                        }`}
                                    >
                                        {/* Old Line Number */}
                                        <td className="w-10 px-2 py-0 text-right select-none text-muted-foreground/50 border-r border-border/30 bg-muted/20 text-[10px] tabular-nums">
                                            {line.oldLineNum ?? ''}
                                        </td>

                                        {/* New Line Number */}
                                        <td className="w-10 px-2 py-0 text-right select-none text-muted-foreground/50 border-r border-border/30 bg-muted/20 text-[10px] tabular-nums">
                                            {line.newLineNum ?? ''}
                                        </td>

                                        {/* Marker (+ / - / space) */}
                                        <td className="w-6 text-center select-none font-bold text-xs">
                                            {isAdd ? (
                                                <span className={line.source === 'automated' ? 'text-purple-500' : line.source === 'manual' ? 'text-sky-500' : 'text-emerald-500'}>
                                                    +
                                                </span>
                                            ) : isDel ? (
                                                <span className="text-rose-500">-</span>
                                            ) : (
                                                <span className="opacity-0"> </span>
                                            )}
                                        </td>

                                        {/* Code / Content */}
                                        <td className="px-2 py-0.5 whitespace-pre-wrap break-all font-mono">
                                            <div className="flex items-start">
                                                {renderSourceBadge(line.source)}
                                                <span className="flex-1 min-w-0">{renderWordDiffLine(line)}</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    /* Split / Side-by-Side Diff View */
                    <div className="flex h-full min-w-[600px] border-collapse font-mono text-[11px] leading-relaxed">
                        {/* Left Side: Base */}
                        <div className="flex-1 border-r border-border/50 overflow-hidden flex flex-col">
                            <div className="px-3 py-1 bg-muted/60 border-b border-border/40 text-[10px] font-semibold text-muted-foreground select-none">
                                {hasBoth && diffScope === 'manual_only' ? 'Automated (M&R Base)' : 'Original (Base)'}
                            </div>
                            <div className="flex-1 overflow-auto">
                                <table className="w-full border-collapse">
                                    <tbody>
                                        {diffResult.splitRows.map((row, idx) => {
                                            const left = row.left;
                                            const isDel = left?.type === 'removed';
                                            const isEmpty = left?.type === 'empty';

                                            return (
                                                <tr
                                                    key={idx}
                                                    className={`transition-colors ${
                                                        isDel
                                                            ? 'bg-rose-500/10 hover:bg-rose-500/15 text-rose-800 dark:text-rose-300'
                                                            : isEmpty
                                                            ? 'bg-muted/10'
                                                            : 'hover:bg-muted/30 text-foreground/80'
                                                    }`}
                                                >
                                                    <td className="w-10 px-2 py-0 text-right select-none text-muted-foreground/50 border-r border-border/30 bg-muted/20 text-[10px] tabular-nums">
                                                        {left?.lineNum ?? ''}
                                                    </td>
                                                    <td className="w-5 text-center select-none font-bold text-xs text-rose-500">
                                                        {isDel ? '-' : ''}
                                                    </td>
                                                    <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                                                        <div className="flex items-start">
                                                            {renderSourceBadge(left?.source)}
                                                            <span className="flex-1 min-w-0">{left ? left.content || ' ' : ''}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Right Side: Target */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="px-3 py-1 bg-muted/60 border-b border-border/40 text-[10px] font-semibold text-muted-foreground select-none">
                                {hasBoth && diffScope === 'auto_only' ? 'Automated (M&R)' : 'Final (Modified)'}
                            </div>
                            <div className="flex-1 overflow-auto">
                                <table className="w-full border-collapse">
                                    <tbody>
                                        {diffResult.splitRows.map((row, idx) => {
                                            const right = row.right;
                                            const isAdd = right?.type === 'added';
                                            const isEmpty = right?.type === 'empty';

                                            return (
                                                <tr
                                                    key={idx}
                                                    className={`transition-colors ${
                                                        isAdd
                                                            ? right?.source === 'automated'
                                                                ? 'bg-purple-500/10 hover:bg-purple-500/15 text-purple-900 dark:text-purple-200'
                                                                : right?.source === 'manual'
                                                                ? 'bg-sky-500/10 hover:bg-sky-500/15 text-sky-900 dark:text-sky-200'
                                                                : 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                                                            : isEmpty
                                                            ? 'bg-muted/10'
                                                            : 'hover:bg-muted/30 text-foreground/80'
                                                    }`}
                                                >
                                                    <td className="w-10 px-2 py-0 text-right select-none text-muted-foreground/50 border-r border-border/30 bg-muted/20 text-[10px] tabular-nums">
                                                        {right?.lineNum ?? ''}
                                                    </td>
                                                    <td className="w-5 text-center select-none font-bold text-xs text-emerald-500">
                                                        {isAdd ? '+' : ''}
                                                    </td>
                                                    <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                                                        <div className="flex items-start">
                                                            {renderSourceBadge(right?.source)}
                                                            <span className="flex-1 min-w-0">{right ? right.content || ' ' : ''}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HttpMessageDiffViewer;
