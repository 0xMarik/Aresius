import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { markFailedRequestsPending, markRequestPending, markWorkerRequestsPending, selectFuzzerState } from '@/store/slices/fuzzerSlice';
import { FuzzRunState } from '@/types/fuzzer.type';
import { invoke } from '@tauri-apps/api/core';
import { Activity, AlertTriangle, ChevronDown, Cpu, RotateCcw, Square, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
    const { fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
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

    const workers = runState.workers ?? [];
    const droppedWorkersCount = workers.filter((w) => w.status === 'dropped').length;

    const statusLabel: Record<FuzzRunState['status'], string> = {
        idle: 'Idle',
        running: 'Running',
        completed: 'Completed',
        cancelled: 'Cancelled',
        connection_dropped: 'Connection dropped',
    };

    const handleCancel = async () => {
        try {
            await invoke('cancel_fuzzing', {
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
            });
        } catch (err) {
            console.error('Failed to cancel fuzzing:', err);
        }
    };

    const handleResendAllFailed = async () => {
        if (!projectId) return;
        const history = fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
        if (!history) return;

        const failedRequests = history.requests.filter(
            (r) => r.status === 'error' || r.connectionDropped || r.status === 'cancelled'
        );

        if (failedRequests.length === 0) return;

        // Group failed requests by the worker that originally owned them, so each
        // worker resumes its own counter/total instead of the run flattening
        // back into a single fresh chunk starting at 0.
        const targetsByWorker = new Map<number, { id: string; request: string }[]>();
        for (const r of failedRequests) {
            if (!r.rawRequest) continue;
            const workerId = r.workerId ?? 0;
            const list = targetsByWorker.get(workerId) ?? [];
            list.push({ id: r.fuzzRequestId, request: r.rawRequest });
            targetsByWorker.set(workerId, list);
        }

        const workerGroups = Array.from(targetsByWorker.entries()).map(([workerId, targets]) => {
            const worker = workers.find((w) => w.workerId === workerId);
            return {
                workerId,
                targets,
                workerAlreadyCompleted: worker?.completed ?? 0,
                workerOriginalTotal: worker?.total ?? targets.length,
            };
        });

        if (workerGroups.length === 0) return;

        dispatch(markFailedRequestsPending({ sessionIndex, historyIndex, projectId }));
        try {
            await invoke('resend_failed_fuzz_requests', {
                url: targetUrl,
                workerGroups,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                delayMs,
                alreadyCompleted: runState.completed,   // resume point, not 0
                overallTotal: runState.total,           // original run size, not targets.length
            });
        } catch (err) {
            console.error('Failed to resend requests:', err);
        }
    };

    const handleResendWorker = async (workerId: number) => {
        if (!projectId) return;
        const history = fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
        if (!history) return;

        const targets = history.requests
            .filter((r) => r.workerId === workerId && (r.status === 'error' || r.connectionDropped || r.status === 'cancelled'))
            .map((r) => ({ id: r.fuzzRequestId, request: r.rawRequest }))
            .filter((t) => t.request);

        if (targets.length === 0) return;

        // capture before dispatch, same reasoning as the session-level values
        const worker = workers.find((w) => w.workerId === workerId);

        dispatch(markWorkerRequestsPending({ sessionIndex, historyIndex, workerId, projectId }));

        try {
            await invoke('resend_worker_fuzz_requests', {
                url: targetUrl,
                targets,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                workerId,
                delayMs,
                alreadyCompleted: runState.completed,
                overallTotal: runState.total,
                workerAlreadyCompleted: worker?.completed ?? 0,
                workerOriginalTotal: worker?.total ?? targets.length,
            });
        } catch (err) {
            console.error('Failed to resend worker requests:', err);
        }
    };

    return (
        <div className="flex flex-col gap-2 p-3 bg-muted/20 border-b border-border">
            <div className="flex items-center justify-between gap-4">
                {/* Status + Progress indicator */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 shrink-0">
                        {isRunning ? (
                            <Activity className="size-4 text-emerald-500 animate-pulse" />
                        ) : runState.connectionDropped ? (
                            <WifiOff className="size-4 text-red-500" />
                        ) : (
                            <Activity className="size-4 text-muted-foreground" />
                        )}
                        <span className="text-xs font-medium">
                            {statusLabel[runState.status] ?? runState.status}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 flex-1 max-w-xs">
                        <Progress value={percent} className="h-2" />
                        <span className="text-xs text-muted-foreground font-mono w-12 text-right">
                            {percent}%
                        </span>
                    </div>

                    <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {runState.completed} / {runState.total}
                    </span>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0">
                    {workers.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                                    <Cpu className="size-3.5" />
                                    <span>Workers ({workers.length})</span>
                                    {droppedWorkersCount > 0 && (
                                        <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.2 text-[10px] font-bold text-red-600 dark:bg-red-950 dark:text-red-400">
                                            {droppedWorkersCount} dropped
                                        </span>
                                    )}
                                    <ChevronDown className="size-3 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="text-xs">Worker Threads</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {workers.map((w) => (
                                    <DropdownMenuItem
                                        key={w.workerId}
                                        className="flex items-center justify-between text-xs cursor-pointer"
                                        onClick={() => {
                                            if (w.status === 'dropped' || w.status === 'completed') {
                                                handleResendWorker(w.workerId);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`size-2 rounded-full ${w.status === 'running' ? 'bg-emerald-500 animate-pulse' : w.status === 'dropped' ? 'bg-red-500' : 'bg-gray-400'}`} />
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

                    {isRunning && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleCancel}
                            className="h-7 gap-1"
                        >
                            <Square className="size-3 fill-current" />
                            Cancel
                        </Button>
                    )}
                    {!isRunning && failedCount > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResendAllFailed}
                            className="h-7 gap-1"
                        >
                            <RotateCcw className="size-3" />
                            Resend all ({failedCount})
                        </Button>
                    )}
                </div>
            </div>

            {/* Connection Dropped Banner */}
            {runState.connectionDropped && (
                <div className="flex items-center justify-between rounded bg-red-50 p-2 border border-red-200 text-red-900 text-xs">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="size-4 shrink-0 text-red-600" />
                        <span>
                            Connection was lost on thread(s). Would you like to re-send the failed/dropped requests?
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResendAllFailed}
                        className="h-6 gap-1 border-red-300 bg-white text-[11px] font-semibold text-red-700 hover:bg-red-100"
                    >
                        <RotateCcw className="size-3" />
                        Re-send Dropped Requests
                    </Button>
                </div>
            )}

            {/* Out-of-scope warning banner */}
            {isTargetOutOfScope && (
                <div className="flex items-center gap-2 rounded bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1.5 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-400 text-xs">
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
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
