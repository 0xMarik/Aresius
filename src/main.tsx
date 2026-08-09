import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { Provider } from "react-redux";
import store from "./store/index.ts";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner.tsx";

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

