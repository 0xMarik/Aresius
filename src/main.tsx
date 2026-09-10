import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { Provider } from "react-redux";
import store from "./store/index.ts";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner.tsx";

// Safeguard against React 19 resource timing crash when entries are sparse
if (typeof window !== "undefined" && window.performance && typeof window.performance.getEntriesByType === "function") {
  const originalGetEntriesByType = window.performance.getEntriesByType.bind(window.performance);
  window.performance.getEntriesByType = function (type: string) {
    const entries = originalGetEntriesByType(type);
    if (type === "resource" && Array.isArray(entries)) {
      return entries.filter((entry) => entry != null && typeof (entry as any).startTime === "number");
    }
    return entries;
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // <React.StrictMode>
  <Provider store={store}>
    <ThemeProvider defaultTheme="dark" storageKey="aresius-ui-theme">
      <App />
      <Toaster />
    </ThemeProvider>
  </Provider>
  // </React.StrictMode>
);

