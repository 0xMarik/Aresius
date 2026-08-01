import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { markFailedRequestsPending, markRequestPending, markWorkerRequestsPending } from '@/store/slices/fuzzerSlice';
import { FuzzRunState, FuzzWorkerState } from '@/types/fuzzer.type';
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
    const { fuzzerSessions } = useAppSelector((state) => state.fuzzerstate);

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
        const history = fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
        if (!history) return;

        const targets = history.requests
            .filter((r) => r.status === 'error' || r.connectionDropped || r.status === 'cancelled')
            .map((r) => ({ id: r.fuzzRequestId, request: r.rawRequest }))
            .filter((t) => t.request);

        if (targets.length === 0) return;

        dispatch(markFailedRequestsPending({ sessionIndex, historyIndex }));

        try {
            await invoke('resend_failed_fuzz_requests', {
                url: targetUrl,
                targets,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                numTasks: numThreads,
                delayMs,
            });
        } catch (err) {
            console.error('Failed to resend requests:', err);
        }
    };

    const handleResendWorker = async (workerId: number) => {
        const history = fuzzerSessions[sessionIndex]?.fuzzingHistory[historyIndex];
        if (!history) return;

        const targets = history.requests
            .filter((r) => r.workerId === workerId && (r.status === 'error' || r.connectionDropped || r.status === 'cancelled'))
            .map((r) => ({ id: r.fuzzRequestId, request: r.rawRequest }))
            .filter((t) => t.request);

        if (targets.length === 0) return;

        dispatch(markWorkerRequestsPending({ sessionIndex, historyIndex, workerId }));

        try {
            await invoke('resend_worker_fuzz_requests', {
                url: targetUrl,
                targets,
                selectedSession: sessionIndex,
                fuzzHistory: historyIndex,
                workerId,
                delayMs,
            });
        } catch (err) {
            console.error(`Failed to resend requests for worker ${workerId}:`, err);
        }
    };

    if (runState.status === 'idle' && runState.total === 0) {
        return null;
    }

    return (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-[#5C6360]">
                                {statusLabel[runState.status]}
                                {runState.total > 0 && (
                                    <span className="ml-2 tabular-nums text-[#9A9A90]">
                                        {runState.completed} / {runState.total} ({percent}%)
                                    </span>
                                )}
                            </span>
                        </div>

                        {runState.connectionDropped && (
                            <span className="flex items-center gap-1 rounded bg-[#F4E4DE] px-1.5 py-0.5 text-[10px] font-semibold text-[#C0392B]">
                                <WifiOff className="size-3" />
                                {droppedWorkersCount > 0
                                    ? `${droppedWorkersCount} Thread(s) Connection Dropped`
                                    : 'Connection dropped'}
                            </span>
                        )}
                    </div>
                    <Progress value={percent} className="h-1.5 bg-[#E7EFEA]" />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {/* Threads / Tasks Dropdown Menu */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={`h-7 gap-1.5 text-[11px] font-medium ${
                                    droppedWorkersCount > 0
                                        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                                        : 'border-border bg-background'
                                }`}
                            >
                                <Cpu className="size-3.5" />
                                <span>Threads ({workers.length || numThreads})</span>
                                {droppedWorkersCount > 0 && (
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                                        {droppedWorkersCount}
                                    </span>
                                )}
                                <ChevronDown className="size-3 opacity-60" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 p-2">
                            <DropdownMenuLabel className="flex items-center justify-between text-xs font-semibold">
                                <span className="flex items-center gap-1.5">
                                    <Activity className="size-3.5 text-muted-foreground" />
                                    Active Worker Threads
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                    {workers.length} {workers.length === 1 ? 'task' : 'tasks'} configured
                                </span>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />

                            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto py-1">
                                {workers.length === 0 ? (
                                    <div className="p-2 text-center text-xs text-muted-foreground">
                                        No thread telemetry available yet.
                                    </div>
                                ) : (
                                    workers.map((worker: FuzzWorkerState) => {
                                        const workerPercent = worker.total > 0
                                            ? Math.round((worker.completed / worker.total) * 100)
                                            : 0;
                                        const isWorkerDropped = worker.status === 'dropped';
                                        return (
                                            <div
                                                key={worker.workerId}
                                                className={`flex flex-col gap-1 rounded-md border p-2 text-xs transition-colors ${
                                                    isWorkerDropped
                                                        ? 'border-red-200 bg-red-50/50'
                                                        : 'border-border/50 bg-card'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-semibold">
                                                        Thread #{worker.workerId + 1}
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                                                worker.status === 'running'
                                                                    ? 'bg-blue-100 text-blue-800'
                                                                    : worker.status === 'completed'
                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                    : worker.status === 'dropped'
                                                                    ? 'bg-red-100 text-red-800 font-semibold'
                                                                    : 'bg-gray-100 text-gray-700'
                                                            }`}
                                                        >
                                                            {worker.status === 'dropped' ? 'Connection Dropped' : worker.status}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                    <span>Progress:</span>
                                                    <span>
                                                        {worker.completed} / {worker.total} ({workerPercent}%)
                                                    </span>
                                                </div>

                                                <Progress value={workerPercent} className="h-1 bg-muted" />

                                                {isWorkerDropped && (
                                                    <div className="mt-1 flex flex-col gap-1">
                                                        {worker.errorMessage && (
                                                            <p className="line-clamp-2 text-[10px] font-mono text-red-600">
                                                                {worker.errorMessage}
                                                            </p>
                                                        )}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleResendWorker(worker.workerId)}
                                                            className="h-6 w-full gap-1 border-red-300 bg-white text-[10px] text-red-700 hover:bg-red-50"
                                                        >
                                                            <RotateCcw className="size-2.5" />
                                                            Resend Thread #{worker.workerId + 1}
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {droppedWorkersCount > 0 && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={handleResendAllFailed}
                                        className="cursor-pointer gap-1.5 text-xs text-red-700 focus:bg-red-50 focus:text-red-800"
                                    >
                                        <RotateCcw className="size-3.5" />
                                        <span>Resend All Failed Threads ({failedCount})</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {isRunning && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancel}
                            className="h-7 gap-1 border-[#F4E4DE] text-[#C0392B] hover:bg-[#F4E4DE]/50"
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
) {
    dispatch(markRequestPending({ sessionIndex, historyIndex, requestId }));

    await invoke('resend_fuzz_request', {
        url: targetUrl,
        target: { id: requestId, request: rawRequest },
        selectedSession: sessionIndex,
        fuzzHistory: historyIndex,
    });
}
