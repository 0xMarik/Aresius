import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Fuzzer from "./pages/fuzzer/fuzzer";
import Replayer from "./pages/replayer/replayer";
import Projects from "./pages/projects.page";
import HTTPHisotry from "./pages/HttpHistory";
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { addToHttpHistory } from "./store/slices/http-historySlice";
import Interceptor from "./pages/interceptor/Interceptor.page";
import { useInterceptPoller } from "./hooks/useInterceptPoller";
import MenubarDemo from "./components/MenuBar";
import { applyFuzzUpdates, updateFuzzProgress, updateFuzzWorkerProgress } from "./store/slices/fuzzerSlice";
import SitemapTree from "./pages/sitemap/Sitemap";
import { updateSiteMap } from "./store/slices/sitemapSlice";
import { HttpHistory } from "./types/http.type";

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




export default function App() {
    const dispatch = useDispatch();
    useInterceptPoller();

    useEffect(() => {
        // Listen for HTTP requests from Rust
        const setupListener = async () => {
            const unlisten = await listen('http_history', (event) => {
                dispatch(addToHttpHistory({ historyItem: event.payload as HttpHistory }));
                dispatch(updateSiteMap({ historyItem: event.payload as any }))
            });


            return unlisten;
        };

        const unlistenPromise = setupListener();

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [dispatch]);



    useEffect(() => {
        const unlisten = listen<FuzzUpdate[]>("fuzz-update-batch", (event) => {
            dispatch(applyFuzzUpdates({ updates: event.payload }))
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [dispatch]);

    useEffect(() => {
        const unlisten = listen<FuzzProgressUpdate>("fuzz-progress", (event) => {
            dispatch(updateFuzzProgress(event.payload));
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [dispatch]);

    useEffect(() => {
        const unlisten = listen<FuzzWorkerUpdate>("fuzz-worker-update", (event) => {
            dispatch(updateFuzzWorkerProgress(event.payload));
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [dispatch]);

    return (
        <Router>
            <div className="flex flex-col h-svh [&_*]:text-[12px] w-full overflow-hidden">
                <MenubarDemo />
                <div className="flex-1 min-h-0 relative">
                    {/* <Headers/> */}
                    <SidebarProvider className="h-full min-h-0" style={{
                        "--sidebar-width": "10rem",
                        "--sidebar-width-icon": "3rem",
                    } as React.CSSProperties} >
                        <AppSidebar />
                        <SidebarInset className="min-h-0 overflow-auto">
                            <Routes >
                                <Route path="/" element={<Navigate to="/projects" replace />} />
                                <Route path="/site-map" element={<SitemapTree />} />
                                <Route path="/scope" element={
                                    <div>Under Construction</div>
                                } />
                                <Route path="/interceptor" element={<Interceptor />} />
                                <Route path="/replayer" element={<Replayer />} />
                                <Route path="/http-history" element={<HTTPHisotry />} />
                                <Route path="/fuzzer" element={<Fuzzer />} />
                                <Route path="/projects" element={<Projects />} />
                            </Routes>

                        </SidebarInset>
                    </SidebarProvider>
                </div>
            </div>
        </Router >
    )
}
