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




export interface FuzzerHistory {
    date: number,
    requests: FuzzerRequest[];
}

export interface FuzzerSession{
    name: string;
    fuzzingHistory: FuzzerHistory[];
    payload: FuzzerPayload;
    // active: boolean
}

export interface FuzzerParameter 
{
  name: string; // NAME in {{NAME}}
  replacedValue: string, // the original value before replaced by the place holder
  payloadSource: PayloadSource; // options of thr source of wordlist
  values: string[]; // the world list
}

export interface FuzzerPayload {
    rawRequest: string;
    parameters: FuzzerParameter[],
    metadata: {
        // protocol: 'http' | 'websocket' | 'grpc'; // Request type
        targetUrl: string; // Moved from parameter level /// RFC 3986 | ex: http://example.com:80
    };
}

export interface FuzzerState {
  fuzzerSessions: FuzzerSession[];
  activeSessionIndex: number | null;
};

export type PayloadSource = 
  | 'library' // Predefined payload library
  | 'file' 
  | 'generator'
  | 'manual';

interface FuzzerResult {
    rawResponse: string;
    ResponseTime: number; // miliseconds
}