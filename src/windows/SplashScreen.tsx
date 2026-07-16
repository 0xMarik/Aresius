import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

const STEPS = [
    "Initializing core engine…",
    "Loading interceptor modules…",
    "Preparing workspace…",
    "Starting proxy engine…",
    "Ready.",
];

// Window is exactly 820 x 380 — match tauri.conf.json
const W = 820;
const H = 380;

function SplashScreen() {
    const [stepIndex, setStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let i = 0;
        const tick = () => {
            if (i >= STEPS.length) return;
            setStepIndex(i);
            setProgress(Math.round(((i + 1) / STEPS.length) * 100));
            i++;
            if (i < STEPS.length) setTimeout(tick, 700);
        };
        setTimeout(tick, 300);
        if (i >= STEPS.length) {
            setTimeout(() => invoke("close_splashscreen"), 500);
        }
    }, []);

    return (
        <div style={{
            width: W,
            height: H,
            overflow: "hidden",
            background: "transparent",
            position: "relative",
            fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}>

            {/* ── Card (right side) ── */}
            <div style={{
                position: "absolute",
                left: 220,
                top: 20,
                width: W - 220 - 20,  // 580px
                height: H - 40,        // 340px
                background: "#171717",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                padding: "28px 32px 20px 112px",
            }}>

                {/* App name */}
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f0f0f0", letterSpacing: "0.02em" }}>
                    Aresius
                </p>
                <p style={{ margin: "3px 0 20px", fontSize: 10, color: "#4a4a4a", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Professional Interception Suite
                </p>

                {/* Meta row */}
                <div style={{ display: "flex", gap: 28, marginBottom: 20 }}>
                    {[["Version", "0.1.0"], ["Build", "2026.06"], ["Edition", "Standard"]].map(([label, value]) => (
                        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 10, color: "#3d3d3d", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                            <span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{value}</span>
                        </div>
                    ))}
                </div>

                <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 20 }} />

                {/* Description */}
                <p style={{ margin: "0 0 auto", fontSize: 12, color: "#444", lineHeight: 1.6 }}>
                    Advanced HTTP/S interception and fuzzing proxy built for security professionals.
                    Intercept, replay, and fuzz web traffic with precision.
                </p>

                {/* Status + progress */}
                <div style={{ marginTop: 24 }}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, color: "#555" }}>
                        {STEPS[stepIndex]}
                    </p>
                    <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                            height: "100%",
                            width: `${progress}%`,
                            background: "linear-gradient(90deg, #8b1a1a, #d63030)",
                            borderRadius: 2,
                            transition: "width 0.45s cubic-bezier(0.4,0,0.2,1)",
                        }} />
                    </div>
                </div>

                <p style={{ margin: "14px 0 0", fontSize: 10, color: "#2a2a2a" }}>
                    © 2026 Aresius. All rights reserved.
                </p>
            </div>

            {/* ── Warrior illustration — left, slightly overflows card left edge ── */}
            <img
                src="/ares_body.png"
                alt=""
                draggable={false}
                style={{
                    position: "absolute",
                    left: 80,           // bleeds slightly beyond window left → illusion of depth
                    top: H - 360,        // = 20px from top, feet at bottom (360px tall)
                    width: 223,
                    height: 360,
                    objectFit: "contain",
                    objectPosition: "bottom",
                    zIndex: 10,
                    pointerEvents: "none",
                    userSelect: "none",
                    filter: "drop-shadow(8px 0 24px rgba(0,0,0,0.7))",
                }}
            />

        </div>
    );
}


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <SplashScreen />
);