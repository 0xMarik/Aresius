import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { markFailedRequestsPending, markRequestPending, updateHistoryNumThreads } from '@/store/slices/fuzzerSlice';
import { FuzzRunState } from '@/types/fuzzer.type';
import { invoke } from '@tauri-apps/api/core';
import { Activity, AlertTriangle, Cpu, RotateCcw, Square, WifiOff, Globe, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { isInScope } from '@/lib/scopeMatcher';
import { useMemo, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getStatusBadgeStyle } from '@/components/Replayer/HistoryRequests';
import { toast } from 'sonner';

import { stripPath } from '@/components/ValidateUrlInput';

interface FuzzerRunToolbarProps {
    sessionIndex: number;
    historyIndex: number;
    runState: FuzzRunState;
    targetUrl: string;
    numThreads: number;
    delayMs: number;
    failedCount: number;
}

export function FuzzerRunToolbar({
    sessionIndex,
    historyIndex,
    runState,
    targetUrl,
    numThreads,
    delayMs,
    failedCount,
}: FuzzerRunToolbarProps) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const activeScope = useAppSelector(selectActiveScope(projectId));

    // Determine if the fuzzer target is outside the active scope
    const isTargetOutOfScope = useMemo(() => {
        if (!activeScope || !targetUrl) return false;
        try {
            const url = new URL(targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`);
            return !isInScope(activeScope, url.hostname);
        } catch {
            return false;
        }
    }, [activeScope, targetUrl]);

    const isRunning = runState.status === 'running';
    const percent = runState.total > 0
        ? Math.round((runState.completed / runState.total) * 100)
        : 0;

    const remainingCount = Math.max(0, runState.total - runState.completed);

    const statusLabel: Record<FuzzRunState['status'], string> = {
        idle: 'Idle',
        running: 'Running',
        completed: 'Completed',
        cancelled: 'Stopped',
        connection_dropped: 'Connection Dropped',
    };

    const handleStop = async () => {
        try {
            await invoke('cancel_fuzzing', {
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
            });
        } catch (err) {
            console.error('Failed to stop fuzzing:', err);
        }
    };

    const handleResumeOrResend = async () => {
        if (!projectId) return;
        dispatch(markFailedRequestsPending({ sessionIndex, historyIndex, projectId }));
        const normalizedUrl = stripPath(targetUrl);
        try {
            await invoke('resend_failed_fuzz_requests', {
                url: normalizedUrl,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                delayMs,
                alreadyCompleted: runState.completed,
                overallTotal: runState.total,
            });
        } catch (err: any) {
            console.error('Failed to resume requests:', err);
            toast.error(typeof err === 'string' ? err : 'Failed to resume requests');
        }
    };

    const [popoverOpen, setPopoverOpen] = useState(false);
    const [tempThreads, setTempThreads] = useState(String(numThreads || 1));

    useEffect(() => {
        setTempThreads(String(numThreads || 1));
    }, [numThreads]);

    const handleUpdateThreads = async (newCount: number) => {
        if (!projectId) return;
        const clamped = Math.max(1, Math.min(100, Math.round(newCount)));
        if (clamped === numThreads) return;
        dispatch(updateHistoryNumThreads({
            projectId,
            sessionIndex,
            historyIndex,
            numThreads: clamped,
        }));
        try {
            await invoke('set_fuzzer_threads', {
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                numThreads: clamped,
            });
        } catch (err) {
            console.error('Failed to update fuzzer threads:', err);
        }
    };

    const statusBadgeClass = useMemo(() => {
        if (isRunning) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold';
        if (runState.status === 'completed') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
        if (runState.status === 'connection_dropped') return 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
        if (runState.status === 'cancelled') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-medium';
        return getStatusBadgeStyle(runState.status);
    }, [isRunning, runState.status]);

    return (
        <div className="flex flex-col shrink-0 bg-card/40 border-b border-border/40 select-none">
            {/* Main Header Toolbar */}
            <div className="flex items-center justify-between px-3 h-12 gap-4">
                {/* Left: Status + Progress + Target */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 shrink-0">
                        {isRunning ? (
                            <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                        ) : runState.status === 'connection_dropped' || runState.connectionDropped ? (
                            <WifiOff className="w-3.5 h-3.5 text-rose-500" />
                        ) : runState.status === 'cancelled' ? (
                            <Square className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20" />
                        ) : (
                            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[10px] font-mono px-2 py-0.5 capitalize",
                                statusBadgeClass
                            )}
                        >
                            {statusLabel[runState.status] ?? runState.status}
                        </Badge>
                    </div>

                    {/* Target URL Pill */}
                    {targetUrl && (
                        <div className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-muted-foreground shrink-0 max-w-[220px]">
                            <Globe className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                            <span className="font-mono text-[11px] truncate" title={targetUrl}>
                                {targetUrl}
                            </span>
                        </div>
                    )}

                    {/* Progress Bar Capsule */}
                    <div className="flex items-center gap-2 bg-muted/20 px-2.5 py-1 rounded-md border border-border/40 flex-1 max-w-sm">
                        <Progress value={percent} className="h-1.5 flex-1" />
                        <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
                            {percent}%
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground/60 tabular-nums shrink-0">
                            ({runState.completed}/{runState.total})
                        </span>
                    </div>
                </div>

                {/* Right: Actions / Controls */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Dynamic Thread Concurrency Control */}
                    <div className="flex items-center rounded-md border border-border/40 bg-secondary/80 h-7 overflow-hidden text-xs font-mono shadow-2xs">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateThreads((numThreads || 1) - 1);
                            }}
                            disabled={(numThreads || 1) <= 1}
                            className="h-full px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer text-xs font-bold select-none border-r border-border/30"
                            title="Decrease threads (-1)"
                        >
                            -
                        </button>

                        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 px-2 h-full hover:bg-muted/60 transition-colors cursor-pointer select-none text-secondary-foreground"
                                    title="Click to adjust concurrency"
                                >
                                    <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="tabular-nums font-semibold">{numThreads || 1}</span>
                                    <span className="text-[10px] text-muted-foreground hidden sm:inline">
                                        {numThreads === 1 ? 'Thread' : 'Threads'}
                                    </span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-64 p-3 font-sans">
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold">Fuzzer Concurrency</span>
                                        <span className="text-xs font-mono text-muted-foreground">{numThreads || 1} threads</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={tempThreads}
                                            onChange={(e) => setTempThreads(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const parsed = parseInt(tempThreads, 10);
                                                    if (!isNaN(parsed)) {
                                                        handleUpdateThreads(parsed);
                                                        setPopoverOpen(false);
                                                    }
                                                }
                                            }}
                                            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-2xs font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        />
                                        <Button
                                            size="sm"
                                            className="h-8 px-3 text-xs"
                                            onClick={() => {
                                                const parsed = parseInt(tempThreads, 10);
                                                if (!isNaN(parsed)) {
                                                    handleUpdateThreads(parsed);
                                                    setPopoverOpen(false);
                                                }
                                            }}
                                        >
                                            Apply
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between gap-1 pt-1 border-t border-border/40">
                                        <span className="text-[11px] text-muted-foreground">Presets:</span>
                                        {[1, 5, 10, 20, 50].map((preset) => (
                                            <button
                                                key={preset}
                                                type="button"
                                                onClick={() => {
                                                    handleUpdateThreads(preset);
                                                    setPopoverOpen(false);
                                                }}
                                                className={cn(
                                                    "px-1.5 py-0.5 rounded text-[11px] font-mono border transition-colors cursor-pointer",
                                                    numThreads === preset
                                                        ? "bg-primary/15 border-primary/40 text-primary font-bold"
                                                        : "bg-muted/40 border-border/40 hover:bg-muted text-muted-foreground"
                                                )}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateThreads((numThreads || 1) + 1);
                            }}
                            disabled={(numThreads || 1) >= 100}
                            className="h-full px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer text-xs font-bold select-none border-l border-border/30"
                            title="Increase threads (+1)"
                        >
                            +
                        </button>
                    </div>

                    {/* Resume Button when stopped with unfinished requests */}
                    {!isRunning && remainingCount > 0 && (
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleResumeOrResend}
                            className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
                        >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            Resume ({remainingCount})
                        </Button>
                    )}

                    {/* Resend failed button if any requests failed and no pending remaining */}
                    {!isRunning && remainingCount === 0 && failedCount > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResumeOrResend}
                            className="h-8 gap-1.5 text-xs font-medium border-border/50"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Resend Failed ({failedCount})
                        </Button>
                    )}

                    {/* Stop button when running */}
                    {isRunning && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleStop}
                            className="h-8 font-semibold gap-1.5 text-xs shrink-0 shadow-xs"
                        >
                            <Square className="w-3.5 h-3.5 fill-current" />
                            STOP
                        </Button>
                    )}
                </div>
            </div>



            {/* Connection Dropped Banner */}
            {!isRunning && (runState.status === 'connection_dropped' || runState.connectionDropped) && remainingCount > 0 && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-destructive/10 border-t border-destructive/25 text-destructive text-xs">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                            Connection was lost on thread(s). Re-send the dropped requests?
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResumeOrResend}
                        className="h-6 gap-1 border-destructive/40 text-[11px] font-semibold text-destructive hover:bg-destructive/15"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Re-send Dropped Requests ({remainingCount})
                    </Button>
                </div>
            )}

            {/* Out-of-scope warning banner */}
            {isTargetOutOfScope && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-t border-amber-500/25 text-amber-800 dark:text-amber-400 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                    <span>
                        Target <span className="font-mono font-semibold">{targetUrl}</span> is outside the active scope
                        {' '}(<span className="font-medium" style={{ color: activeScope?.color }}>{activeScope?.name}</span>).
                        Fuzzing will proceed regardless.
                    </span>
                </div>
            )}
        </div>
    );
}

export async function resendSingleFuzzRequest(
    dispatch: ReturnType<typeof useAppDispatch>,
    sessionIndex: number,
    historyIndex: number,
    requestId: string,
    rawRequest: string,
    targetUrl: string,
    projectId: string | null,
) {
    if (!projectId) return;
    dispatch(markRequestPending({ sessionIndex, historyIndex, requestId, projectId }));

    await invoke('resend_fuzz_request', {
        url: targetUrl,
        target: { id: requestId, request: rawRequest },
        selectedSession: sessionIndex,
        fuzzHistory: historyIndex,
    });
}
