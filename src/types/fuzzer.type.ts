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

interface FuzzingHistory {
    id: string,
    date: number,
    requests: FuzzerRequest[];
}

export interface FuzzerSession{
    sessionId: string;
    name: string;
    fuzzingHistory: FuzzingHistory[];
}

