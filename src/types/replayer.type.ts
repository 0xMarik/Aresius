export interface ReplayerHistoryItem {
    id?: string;
    requestTime?: number;
    responseTime?: number;
    requestRaw: string;
    responseRaw: string;
    baseUrl?: string;
    createdAt?: string;
    status?: string;
    errorMessage?: string | null;
}

export interface ReplayerSession {
    id?: string;
    name?: string;
    history: ReplayerHistoryItem[];
    requestTmp: string;
    url: string;
    urlIsValid: boolean;
    selectedHistoryIndex: number | null;
}

export interface ReplayerCollection {
    id?: string;
    name?: string;
    isExpanded?: boolean;
    sessions: ReplayerSession[];
    selectedSessionIndex: number | null;
}

export interface ReplayerFullData {
    collections: Array<{
        id: string;
        name: string;
        isExpanded?: boolean;
        sessions: Array<{
            id: string;
            name: string;
            url: string;
            requestTmp: string;
            history: Array<{
                id: string;
                requestRaw: string;
                responseRaw: string;
                responseTime: number;
                createdAt: string;
                status?: string;
                errorMessage?: string | null;
                baseUrl?: string;
            }>;
            selectedHistoryIndex?: number | null;
            urlIsValid: boolean;
        }>;
        selectedSessionIndex?: number | null;
    }>;
    selectedCollectionIndex?: number;
    expandedIds?: string[];
}