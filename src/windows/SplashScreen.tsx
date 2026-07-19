import ReactDOM from "react-dom/client";
import "../App.css";
import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus, RotateCw, X } from "lucide-react";
import aresiusMark from "/ares_body.png";

/**
 * AresLaunchScreen
 * ------------------------------------------------------------------
 * Root of the standalone launch window. Left pane is brand/version,
 * right pane is the instance list + "new instance" form — same split
 * as Caido's picker, restyled for Aresius.
 *
 * Flow on selecting an instance:
 *   1. invoke("start_proxy", { instanceId }) -> Rust backend
 *   2. row shows "Starting…" while we wait
 *   3. success -> invoke("open_main_window", { instanceId }), then this
 *      window closes (unless an onLaunched prop is passed, e.g. in tests)
 *   4. error -> inline message under that row, nothing else disabled
 *
 * Flow on adding an instance:
 *   1. "New instance" opens an inline form (name / host / port)
 *   2. invoke("create_instance", { name, host, port })
 *   3. success -> form closes, list refreshes
 *   4. error -> inline message in the form
 *
 * Requires: Tailwind, shadcn/ui Button + Input, lucide-react.
 * Fonts assumed available: Cinzel (wordmark), Inter (body), JetBrains Mono (addresses).
 */

const VERSION = "0.1.0"; // wire to your actual app version (e.g. via tauri app().getVersion())

interface ProxyInstance {
    id: string;
    name: string;
    host: string;
    port: number;
    status: "stopped" | "running";
}

interface InstanceForm {
    name: string;
    host: string;
    port: string;
}


