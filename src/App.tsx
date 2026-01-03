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
// import Header from "./components/header.component";



export default function App() {
    return (
        <Router>
            <div className="">
                <SidebarProvider >
                    <AppSidebar />
                    <SidebarInset >
                        {/* <Header /> */}

                        <Routes>
                            <Route path="/replayer" element={<Tweaker />} />
                            <Route path="/fuzzer/*" element={<Fuzzer />} />
                            <Route path="/projects" element={<Projects />} />
                        </Routes>

                    </SidebarInset>
                </SidebarProvider>
            </div>
        </Router>
    )
}
