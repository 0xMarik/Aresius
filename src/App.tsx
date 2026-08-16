import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from "react";
import { useDispatch } from "react-redux";
import { listen } from "@tauri-apps/api/event";
import { addToHttpHistory } from "./store/slices/http-historySlice";
import { useInterceptPoller } from "./hooks/useInterceptPoller";
import MenubarDemo from "./components/MenuBar";
import { updateFuzzProgress, updateFuzzWorkerProgress } from "./store/slices/fuzzerSlice";
import { updateSiteMap } from "./store/slices/sitemapSlice";
import { HttpHistory } from "./types/http.type";

const Projects = lazy(() => import("./pages/projects.page"));
const SitemapTree = lazy(() => import("./pages/sitemap/Sitemap"));
const ScopeManager = lazy(() => import("./pages/scope/ScopeManager"));
const Interceptor = lazy(() => import("./pages/interceptor/Interceptor.page"));
const Replayer = lazy(() => import("./pages/replayer/replayer"));
const HTTPHisotry = lazy(() => import("./pages/HttpHistory"));
const Fuzzer = lazy(() => import("./pages/fuzzer/fuzzer"));

import store from "./store";
import { invoke } from "@tauri-apps/api/core";
import { setProjects } from "./store/slices/projectSlice";

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
    status: 'running' | 'completed' | 'cancelled' | 'connection_dropped';
    connectionDropped: boolean;
};

export type FuzzWorkerUpdate = {
    selectedSession: number;
    fuzzHistory: number;
    workerId: number;
    status: 'pending' | 'connected' | 'running' | 'dropped' | 'completed';
    completed: number;
    total: number;
    message?: string;
};

type ProjectSummary = {
    id: string,
    name: string,
    path: string,
    createdAt: number,
    updatedAt: number,
    lastOpenedAt?: number | null,
}


export default function App() {
    const dispatch = useDispatch();
    useInterceptPoller();

    useEffect(() => {
        // Listen for HTTP requests from Rust
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

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [dispatch]);



    useEffect(() => {
        const unlisten = listen<FuzzProgressUpdate>("fuzz-progress", (event) => {
            const projectId = store.getState().workspacestate.currentProjectId;
            if (projectId) {
                dispatch(updateFuzzProgress({ ...event.payload, projectId }));
            }
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [dispatch]);

    useEffect(() => {
        const unlisten = listen<FuzzWorkerUpdate>("fuzz-worker-update", (event) => {
            const projectId = store.getState().workspacestate.currentProjectId;
            if (projectId) {
                dispatch(updateFuzzWorkerProgress({ ...event.payload, projectId }));
            }
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [dispatch]);

    useEffect(() => {
        invoke<ProjectSummary[]>("list_projects")
            .then((projects) => {
                dispatch(setProjects(projects.map(project => {
                    const projectSummary = {
                        description: "",
                        temporary: false,

                        ...project
                    }
                    return projectSummary;
                })))
            })
            .catch((err) => console.error("Failed to load projects:", err));
    }, [dispatch]);

    return (
        <Router>
            <div className="flex flex-col h-svh [&_*]:text-[12px] w-full overflow-hidden">
                <MenubarDemo />
                <div className="flex-1 min-h-0 relative">
                    <SidebarProvider className="h-full min-h-0" style={{
                        "--sidebar-width": "10rem",
                        "--sidebar-width-icon": "3rem",
                    } as React.CSSProperties} >
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
                                </Routes>
                            </Suspense>
                        </SidebarInset>
                    </SidebarProvider>
                </div>
            </div>
        </Router >
    )
}
