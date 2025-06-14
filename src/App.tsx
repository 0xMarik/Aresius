// import { useState } from "react";
// import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { AppSidebar } from "./components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";

function App() {
  // const [greetMsg, setGreetMsg] = useState("");
  // const [name, setName] = useState("");

  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { name }));
  // }

  return (
    <main className="container">
      <SidebarProvider>
        <AppSidebar />
        <div>
          <SidebarTrigger />
        </div>
      </SidebarProvider>
    </main>
  );
}

export default App;
