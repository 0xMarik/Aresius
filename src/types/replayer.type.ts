
interface ReplayerHistoryItem {
    time: number;
    requestRaw: string
    responseRaw: string;   
}

interface ReplayerSession {
    history: ReplayerHistoryItem[];
    requestTmp: string;
    url: string;
}
export interface ReplayerCollection {
    sessions: ReplayerSession[];
    selectedSessionIndex: 0,
}