import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { markFailedRequestsPending, markRequestPending, markWorkerRequestsPending } from '@/store/slices/fuzzerSlice';
import { FuzzRunState } from '@/types/fuzzer.type';
import { invoke } from '@tauri-apps/api/core';
import { Activity, AlertTriangle, ChevronDown, Cpu, RotateCcw, Square, WifiOff, Globe, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { selectActiveScope } from '@/store/slices/scopeSlice';
import { isInScope } from '@/lib/scopeMatcher';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getStatusBadgeStyle } from '@/components/Replayer/HistoryRequests';

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

    const workers = runState.workers ?? [];
    const droppedWorkersCount = workers.filter((w) => w.status === 'dropped').length;

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
        } catch (err) {
            console.error('Failed to resume requests:', err);
        }
    };

    const handleResendWorker = async (workerId: number) => {
        if (!projectId) return;
        dispatch(markWorkerRequestsPending({ sessionIndex, historyIndex, workerId, projectId }));
        const normalizedUrl = stripPath(targetUrl);

        try {
            await invoke('resend_worker_fuzz_requests', {
                url: normalizedUrl,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                workerId,
                delayMs,
                alreadyCompleted: runState.completed,
                overallTotal: runState.total,
            });
        } catch (err) {
            console.error('Failed to resend worker requests:', err);
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
                        ) : runState.connectionDropped ? (
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
                    {workers.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium border-border/50">
                                    <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span>Workers ({workers.length})</span>
                                    {droppedWorkersCount > 0 && (
                                        <span className="rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400 px-1.5 py-0.2 text-[10px] font-bold">
                                            {droppedWorkersCount} dropped
                                        </span>
                                    )}
                                    <ChevronDown className="w-3 h-3 text-muted-foreground/70 ml-0.5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 text-xs">
                                <DropdownMenuLabel className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    Worker Threads
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {workers.map((w) => (
                                    <DropdownMenuItem
                                        key={w.workerId}
                                        className="flex items-center justify-between text-xs cursor-pointer py-1.5"
                                        onClick={() => {
                                            if (w.status === 'dropped' || w.status === 'completed' || w.status === 'pending') {
                                                handleResendWorker(w.workerId);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "w-2 h-2 rounded-full",
                                                w.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                                                    w.status === 'dropped' ? 'bg-rose-500' :
                                                        w.status === 'completed' ? 'bg-emerald-500/60' : 'bg-muted-foreground/40'
                                            )} />
                                            <span>Worker #{w.workerId + 1}</span>
                                        </div>
                                        <span className="text-[11px] text-muted-foreground font-mono">
                                            {w.completed}/{w.total}
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}

                    {/* Resume Button when stopped with unfinished requests */}
                    {!isRunning && runState.status === 'cancelled' && remainingCount > 0 && (
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

                    {/* Resend failed button if any requests failed */}
                    {!isRunning && (failedCount > 0 || (runState.status === 'completed' && failedCount > 0)) && (
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
            {runState.connectionDropped && (
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
                        Re-send Dropped Requests
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
