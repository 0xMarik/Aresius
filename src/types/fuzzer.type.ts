interface FuzzerResponse {
    rawResponse: string;
    responseTime: number;
}

export type FuzzerRequestStatus = 'pending' | 'completed' | 'error' | 'cancelled';

export interface FuzzerRequest {
    fuzzRequestId: string;
    rawRequest: string;
    response: FuzzerResponse | null;
    requestDate: string;
    status: FuzzerRequestStatus;
    errorMessage?: string;
    connectionDropped?: boolean;
    workerId?: number;
}

export type FuzzRunStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'connection_dropped';

export type FuzzWorkerStatus = 'pending' | 'connected' | 'running' | 'dropped' | 'completed';

export interface FuzzWorkerState {
    workerId: number;
    status: FuzzWorkerStatus;
    total: number;
    completed: number;
    errorMessage?: string;
}

export interface FuzzRunState {
    status: FuzzRunStatus;
    total: number;
    completed: number;
    connectionDropped: boolean;
    workers: FuzzWorkerState[];
    /** Offset of already-completed requests from a prior run, used during resend to avoid double-counting. */
    completedBase: number;
}

// Fuzzing attack types
export enum FuzzingAttackType {
  ROTATOR = 'rotator',
  ECHO = 'echo',
  ZIPPED = 'zipped',
  COMBINATORIAL = 'combinatorial'
}

export type PayloadSource =
  | 'library'
  | 'file'
  | 'generator'
  | 'manual';

export interface HighlightRange {
    from: number;
    to: number;
    byteFrom: number;
    byteTo: number;
    originalText: string;
    isActive: boolean;
    id: string;
}

export interface FuzzerParameter {
    payloadSource: 'manual' | 'wordlist' | 'generator';
    values: string[];
    highlightRange: HighlightRange;
}

export interface FuzzConfig {
    rawRequest: string;
    parameters: FuzzerParameter[];
    fuzzingAttackType: FuzzingAttackType;
    numThreads: number;
    delayMs: number;
    metadata: {
        targetUrl: string;
        urlIsValid: boolean;
    };
}

export interface FuzzingHistory {
    date: string;
    requests: FuzzerRequest[];
    fuzzConfigSnapshot: FuzzConfig;
    runState: FuzzRunState;
}

export interface FuzzerSession {
    name: string;
    fuzzingHistory: FuzzingHistory[];
    selectedHistoryIndex: number | null;
    fuzzConfig: FuzzConfig;
    selectedHighlightId: string | null;
}

export interface FuzzerState {
    fuzzerSessions: FuzzerSession[];
    receivedSession: number;
    activeSessionIndex: number | null;
    expandedIds: string[];
}

export const initialFuzzRunState = (): FuzzRunState => ({
    status: 'idle',
    total: 0,
    completed: 0,
    connectionDropped: false,
    workers: [],
    completedBase: 0,
});

/** Must match backend chunking: ceil(len / numThreads) per worker. */
export function assignWorkerIds<T extends { id: string }>(
    targets: T[],
    numThreads: number,
): (T & { workerId: number })[] {
    if (targets.length === 0) return [];
    const chunkSize = Math.max(1, Math.ceil(targets.length / Math.max(1, numThreads)));
    return targets.map((target, index) => ({
        ...target,
        workerId: Math.floor(index / chunkSize),
    }));
}

export function buildInitialWorkers(
    targets: { workerId: number }[],
): FuzzWorkerState[] {
    const byWorker = new Map<number, number>();
    for (const target of targets) {
        byWorker.set(target.workerId, (byWorker.get(target.workerId) ?? 0) + 1);
    }
    return [...byWorker.entries()]
        .sort(([a], [b]) => a - b)
        .map(([workerId, total]) => ({
            workerId,
            status: 'pending' as const,
            total,
            completed: 0,
        }));
}
