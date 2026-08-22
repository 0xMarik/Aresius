export interface ProxySettings {
    host: string;
    port: number;
    autoFallbackPort: boolean;
    autoFallbackLoopback: boolean;
}

export interface ProxyStatus {
    isRunning: boolean;
    boundAddress: string | null;
    requestedAddress: string;
    fallbackApplied: boolean;
    lastError: string | null;
}
