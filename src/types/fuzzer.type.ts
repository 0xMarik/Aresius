interface FuzzerResponse {
    id: string;
    response: string;
    responseTime: number;
}

interface FuzzerRequest {
    id : string;
    url: string;
    request: string;
    response: FuzzerResponse | null;
}

export interface FuzzerHistory {
    id: string,
    date: number,
    requests: FuzzerRequest[];
}

export interface FuzzerSession{
    sessionId: string;
    name: string;
    fuzzingHistory: FuzzerHistory[];
}

export interface FuzzerState {
  fuzzerSessions: FuzzerSession[];
  activeSessionId: string | null;
};

