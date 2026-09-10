import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { addToHttpHistory } from "./store/slices/http-historySlice";
import { useInterceptPoller } from "./hooks/useInterceptPoller";
import MenubarDemo from "./components/MenuBar";
import { updateFuzzProgress } from "./store/slices/fuzzerSlice";
import { updateSiteMap } from "./store/slices/sitemapSlice";
import { HttpHistory } from "./types/http.type";
import { AppState, Project } from "./types/project.type";
import { invoke } from "@tauri-apps/api/core";
import { setProjects, setcurrentProjectId, updateProject } from "./store/slices/projectSlice";
import { setSiteMapBulk, fetchSitemapStateForProject } from "./store/slices/sitemapSlice";
import { fetchScopeDataForProject } from "./store/slices/scopeSlice";
import { fetchMatchReplaceDataForProject } from "./store/slices/matchReplaceSlice";
import { HttpHistorySummaryRow } from "./types/http.type";
import store, { RootState } from "./store";
import {
    hydrateAppState,
    persistAppState,
    setLastPage,
    setSidebarCollapsed,
    setFuzzerSettings,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
} from "./store/slices/appStateSlice";
import { FuzzerSettings } from "./types/fuzzerSettings.type";

import Projects from "./pages/projects.page";
import SitemapTree from "./pages/sitemap/Sitemap";
import ScopeManager from "./pages/scope/ScopeManager";
import Interceptor from "./pages/interceptor/Interceptor.page";
import Replayer from "./pages/replayer/replayer";
import HTTPHisotry from "./pages/HttpHistory";
import Fuzzer from "./pages/fuzzer/fuzzer";
import MatchAndReplace from "./pages/match-replace/MatchAndReplace.page";
import FiltersPage from "./pages/filters/Filters.page";
import SettingsPage from "./pages/settings/Settings.page";
import FilesPage from "./pages/files/Files.page";

interface ReqRes {
    request: string;
    response: string;
    responseTime: number;
}

// Externally-tagged: variant name is the object's single key
export type FuzzUpdate =
    | { Completed: { id: string; selectedSession: number; fuzzHistory: number; reqRes: ReqRes } }
    | { Error: { id: string; selectedSession: number; fuzzHistory: number; message: string; connectionDropped?: boolean; request?: string } };

export type FuzzProgressUpdate = {
    selectedSession: number;
    fuzzHistory: number;
    completed: number;
    total: number;
    failed?: number;
    status: 'running' | 'completed' | 'cancelled' | 'connection_dropped';
    connectionDropped: boolean;
};

// ---------------------------------------------------------------------------
// Inner component — needs access to router hooks (useLocation / useNavigate)
// ---------------------------------------------------------------------------

