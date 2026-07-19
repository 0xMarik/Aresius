interface FuzzerResponse {
    rawResponse: string;
    responseTime: number;
}

export interface FuzzerRequest {
    targetUrl: string;
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
    id: string; // still don't know why I put the Id here and not in the FuzzerParameter
    from: number;
    to: number;
    originalText: string;
    isActive: boolean;
}

export interface FuzzerParameter {
    // id: string; // New: unique identifier for each parameter
    // name: string; // e.g., 'FUZZ_1', 'FUZZ_2'
    payloadSource: 'manual' | 'wordlist' | 'generator';
    // replacedValue: string; // The original text that was replaced
    values: string[];
    highlightRange: HighlightRange; // Links to the corresponding highlight range
}


interface FuzzConfig {
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
