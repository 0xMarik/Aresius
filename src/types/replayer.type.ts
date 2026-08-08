
export interface ReplayerHistoryItem {
    requestTime: number;
    requestRaw: string
    responseRaw: string;
    baseUrl: string;
}

export interface ReplayerSession {
    name?: string;
    history: ReplayerHistoryItem[];
    requestTmp: string;
    url: string;
    urlIsValid: boolean;
    selectedHistoryIndex: number | null;
}
export interface ReplayerCollection {
    name?: string;
    sessions: ReplayerSession[];
    selectedSessionIndex: number | null;
}