export default function AresLaunchScreen() {
    const appWindowRef = useRef<TauriWindow | null>(null);
    if (!appWindowRef.current) appWindowRef.current = getCurrentWindow();
    const appWindow = appWindowRef.current;

    const [instances, setInstances] = useState<ProxyInstance[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [listError, setListError] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [rowError, setRowError] = useState<Record<string, string | null>>({});
    const [search, setSearch] = useState("");

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<InstanceForm>({ name: "", host: "127.0.0.1", port: "8080" });
    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const handleMinimize = () => appWindow.minimize();
    const handleClose = () => appWindow.close();

    const loadInstances = useCallback(async () => {
        setLoadingList(true);
        setListError(null);
        try {
            // const list = await invoke<ProxyInstance[]>("list_instances");
            const list: ProxyInstance[] = [{
                host: "127.0.0.1",
                id: "0",
                name: "Aresius Proxy",
                port: 8080,
                status: "stopped"
            }]
            setInstances(list ?? []);
        } catch (err) {
            setListError(typeof err === "string" ? err : "Couldn't reach the backend.");
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        loadInstances();
    }, [loadInstances]);

    const handleSelect = async (instance: ProxyInstance) => {
        if (pendingId) return;
        setPendingId(instance.id);
        setRowError((prev) => ({ ...prev, [instance.id]: null }));
        try {
            await invoke("close_splashscreen", { instanceId: instance.id });
            // if (onLaunched) {
            //     onLaunched(instance);
            // } else {
            //     await invoke("open_main_window", { instanceId: instance.id });
            //     await appWindow.close();
            // }
        } catch (err) {
            setRowError((prev) => ({
                ...prev,
                [instance.id]: typeof err === "string" ? err : "Failed to start the proxy.",
            }));
        } finally {
            setPendingId(null);
        }
    };

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (creating) return;
        setCreating(true);
        setFormError(null);
        try {
            await invoke("create_instance", {
                name: form.name.trim(),
                host: form.host.trim(),
                port: Number(form.port),
            });
            setForm({ name: "", host: "127.0.0.1", port: "8080" });
            setShowForm(false);
            await loadInstances();
        } catch (err) {
            setFormError(typeof err === "string" ? err : "Couldn't create the instance.");
        } finally {
            setCreating(false);
        }
    };

    const filtered = instances.filter((inst) =>
        `${inst.name} ${inst.host}:${inst.port}`.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0a0c] font-sans text-[#ede7df] rounded-xl">

            <div
                data-tauri-drag-region
                className="flex h-9 flex-shrink-0 items-center border-b border-[#2a2424] bg-[#121010] pl-3"
            >
                <span
                    data-tauri-drag-region
                    className="pointer-events-none flex-1 select-none font-serif text-[11px] tracking-[0.2em] text-[#8a8078]"
                >
                    ARESIUS
                </span>

                <div className="ml-auto flex items-center shrink-0">
                    <button
                        type="button"
                        aria-label="Minimize"
                        onClick={handleMinimize}
                        className="flex h-7 w-9 items-center justify-center rounded-sm text-[#8a8078] transition-colors hover:bg-[#1d1a1a] hover:text-[#ede7df]"
                    >
                        <Minus className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={handleClose}
                        className="flex h-7 w-9 items-center justify-center rounded-sm text-[#8a8078] transition-colors hover:bg-[#a8262c] hover:text-white"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            {/* ---------- LEFT: brand ---------- */}
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-[300px] flex-shrink-0 flex-col items-center justify-between border-r border-[#2a2424] bg-[#121010] px-8 py-12">
                    <div />
                    <div className="flex flex-col items-center gap-5">
                        <div
                            className="flex h-[150px] w-[150px] items-center justify-center rounded-full shadow-[0_0_0_1px_#2a2424,0_0_60px_-10px_rgba(168,38,44,0.55)]"
                            style={{
                                background:
                                    "radial-gradient(circle at 50% 50%, #a8262c 0%, #a8262c 46%, #c9a24b 47%, #c9a24b 53%, #000 54%, #000 60%, #c9a24b 61%, #c9a24b 64%, transparent 65%)",
                            }}
                        >
                            <img
                                src={aresiusMark}
                                alt=""
                                className="h-[82%] w-[82%] object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                            />
                        </div>
                        <h1 className="pl-[0.35em] font-serif text-2xl tracking-[0.35em] text-[#ede7df]">
                            ARESIUS
                        </h1>
                        <span className="text-xs tracking-wide text-[#8a8078]">Version {VERSION}</span>
                    </div>
                    <span className="text-[11px] text-[#5c5450]">© AsgardTech</span>
                </aside>

                {/* ---------- RIGHT: instances ---------- */}
                <main className="flex min-w-0 flex-1 flex-col px-10 py-10">
                    <header className="mb-6 flex items-center justify-between">
                        <h2 className="font-serif text-xl tracking-wide text-[#ede7df]">Instances</h2>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={loadInstances}
                                disabled={loadingList}
                                aria-label="Refresh"
                                className="h-8 w-8 text-[#8a8078] hover:bg-[#1d1a1a] hover:text-[#ede7df] disabled:opacity-40"
                            >
                                <RotateCw className={`h-4 w-4 ${loadingList ? "animate-spin" : ""}`} />
                            </Button>
                            <Button
                                onClick={() => setShowForm((v) => !v)}
                                className="gap-1.5 rounded-sm bg-[#a8262c] text-white hover:bg-[#8f2024]"
                            >
                                <Plus className="h-4 w-4" />
                                New instance
                            </Button>
                        </div>
                    </header>

                    <Input
                        placeholder="Search instances…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="mb-5 max-w-md rounded-sm border-[#2a2424] bg-[#161414] text-[#ede7df] placeholder:text-[#5c5450] focus-visible:ring-[#c9a24b]"
                    />

                    {showForm && (
                        <form
                            onSubmit={handleCreate}
                            className="mb-5 flex max-w-xl flex-col gap-3 rounded-sm border border-[#2a2424] bg-[#161414] p-4"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-[#ede7df]">New instance</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowForm(false)}
                                    className="h-6 w-6 text-[#8a8078] hover:bg-[#1d1a1a] hover:text-[#ede7df]"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>

                            <div className="flex gap-3">
                                <Input
                                    placeholder="Name"
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    required
                                    className="rounded-sm border-[#2a2424] bg-[#1d1a1a] text-[#ede7df] placeholder:text-[#5c5450] focus-visible:ring-[#c9a24b]"
                                />
                                <Input
                                    placeholder="Host"
                                    value={form.host}
                                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                                    required
                                    className="w-40 rounded-sm border-[#2a2424] bg-[#1d1a1a] font-mono text-[#ede7df] placeholder:text-[#5c5450] focus-visible:ring-[#c9a24b]"
                                />
                                <Input
                                    placeholder="Port"
                                    type="number"
                                    value={form.port}
                                    onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                                    required
                                    className="w-24 rounded-sm border-[#2a2424] bg-[#1d1a1a] font-mono text-[#ede7df] placeholder:text-[#5c5450] focus-visible:ring-[#c9a24b]"
                                />
                            </div>

                            {formError && <p className="text-xs text-[#e6a5a8]">{formError}</p>}

                            <div className="flex justify-end">
                                <Button
                                    type="submit"
                                    disabled={creating}
                                    className="rounded-sm bg-[#a8262c] text-white hover:bg-[#8f2024] disabled:opacity-60"
                                >
                                    {creating ? "Creating…" : "Create instance"}
                                </Button>
                            </div>
                        </form>
                    )}

                    {listError && (
                        <div className="mb-4 flex max-w-xl items-center justify-between gap-3 rounded-sm border border-[#5c1417] bg-[#a8262c]/15 px-3 py-2.5 text-[12.5px] text-[#e6a5a8]">
                            <span>{listError}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={loadInstances}
                                className="h-auto rounded-sm border-current px-2.5 py-0.5 text-[11px] text-current hover:bg-transparent"
                            >
                                Retry
                            </Button>
                        </div>
                    )}

                    {loadingList && !instances.length && (
                        <p className="py-10 text-sm text-[#8a8078]">Reading instances…</p>
                    )}

                    {!loadingList && !listError && !instances.length && (
                        <p className="py-10 text-sm text-[#8a8078]">
                            No instances yet. Create one to start capturing traffic.
                        </p>
                    )}

                    <ul className="flex max-w-xl flex-col gap-2 overflow-y-auto">
                        {filtered.map((inst) => {
                            const isPending = pendingId === inst.id;
                            const error = rowError[inst.id];
                            return (
                                <li
                                    key={inst.id}
                                    className="relative flex items-center justify-between gap-3 rounded-sm border border-[#2a2424] bg-[#161414] px-4 py-3"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span
                                            className={`h-2 w-2 flex-shrink-0 rounded-full ${inst.status === "running"
                                                ? "bg-[#4f9d5c] shadow-[0_0_8px_#4f9d5c]"
                                                : "bg-[#5c1417]"
                                                }`}
                                        />
                                        <div className="flex min-w-0 flex-col">
                                            <span className="truncate text-sm font-semibold text-[#ede7df]">
                                                {inst.name}
                                            </span>
                                            <span className="font-mono text-[11px] text-[#8a8078]">
                                                {inst.host}:{inst.port}
                                            </span>
                                        </div>
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleSelect(inst)}
                                        disabled={!!pendingId}
                                        className="h-auto flex-shrink-0 rounded-sm border-[#c9a24b] bg-transparent px-3.5 py-1.5 text-xs font-semibold text-[#ede7df] hover:bg-[#c9a24b] hover:text-[#1a1210] disabled:opacity-50"
                                    >
                                        {isPending ? "Starting…" : inst.status === "running" ? "Connect" : "Start"}
                                    </Button>

                                    {error && (
                                        <span className="absolute -bottom-5 left-4 right-4 text-[11px] text-[#e6a5a8]">
                                            {error}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </main>
            </div>
        </div>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(<AresLaunchScreen />);
}