function AppInner() {
    const dispatch = useDispatch();
    const sidebarCollapsed = useSelector((s: RootState) => s.appState.sidebarCollapsed);
    const location = useLocation();
    const navigate = useNavigate();
    useInterceptPoller();

    // Debounce ref to avoid flooding the DB on every keystroke / re-render
    const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const schedulePersist = (partial?: Partial<AppState>) => {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            const s = store.getState();
            persistAppState({
                sidebarCollapsed: s.appState.sidebarCollapsed,
                activeProjectId: s.workspacestate.currentProjectId,
                lastPage: s.appState.lastPage,
                fontSizeScale: s.appState.fontSizeScale,
                showSplashscreen: s.appState.showSplashscreen ?? true,
                startupProjectMode: s.appState.startupProjectMode ?? 'last_used',
                startupProjectSpecificId: s.appState.startupProjectSpecificId ?? null,
                ...partial,
            });
        }, 400);
    };

    // ------------------------------------------------------------------
    // Persist last page whenever the route changes
    // ------------------------------------------------------------------
    useEffect(() => {
        dispatch(setLastPage(location.pathname));
        schedulePersist({ lastPage: location.pathname });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // ------------------------------------------------------------------
    // Mount: load projects + hydrate app state, then restore session
    // ------------------------------------------------------------------
    useEffect(() => {
        const bootstrap = async () => {
            // 1. Load all projects
            let projects: Project[] = [];
            try {
                const raw = await invoke<Project[]>("list_projects");
                projects = raw.map(p => ({ ...p, description: p.description ?? "", temporary: p.temporary ?? false }));
                dispatch(setProjects(projects));
            } catch (err) {
                console.error("Failed to load projects:", err);
            }

            // 2. Load persisted app state & fuzzer settings
            let saved: AppState | null = null;
            try {
                saved = await invoke<AppState>("get_app_state");
                dispatch(hydrateAppState(saved));
            } catch (err) {
                console.warn("Failed to load app state:", err);
            }

            try {
                const fuzzerSettings = await invoke<FuzzerSettings>("get_fuzzer_settings_db");
                if (fuzzerSettings) {
                    dispatch(setFuzzerSettings(fuzzerSettings));
                }
            } catch (err) {
                console.warn("Failed to load fuzzer settings:", err);
            }

            // 3. Restore active project based on startup preferences
            const startupMode = saved?.startupProjectMode ?? 'last_used';
            let targetProjectId: string | null = null;

            if (startupMode === 'last_used') {
                targetProjectId = saved?.activeProjectId ?? null;
            } else if (startupMode === 'specific') {
                targetProjectId = saved?.startupProjectSpecificId ?? null;
            } else if (startupMode === 'none') {
                targetProjectId = null;
            }

            let projectRestored = false;

            if (targetProjectId) {
                const matchedProject = projects.find(p => p.id === targetProjectId);
                const projectStillExists = matchedProject && matchedProject.exists !== false;

                if (projectStillExists) {
                    try {
                        const updated = await invoke<Project>("select_project", { id: targetProjectId });
                        dispatch(setcurrentProjectId(targetProjectId));
                        dispatch(updateProject(updated));

                        // Pre-load ancillary data
                        try {
                            const summaries = await invoke<HttpHistorySummaryRow[]>(
                                "get_http_history_summaries", { projectId: targetProjectId }
                            );
                            dispatch(setSiteMapBulk({ items: summaries, projectId: targetProjectId }));
                        } catch { /* best-effort */ }

                        try { dispatch(fetchScopeDataForProject(targetProjectId) as any); } catch { }
                        try { dispatch(fetchSitemapStateForProject(targetProjectId) as any); } catch { }
                        try { dispatch(fetchMatchReplaceDataForProject(targetProjectId) as any); } catch { }
                        projectRestored = true;
                    } catch (err) {
                        console.warn("Could not restore startup project:", err);
                        projectRestored = false;
                    }
                }

                // If target project was specified but couldn't be opened (deleted from disk or corrupted)
                if (!projectRestored) {
                    if (startupMode === 'specific') {
                        toast.warning(
                            "Startup project could not be opened because the file was moved or deleted from disk. Redirected to projects.",
                            { id: "startup-project-missing", duration: 6000 }
                        );
                    } else if (startupMode === 'last_used' && saved) {
                        // Silently clear stale activeProjectId so next launch doesn't attempt to load ghost project
                        persistAppState({
                            sidebarCollapsed: saved.sidebarCollapsed,
                            activeProjectId: null,
                            lastPage: saved.lastPage,
                            fontSizeScale: saved.fontSizeScale,
                            showSplashscreen: saved.showSplashscreen ?? true,
                            startupProjectMode: saved.startupProjectMode ?? 'last_used',
                            startupProjectSpecificId: saved.startupProjectSpecificId ?? null,
                        });
                    }
                }
            }

            // 4. Navigate to last page or fallback to projects if no project restored
            const publicRoutes = ["/projects", "/settings", "/"];
            if (projectRestored && saved?.lastPage && saved.lastPage !== "/") {
                navigate(saved.lastPage, { replace: true });
            } else if (!projectRestored) {
                // If no project is active, only allow public routes (e.g. /settings), otherwise navigate to /projects
                if (saved?.lastPage && publicRoutes.includes(saved.lastPage) && saved.lastPage !== "/") {
                    navigate(saved.lastPage, { replace: true });
                } else {
                    navigate("/projects", { replace: true });
                }
            }
        };

        bootstrap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ------------------------------------------------------------------
    // Event listeners — HTTP history & fuzz progress
    // ------------------------------------------------------------------
    useEffect(() => {
        const setupListener = async () => {
            const unlisten = await listen('http_history', (event) => {
                const projectId = store.getState().workspacestate.currentProjectId;
                if (projectId) {
                    dispatch(addToHttpHistory({ historyItem: event.payload as HttpHistory, projectId }));
                    dispatch(updateSiteMap({ historyItem: event.payload as any, projectId }));
                }
            });
            return unlisten;
        };

        const unlistenPromise = setupListener();
        return () => { unlistenPromise.then(unlisten => unlisten()); };
    }, [dispatch]);

    useEffect(() => {
        const unlisten = listen<FuzzProgressUpdate>("fuzz-progress", (event) => {
            const projectId = store.getState().workspacestate.currentProjectId;
            if (projectId) {
                dispatch(updateFuzzProgress({ ...event.payload, projectId }));
            }
        });
        return () => { unlisten.then((f) => f()); };
    }, [dispatch]);

    useEffect(() => {
        const unlisten = listen<import("@/types/proxySettings.type").ProxyStatus>("proxy-status-changed", (event) => {
            const payload = event.payload;
            if (payload?.fallbackApplied && payload?.boundAddress) {
                toast.warning(`Proxy fallback applied: Listening on ${payload.boundAddress}`, {
                    description: `Requested address ${payload.requestedAddress} was busy or unavailable.`,
                });
            }
        });
        return () => { unlisten.then((f) => f()); };
    }, []);

    // ------------------------------------------------------------------
    // Global Keyboard Shortcuts (Zoom / Font Size)
    // ------------------------------------------------------------------
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isModifier = e.ctrlKey || e.metaKey;
            if (!isModifier) return;

            const isZoomIn =
                e.key === "=" ||
                e.key === "+" ||
                e.key === "Add" ||
                e.code === "Equal" ||
                e.code === "NumpadAdd";

            const isZoomOut =
                e.key === "-" ||
                e.key === "_" ||
                e.key === "Subtract" ||
                e.code === "Minus" ||
                e.code === "NumpadSubtract";

            const isZoomReset =
                e.key === "0" ||
                e.code === "Digit0" ||
                e.code === "Numpad0";

            if (isZoomIn) {
                e.preventDefault();
                e.stopPropagation();
                dispatch(increaseFontSize(0.05));
            } else if (isZoomOut) {
                e.preventDefault();
                e.stopPropagation();
                dispatch(decreaseFontSize(0.05));
            } else if (isZoomReset) {
                e.preventDefault();
                e.stopPropagation();
                dispatch(resetFontSize());
            }
        };

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    dispatch(increaseFontSize(0.05));
                } else if (e.deltaY > 0) {
                    dispatch(decreaseFontSize(0.05));
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        window.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            window.removeEventListener("keydown", handleKeyDown, { capture: true });
            window.removeEventListener("wheel", handleWheel);
        };
    }, [dispatch]);

    // ------------------------------------------------------------------
    // Sidebar toggle handler
    // ------------------------------------------------------------------
    const handleSidebarOpenChange = (open: boolean) => {
        const collapsed = !open;
        dispatch(setSidebarCollapsed(collapsed));
        schedulePersist({ sidebarCollapsed: collapsed });
    };

    return (
        <div className="flex flex-col h-screen w-full overflow-hidden">
            <MenubarDemo />
            <div className="flex-1 min-h-0 relative">
                <SidebarProvider
                    className="h-full min-h-0"
                    style={{
                        "--sidebar-width": "11rem",
                        "--sidebar-width-icon": "3rem",
                    } as React.CSSProperties}
                    open={!sidebarCollapsed}
                    onOpenChange={handleSidebarOpenChange}
                >
                    <AppSidebar />
                    <SidebarInset
                        className="min-h-0 overflow-auto flex flex-col"
                    >
                        <Routes>
                            <Route path="/" element={<Navigate to="/projects" replace />} />
                            <Route path="/projects" element={<Projects />} />
                            <Route path="/site-map" element={<SitemapTree />} />
                            <Route path="/scope" element={<ScopeManager />} />
                            <Route path="/interceptor" element={<Interceptor />} />
                            <Route path="/replayer" element={<Replayer />} />
                            <Route path="/http-history" element={<HTTPHisotry />} />
                            <Route path="/fuzzer" element={<Fuzzer />} />
                            <Route path="/match-replace" element={<MatchAndReplace />} />
                            <Route path="/filters" element={<FiltersPage />} />
                            <Route path="/files" element={<FilesPage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                        </Routes>
                    </SidebarInset>
                </SidebarProvider>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Root App — wraps with Router so useLocation is available in AppInner
// ---------------------------------------------------------------------------

export default function App() {
    return (
        <Router>
            <AppInner />
        </Router>
    );
}
