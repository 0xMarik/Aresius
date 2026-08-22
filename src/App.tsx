import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { listen } from "@tauri-apps/api/event";
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
} from "./store/slices/appStateSlice";

const Projects = lazy(() => import("./pages/projects.page"));
const SitemapTree = lazy(() => import("./pages/sitemap/Sitemap"));
const ScopeManager = lazy(() => import("./pages/scope/ScopeManager"));
const Interceptor = lazy(() => import("./pages/interceptor/Interceptor.page"));
const Replayer = lazy(() => import("./pages/replayer/replayer"));
const HTTPHisotry = lazy(() => import("./pages/HttpHistory"));
const Fuzzer = lazy(() => import("./pages/fuzzer/fuzzer"));
const MatchAndReplace = lazy(() => import("./pages/match-replace/MatchAndReplace.page"));
const FiltersPage = lazy(() => import("./pages/filters/Filters.page"));

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

            // 2. Load persisted app state
            let saved: AppState | null = null;
            try {
                saved = await invoke<AppState>("get_app_state");
                dispatch(hydrateAppState(saved));
            } catch (err) {
                console.warn("Failed to load app state:", err);
            }

            // 3. Restore active project (if the file still exists on disk)
            if (saved?.activeProjectId) {
                const projectStillExists = projects.some(p => p.id === saved!.activeProjectId && p.exists !== false);
                if (projectStillExists) {
                    try {
                        const updated = await invoke<Project>("select_project", { id: saved.activeProjectId });
                        dispatch(setcurrentProjectId(saved.activeProjectId));
                        dispatch(updateProject(updated));

                        // Pre-load ancillary data
                        try {
                            const summaries = await invoke<HttpHistorySummaryRow[]>(
                                "get_http_history_summaries", { projectId: saved.activeProjectId }
                            );
                            dispatch(setSiteMapBulk({ items: summaries, projectId: saved.activeProjectId }));
                        } catch { /* best-effort */ }

                        try { dispatch(fetchScopeDataForProject(saved.activeProjectId) as any); } catch { }
                        try { dispatch(fetchSitemapStateForProject(saved.activeProjectId) as any); } catch { }
                        try { dispatch(fetchMatchReplaceDataForProject(saved.activeProjectId) as any); } catch { }
                    } catch (err) {
                        // File missing or corrupt — silently clear the saved project id
                        console.warn("Could not restore last active project:", err);
                        persistAppState({
                            sidebarCollapsed: saved.sidebarCollapsed,
                            activeProjectId: null,
                            lastPage: saved.lastPage,
                        });
                    }
                }
            }

            // 4. Navigate to last page
            if (saved?.lastPage && saved.lastPage !== "/") {
                navigate(saved.lastPage, { replace: true });
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

    // ------------------------------------------------------------------
    // Sidebar toggle handler
    // ------------------------------------------------------------------
    const handleSidebarOpenChange = (open: boolean) => {
        const collapsed = !open;
        dispatch(setSidebarCollapsed(collapsed));
        schedulePersist({ sidebarCollapsed: collapsed });
    };

    return (
        <div className="flex flex-col h-screen h-full [&_*]:text-[12px] w-full overflow-hidden">
            <MenubarDemo />
            <div className="flex-1 min-h-0 relative">
                <SidebarProvider
                    className="h-full min-h-0"
                    style={{
                        "--sidebar-width": "10rem",
                        "--sidebar-width-icon": "3rem",
                    } as React.CSSProperties}
                    open={!sidebarCollapsed}
                    onOpenChange={handleSidebarOpenChange}
                >
                    <AppSidebar />
                    <SidebarInset className="min-h-0 overflow-auto flex flex-col">
                        <Suspense fallback={null}>
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
                            </Routes>
                        </Suspense>
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
