
export interface ReplayerHistoryItem {
    requestTime: number;
    requestRaw: string
    responseRaw: string;   
}

interface ReplayerSession {
    history: ReplayerHistoryItem[];
    requestTmp: string;
    url: string;
    selectedHistoryIndex: number | null;
}
export interface ReplayerCollection {
    sessions: ReplayerSession[];
    selectedSessionIndex: number,
}