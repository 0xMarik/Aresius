import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Fuzzer from "./pages/fuzzer/fuzzer";
import Tweaker from "./pages/replayer/replayer";
import Projects from "./pages/projects.page";
import HTTPHisotry from "./pages/HttpHistory";
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { addToHttpHistory } from "./store/slices/http-historySlice";
import Interceptor from "./pages/interceptor/Interceptor.page";
import { addInterceptedRequest } from "./store/slices/interceptorSlice";
import MenubarDemo from "./components/MenuBar";
import { applyFuzzUpdates } from "./store/slices/fuzzerSlice";
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
    | { Completed: { id: string; selectedSession: number, fuzzHistory: number, reqRes: ReqRes } }
    | { Error: { id: string; selectedSession: number, fuzzHistory: number, message: string } };




export default function App() {
    const dispatch = useDispatch();

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
        const setupListener = async () => {
            const unlisten = await listen("intercept_request", (event) => {
                dispatch(addInterceptedRequest({ interceptedRequest: event.payload as any }))
            })

            return unlisten;
        }

        const unlistenPromise = setupListener();
        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [dispatch])

    useEffect(() => {
        const unlisten = listen<FuzzUpdate[]>("fuzz-update-batch", (event) => {
            const resultArr = event.payload;
            console.warn("HERE FUZZ UPDATE !! : ", resultArr);
            dispatch(applyFuzzUpdates({ updates: resultArr }))
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, []);

    return (
        <Router>
            <div className="flex flex-col h-svh [&_*]:text-[12px] w-full">
                <div className="h-10 shrink-0 relative">
                    <MenubarDemo />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                    {/* <Headers/> */}
                    <SidebarProvider className="h-full" style={{
                        "--sidebar-width": "13rem",
                        "--sidebar-width-icon": "3rem",
                    } as React.CSSProperties} >
                        <AppSidebar />
                        <SidebarInset >

                            <Routes>
                                <Route path="/site-map" element={<SitemapTree />} />
                                <Route path="/interceptor" element={<Interceptor />} />
                                <Route path="/replayer" element={<Tweaker />} />
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
