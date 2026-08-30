export interface AppState {
    sidebarCollapsed: boolean;
    activeProjectId: string | null;
    lastPage: string;
    fontSizeScale?: number;
}

export interface ProxySettings {
    host: string;
    port: number;
    autoFallbackPort: boolean;
    autoFallbackLoopback: boolean;
}

export interface FuzzerSettings {
    showUncompletedRequests: boolean;
}

export interface ExportedSettingsBundle {
    proxy: ProxySettings;
    fuzzer: FuzzerSettings;
}

export const defaultAppState: AppState = {
    sidebarCollapsed: false,
    activeProjectId: null,
    lastPage: '/projects',
    fontSizeScale: 1.0,
};

export const defaultProxySettings: ProxySettings = {
    host: '127.0.0.1',
    port: 8080,
    autoFallbackPort: true,
    autoFallbackLoopback: true,
};

export const defaultFuzzerSettings: FuzzerSettings = {
    showUncompletedRequests: false,
};
