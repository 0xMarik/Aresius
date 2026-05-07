import "./App.css";
import { AppSidebar } from "@/components/app-sidebar"

import {
    SidebarInset,
    SidebarProvider,

} from "@/components/ui/sidebar"

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Fuzzer from "./pages/fuzzer";
import Tweaker from "./pages/replayer/replayer";
import Projects from "./pages/projects.page";
import HTTPHisotry from "./pages/http-history.page";
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { addToHttpHistory } from "./store/slices/http-historySlice";
import Interceptor from "./pages/interceptor/Interceptor.page";
import { addInterceptedRequest } from "./store/slices/interceptorSlice";



export default function App() {
    const dispatch = useDispatch();

    useEffect(() => {
        // Listen for HTTP requests from Rust
        const setupListener = async () => {
            const unlisten = await listen('http_history', (event) => {
                console.log("listenner: ", event.payload)
                dispatch(addToHttpHistory({ historyItem: event.payload as any }));
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
                console.log({ payload: event.payload })
                dispatch(addInterceptedRequest({ interceptedRequest: event.payload as any }))
            })

            return unlisten;
        }

        const unlistenPromise = setupListener();
        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, [])

    return (
        <Router>
            <div className="h-screen">
                <SidebarProvider >
                    <AppSidebar />
                    <SidebarInset >
                        {/* <Header /> */}

                        <Routes>
                            <Route path="/interceptor" element={<Interceptor />} />
                            <Route path="/replayer" element={<Tweaker />} />
                            <Route path="/http-history" element={<HTTPHisotry />} />
                            <Route path="/fuzzer/*" element={<Fuzzer />} />
                            <Route path="/projects" element={<Projects />} />
                        </Routes>

                    </SidebarInset>
                </SidebarProvider>
            </div>
        </Router>
    )
}
