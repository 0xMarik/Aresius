interface FuzzerResponse {
    rawResponse: string;
    responseTime: number;
}

export interface FuzzerRequest {
    fuzzRequestId: string;
    rawRequest: string;
    response: FuzzerResponse | null;
    requestDate: string;
    status: 'pending' | 'completed' | 'error';
}

// Fuzzing attack types
export enum FuzzingAttackType {
  ROTATOR = 'rotator',           // Single payload set, iterates through one position at a time
  ECHO = 'echo', // Single payload set, same value in all positions
  ZIPPED = 'zipped',     // Multiple payload sets, parallel iteration
  COMBINATORIAL = 'combinatorial' // Multiple payload sets, all combinations
}



export type PayloadSource = 
  | 'library' // Predefined payload library
  | 'file' 
  | 'generator'
  | 'manual';



export interface HighlightRange {
    from: number; // just for front end presentation ignore \r
    to: number;
    byteFrom: number;
    byteTo: number; // taking into consideration \r
    originalText: string;
    isActive: boolean;
    id: string;
}

export interface FuzzerParameter {
    // id: string; // New: unique identifier for each parameter
    // name: string; // e.g., 'FUZZ_1', 'FUZZ_2'
    payloadSource: 'manual' | 'wordlist' | 'generator';
    // replacedValue: string; // The original text that was replaced
    values: string[];
    highlightRange: HighlightRange; // Links to the corresponding highlight range
}


export interface FuzzConfig {
    rawRequest: string;
    parameters: FuzzerParameter[];
    fuzzingAttackType: FuzzingAttackType;
    numThreads: number;
    delayMs: number;
    metadata: {
        targetUrl: string;
    };
}

export interface FuzzingHistory {
    date: string;
    requests: FuzzerRequest[]; // Your existing request type
    fuzzConfigSnapshot: FuzzConfig
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
    activeSessionIndex: number | null;
}
