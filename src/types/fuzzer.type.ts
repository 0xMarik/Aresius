interface FuzzerResponse {
    response: string;
    responseTime: number;
}

export interface FuzzerRequest {
    targetUrl: string;
    request: string;
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


// ********************************************** //

// const request : FuzzerRequest = {
//     targetUrl: 'google.com',
//     request: 'GET / HTTP/1.1',
//     response: {
//         response: 'HTTP 200 OK',
//         responseTime: 0
//     },
//     requestDate: new Date().toISOString(),
//     status: 'pending' // | 'completed' | 'error'
// } 

// ********************************************** //

// export interface FuzzerHistory {
//     date: Date,
//     requests: FuzzerRequest[];
// }

// export interface FuzzerSession{
//     name: string;
//     fuzzingHistory: FuzzerHistory[];
//     payload: FuzzerPayload;
//     // active: boolean
// }


// export interface FuzzerState {
//   fuzzerSessions: FuzzerSession[];
//   activeSessionIndex: number | null;
// };

export type PayloadSource = 
  | 'library' // Predefined payload library
  | 'file' 
  | 'generator'
  | 'manual';

// interface FuzzerResult {
//     rawResponse: string;
//     ResponseTime: number; // miliseconds
// }



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


interface SessionPayload {
    rawRequest: string;
    parameters: FuzzerParameter[];
    fuzzingAttackType: FuzzingAttackType;
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
    payload: SessionPayload;
    selectedHighlightId: string | null;
}

export interface FuzzerState {
    fuzzerSessions: FuzzerSession[];
    activeSessionIndex: number | null;
}

// *********************************************** //


// const fuzzerState: FuzzerState = {
//     fuzzerSessions: [{
//         fuzzingHistory: [],
//         name: 'Default Session',
//         payload: {
//             rawRequest: 'GET / HTTP/1.1\nHost: {{targetUrl}}\n\n',
//             parameters: [{
//                 highlightRange: {
//                 id: 'range-1',
//                 from: 0,
//                 to: 0,
//                 originalText: '',
//                 isActive: false
//             }, // Default highlight range ID
//                 id: 'param-1',
//                 name: 'FUZZ_1',
//                 payloadSource: 'manual',
//                 replacedValue: '',
//                 values: ['/page', '/', '/home', '/about', '/contact', '/products', '/services', '/blog', '/faq', '/terms', '/privacy', '/help', '/support', '/login', '/register', '/dashboard', '/profile', ]
//             }],
//             metadata: {
//                 targetUrl: 'http://example.com:80'
//             }
//         }
//     }],
//     activeSessionIndex: 0,
//     selectedHighlightId: "range-1",
// };

// *********************************************** //