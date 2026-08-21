import { useEffect, useState, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import "@/App.css";
import { invoke } from "@tauri-apps/api/core";

const APP_VERSION = "0.1.0";
const SPLASH_DURATION_MS = 5000;

function SplashScreen() {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("INITIALIZING CORE ENGINE...");
  const [isClosing, setIsClosing] = useState(false);
  const transitionTriggered = useRef(false);

  const navigateToMain = useCallback(async () => {
    if (transitionTriggered.current) return;
    transitionTriggered.current = true;
    setIsClosing(true);

    // Brief delay to allow smooth fade-out
    setTimeout(async () => {
      try {
        await invoke("close_splashscreen");
      } catch (err) {
        console.warn("Failed to close splashscreen via Tauri invoke:", err);
      }
    }, 150);
  }, []);

  useEffect(() => {
    const startTime = performance.now();
    let animFrameId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.round((elapsed / SPLASH_DURATION_MS) * 100));
      setProgress(pct);

      if (pct < 35) {
        setStatusText("INITIALIZING CORE ENGINE...");
      } else if (pct < 70) {
        setStatusText("LOADING SECURITY MODULES...");
      } else if (pct < 95) {
        setStatusText("PREPARING WORKSPACE...");
      } else {
        setStatusText("READY");
      }

      if (elapsed >= SPLASH_DURATION_MS) {
        navigateToMain();
      } else {
        animFrameId = requestAnimationFrame(tick);
      }
    };

    animFrameId = requestAnimationFrame(tick);

    // Optional click/key listener to skip quickly
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        navigateToMain();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [navigateToMain]);

  return (
    <div
      data-tauri-drag-region
      onClick={navigateToMain}
      className={`relative flex h-screen w-screen cursor-pointer select-none flex-col items-center justify-center overflow-hidden bg-transparent transition-all duration-300 ${isClosing ? "opacity-0 scale-95" : "opacity-100 scale-100"
        }`}
    >
      {/* Ambient background glow radiating from center behind character */}
      <div
        className="pointer-events-none absolute h-[400px] w-[540px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(168,38,44,0.35) 0%, rgba(220,38,38,0.15) 45%, transparent 70%)",
        }}
      />

      {/* Main Content Container */}
      <div
        data-tauri-drag-region
        className="relative flex flex-col items-center justify-center p-2 animate-in fade-in zoom-in-95 duration-500"
      >
        {/* Spartan Warrior / Ares Artwork Container */}
        <div className="relative flex items-center justify-center">
          <img
            src="/screensplash.png"
            alt="Aresius Warrior"
            draggable={false}
            className="w-[700px] max-w-[94vw] h-auto object-contain drop-shadow-[0_0_30px_rgba(225,29,72,0.45)] drop-shadow-[0_12px_24px_rgba(0,0,0,0.9)] filter"
          />

          {/* Cybernetic circuit subtle pulse overlay glow on center */}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-screen opacity-25 blur-sm"
            style={{
              background:
                "radial-gradient(circle at 50% 40%, rgba(255, 50, 50, 0.4) 0%, transparent 60%)",
            }}
          />

          {/* Branding & Status Info Layer - Positioned directly inside the bottom 1/3 black area */}
          <div
            data-tauri-drag-region
            className="absolute bottom-5 left-0 right-0 flex flex-col items-center justify-center gap-1.5 text-center"
          >
            {/* Logo Wordmark & Version */}
            <div className="flex items-center justify-center gap-3">
              <h1
                className="font-serif text-3xl font-extrabold tracking-[0.35em] text-[#f4efe6]"
                style={{
                  textShadow:
                    "0 0 20px rgba(225,29,72,0.7), 0 2px 6px rgba(0,0,0,0.95)",
                }}
              >
                ARESIUS
              </h1>
              <span className="rounded-full border border-[#8f2024]/70 bg-[#250d0f]/90 px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-[#fca5a5] shadow-[0_0_12px_rgba(168,38,44,0.5)] backdrop-blur-md">
                v{APP_VERSION}
              </span>
            </div>

            {/* Subtitle */}
            <p className="text-[10px] font-medium tracking-[0.24em] text-[#a89f91] uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              Next-Gen Security & Interception Engine
            </p>

            {/* Progress Bar Container */}
            <div className="mt-1 flex flex-col items-center gap-1.5">
              <div className="relative h-1.5 w-64 overflow-hidden rounded-full border border-[#451619]/90 bg-[#0d0507]/95 p-[1px] shadow-[0_0_14px_rgba(0,0,0,0.9)] backdrop-blur-sm">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#80181c] via-[#dc2626] to-[#f87171] shadow-[0_0_8px_#ef4444] transition-all duration-75 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Dynamic Status Text & Percentage */}
              <div className="flex w-64 items-center justify-between px-0.5 text-[9px] font-mono tracking-widest text-[#8a8078]">
                <span className="text-[#d49b9d]">{statusText}</span>
                <span className="text-[#a89f91]">{progress}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<SplashScreen />);
}
