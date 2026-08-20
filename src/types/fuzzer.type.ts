interface FuzzerResponse {
    rawResponse: string;
    responseTime: number;
}

export type FuzzerRequestStatus = 'pending' | 'completed' | 'error' | 'cancelled';

export interface FuzzerRequest {
    id?: number;
    fuzzRequestId: string;
    rawRequest: string;
    payload?: string;
    response: FuzzerResponse | null;
    requestDate: string;
    status: FuzzerRequestStatus;
    errorMessage?: string;
    connectionDropped?: boolean;
    workerId?: number;
}

export type FuzzRunStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'connection_dropped';

export interface FuzzRunState {
    status: FuzzRunStatus;
    total: number;
    completed: number;
    failed: number;
    connectionDropped: boolean;
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
    failed: 0,
    connectionDropped: false,
    completedBase: 0,
});
