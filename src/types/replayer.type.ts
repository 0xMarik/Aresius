
export interface ReplayerHistoryItem {
    requestTime: number;
    requestRaw: string
    responseRaw: string;   
}

export interface ReplayerSession {
    history: ReplayerHistoryItem[];
    requestTmp: string;
    url: string;
    urlIsValid: boolean;
    selectedHistoryIndex: number | null;
}
export interface ReplayerCollection {
    sessions: ReplayerSession[];
    selectedSessionIndex: number | null,
}