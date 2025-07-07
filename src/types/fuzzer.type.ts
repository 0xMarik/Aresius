interface FuzzerResponse {
    response: string;
    responseTime: number;
}

interface FuzzerRequest {
    url: string;
    request: string;
    response: FuzzerResponse | null;
    requestDate: string;
}

export interface FuzzerHistory {
    date: number,
    requests: FuzzerRequest[];
}

export interface FuzzerSession{
    name: string;
    fuzzingHistory: FuzzerHistory[];
    // active: boolean
}

export interface FuzzerState {
  fuzzerSessions: FuzzerSession[];
  activeSessionIndex: number | null;
};

