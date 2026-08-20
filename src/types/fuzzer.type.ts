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
  | 'manual'
  | 'numbers'
  | 'null_payload'
  | 'library'
  | 'file'
  | 'generator'
  | 'wordlist';

export interface HighlightRange {
    from: number;
    to: number;
    byteFrom: number;
    byteTo: number;
    originalText: string;
    isActive: boolean;
    id: string;
}

export type PreprocessingType =
    | 'modify_case'
    | 'encode'
    | 'decode'
    | 'prefix'
    | 'suffix'
    | 'match_replace';

export type CaseOption = 'lowercase' | 'uppercase';
export type EncodingOption = 'url_key' | 'url_all' | 'base64';
export type DecodingOption = 'url' | 'base64';

export interface PreprocessingRule {
    id: string;
    type: PreprocessingType;
    caseOption?: CaseOption;
    encodeOption?: EncodingOption;
    decodeOption?: DecodingOption;
    value?: string;
    pattern?: string;
    replacement?: string;
    isRegex?: boolean;
}

export type PipelineScope = 'all' | 'per_parameter';

export interface NumbersPayloadConfig {
    start: number;
    end: number;
    step: number;
    minIntegerDigits?: number;
    maxIntegerDigits?: number;
}

export interface NullPayloadConfig {
    count: number;
}

export interface FuzzerParameter {
    payloadSource: PayloadSource;
    values: string[];
    highlightRange: HighlightRange;
    pipelineRules?: PreprocessingRule[];
    numbersConfig?: NumbersPayloadConfig;
    nullPayloadConfig?: NullPayloadConfig;
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
    pipelineScope?: PipelineScope;
    pipelineRules?: PreprocessingRule[];
    setConnectionKeepAlive?: boolean;
    updateContentLength?: boolean;
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
