import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import {
    Network,
    Server,
    Shield,
    RotateCcw,
    Copy,
    Check,
    CheckCircle2,
    AlertCircle,
    AlertTriangle,
    Sliders,
    Save,
    RefreshCw,
    Keyboard,
    Info,
    Radio,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { ProxySettings, ProxyStatus } from "@/types/proxySettings.type"
import InstallCertificateDialog from "@/components/InstallCert"
import { cn } from "@/lib/utils"

type SettingsTab = "proxy" | "certificates" | "shortcuts" | "about"

const PRESET_PORTS = [8080, 8081, 8443, 8888, 9090]

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<SettingsTab>("proxy")

    // Proxy Settings state
    const [hostType, setHostType] = useState<"127.0.0.1" | "0.0.0.0" | "custom">("127.0.0.1")
    const [customHost, setCustomHost] = useState<string>("")
    const [port, setPort] = useState<number>(8080)
    const [autoFallbackPort, setAutoFallbackPort] = useState<boolean>(true)
    const [autoFallbackLoopback, setAutoFallbackLoopback] = useState<boolean>(true)

    // Live status
    const [status, setStatus] = useState<ProxyStatus>({
        isRunning: false,
        boundAddress: null,
        requestedAddress: "127.0.0.1:8080",
        fallbackApplied: false,
        lastError: null,
    })

    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [isSaving, setIsSaving] = useState<boolean>(false)
    const [isRestarting, setIsRestarting] = useState<boolean>(false)
    const [copiedAddress, setCopiedAddress] = useState<boolean>(false)

    // Dialog state
    const [certDialogOpen, setCertDialogOpen] = useState<boolean>(false)

    // Load initial settings and status
    useEffect(() => {
        let isMounted = true

        const loadData = async () => {
            try {
                const [savedSettings, liveStatus] = await Promise.all([
                    invoke<ProxySettings>("get_proxy_settings_db"),
                    invoke<ProxyStatus>("get_proxy_status"),
                ])

                if (!isMounted) return

                if (savedSettings) {
                    if (savedSettings.host === "127.0.0.1") {
                        setHostType("127.0.0.1")
                    } else if (savedSettings.host === "0.0.0.0") {
                        setHostType("0.0.0.0")
                    } else {
                        setHostType("custom")
                        setCustomHost(savedSettings.host)
                    }
                    setPort(savedSettings.port || 8080)
                    setAutoFallbackPort(savedSettings.autoFallbackPort ?? true)
                    setAutoFallbackLoopback(savedSettings.autoFallbackLoopback ?? true)
                }

                if (liveStatus) {
                    setStatus(liveStatus)
                }
            } catch (err) {
                console.error("Failed to load proxy settings:", err)
                toast.error("Failed to load proxy settings")
            } finally {
                if (isMounted) setIsLoading(false)
            }
        }

        loadData()

        // Listen for live status events
        const unlistenPromise = listen<ProxyStatus>("proxy-status-changed", (event) => {
            if (isMounted && event.payload) {
                setStatus(event.payload)
            }
        })

        return () => {
            isMounted = false
            unlistenPromise.then((unlisten) => unlisten())
        }
    }, [])

    const resolvedHost = hostType === "custom" ? customHost.trim() || "127.0.0.1" : hostType

    const handleSaveAndApply = async () => {
        if (!port || port < 1 || port > 65535) {
            toast.error("Port must be between 1 and 65535")
            return
        }

        if (hostType === "custom" && !customHost.trim()) {
            toast.error("Please enter a valid custom host IP")
            return
        }

        setIsSaving(true)
        const settingsToSave: ProxySettings = {
            host: resolvedHost,
            port,
            autoFallbackPort,
            autoFallbackLoopback,
        }

        try {
            const newStatus = await invoke<ProxyStatus>("save_and_apply_proxy_settings", {
                settings: settingsToSave,
            })
            setStatus(newStatus)
            if (newStatus.fallbackApplied) {
                toast.warning(`Proxy active with fallback: Listening on ${newStatus.boundAddress}`)
            } else {
                toast.success(`Proxy listening on ${newStatus.boundAddress}`)
            }
        } catch (err) {
            const msg = typeof err === "string" ? err : "Failed to apply proxy settings"
            toast.error(msg)
        } finally {
            setIsSaving(false)
        }
    }

    const handleRestartListener = async () => {
        setIsRestarting(true)
        try {
            const newStatus = await invoke<ProxyStatus>("restart_proxy_listener")
            setStatus(newStatus)
            if (newStatus.fallbackApplied) {
                toast.warning(`Proxy restarted with fallback: Listening on ${newStatus.boundAddress}`)
            } else {
                toast.success(`Proxy restarted on ${newStatus.boundAddress}`)
            }
        } catch (err) {
            const msg = typeof err === "string" ? err : "Failed to restart proxy listener"
            toast.error(msg)
        } finally {
            setIsRestarting(false)
        }
    }

    const handleResetDefaults = () => {
        setHostType("127.0.0.1")
        setCustomHost("")
        setPort(8080)
        setAutoFallbackPort(true)
        setAutoFallbackLoopback(true)
        toast.info("Reset form values to default (127.0.0.1:8080). Click 'Save & Apply' to commit.")
    }

    const handleCopyAddress = async (addr: string) => {
        try {
            await navigator.clipboard.writeText(addr)
            setCopiedAddress(true)
            toast.success(`Copied ${addr} to clipboard`)
            setTimeout(() => setCopiedAddress(false), 2000)
        } catch {
            toast.error("Failed to copy address")
        }
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* ── Settings Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                        <Sliders className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight text-foreground">
                            Settings
                        </h1>
                        <p className="text-xs text-muted-foreground">
                            Configure Aresius proxy listeners, fallbacks, certificates, and system preferences.
                        </p>
                    </div>
                </div>

                {/* Status indicator badge */}
                <div className="flex items-center gap-2">
                    {status.isRunning ? (
                        status.fallbackApplied ? (
                            <Badge
                                variant="outline"
                                className="bg-amber-500/10 text-amber-500 border-amber-500/30 gap-1.5 py-1 px-2.5 text-xs font-medium"
                            >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Fallback Active: {status.boundAddress}
                            </Badge>
                        ) : (
                            <Badge
                                variant="outline"
                                className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 gap-1.5 py-1 px-2.5 text-xs font-medium"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Listening: {status.boundAddress}
                            </Badge>
                        )
                    ) : (
                        <Badge
                            variant="outline"
                            className="bg-destructive/10 text-destructive border-destructive/30 gap-1.5 py-1 px-2.5 text-xs font-medium"
                        >
                            <AlertCircle className="w-3.5 h-3.5" />
                            Proxy Offline
                        </Badge>
                    )}
                </div>
            </div>

            {/* ── Main Layout: Left Sidebar + Right Content ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* ── Left Sidebar Navigation ── */}
                <div className="w-56 border-r border-border/60 bg-muted/5 p-3 flex flex-col gap-1 shrink-0 select-none">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Categories
                    </div>

                    <button
                        type="button"
                        onClick={() => setActiveTab("proxy")}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left",
                            activeTab === "proxy"
                                ? "bg-primary/10 text-primary border border-primary/20 shadow-xs"
                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        )}
                    >
                        <Network className="w-4 h-4 shrink-0" />
                        <span className="flex-1">Proxy Listener</span>
                        {status.isRunning && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab("certificates")}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left",
                            activeTab === "certificates"
                                ? "bg-primary/10 text-primary border border-primary/20 shadow-xs"
                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        )}
                    >
                        <Shield className="w-4 h-4 shrink-0" />
                        <span className="flex-1">CA Certificates</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab("shortcuts")}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left",
                            activeTab === "shortcuts"
                                ? "bg-primary/10 text-primary border border-primary/20 shadow-xs"
                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        )}
                    >
                        <Keyboard className="w-4 h-4 shrink-0" />
                        <span className="flex-1">Shortcuts</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab("about")}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left",
                            activeTab === "about"
                                ? "bg-primary/10 text-primary border border-primary/20 shadow-xs"
                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        )}
                    >
                        <Info className="w-4 h-4 shrink-0" />
                        <span className="flex-1">About & Architecture</span>
                    </button>
                </div>

                {/* ── Right Content Area ── */}
                <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-6">
                    {/* ════════════════════════════════════════════════════════════ */}
                    {/* TAB: PROXY LISTENER */}
                    {/* ════════════════════════════════════════════════════════════ */}
                    {activeTab === "proxy" && (
                        <div className="max-w-4xl space-y-6">
                            {/* Live Status Card */}
                            <Card className="border-border/60 bg-card/60 shadow-xs">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Server className="w-4 h-4 text-primary" />
                                            <CardTitle className="text-sm font-semibold">
                                                Live Proxy Status
                                            </CardTitle>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleRestartListener}
                                                disabled={isRestarting || isSaving}
                                                className="h-7 text-xs gap-1.5 border-border/60"
                                            >
                                                <RefreshCw className={cn("w-3.5 h-3.5", isRestarting && "animate-spin text-primary")} />
                                                Restart Listener
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {/* Status */}
                                        <div className="p-3 rounded-md bg-muted/20 border border-border/40 flex flex-col gap-1">
                                            <span className="text-[11px] font-medium text-muted-foreground">
                                                Listener State
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={cn(
                                                        "w-2.5 h-2.5 rounded-full",
                                                        status.isRunning
                                                            ? status.fallbackApplied
                                                                ? "bg-amber-500 animate-pulse"
                                                                : "bg-emerald-500"
                                                            : "bg-destructive"
                                                    )}
                                                />
                                                <span className="text-xs font-semibold text-foreground">
                                                    {status.isRunning
                                                        ? status.fallbackApplied
                                                            ? "Running (Fallback Applied)"
                                                            : "Running (Active)"
                                                        : "Stopped"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Bound Address */}
                                        <div className="p-3 rounded-md bg-muted/20 border border-border/40 flex flex-col gap-1">
                                            <span className="text-[11px] font-medium text-muted-foreground">
                                                Bound Address
                                            </span>
                                            <div className="flex items-center justify-between gap-2">
                                                <code className="text-xs font-mono font-medium text-primary">
                                                    {status.boundAddress || "None (Offline)"}
                                                </code>
                                                {status.boundAddress && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyAddress(status.boundAddress!)}
                                                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                                                        title="Copy address"
                                                    >
                                                        {copiedAddress ? (
                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Configured Address */}
                                        <div className="p-3 rounded-md bg-muted/20 border border-border/40 flex flex-col gap-1">
                                            <span className="text-[11px] font-medium text-muted-foreground">
                                                Requested Address
                                            </span>
                                            <code className="text-xs font-mono text-muted-foreground">
                                                {status.requestedAddress || `${resolvedHost}:${port}`}
                                            </code>
                                        </div>
                                    </div>

                                    {/* Warnings / Fallback messages */}
                                    {status.fallbackApplied && (
                                        <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-start gap-2.5 text-xs">
                                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold">Automatic Fallback Active</p>
                                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                                    The requested port (<code>{status.requestedAddress}</code>) was in use or inaccessible.
                                                    Aresius automatically bound to <code>{status.boundAddress}</code> so your session is uninterrupted.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {status.lastError && (
                                        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-2.5 text-xs">
                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold">Proxy Listener Error</p>
                                                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                                    {status.lastError}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Proxy Configuration Form */}
                            <Card className="border-border/60 bg-card shadow-xs">
                                <CardHeader>
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Radio className="w-4 h-4 text-primary" />
                                        Network & Port Configuration
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Specify the IP interface and port that the Aresius MITM proxy will bind to.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    {/* Host Interface Option */}
                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold">Bind Host / Network Interface</Label>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            {/* 127.0.0.1 */}
                                            <button
                                                type="button"
                                                onClick={() => setHostType("127.0.0.1")}
                                                className={cn(
                                                    "p-3 rounded-lg border text-left flex flex-col gap-1 transition-all",
                                                    hostType === "127.0.0.1"
                                                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30"
                                                        : "border-border/60 bg-muted/10 hover:bg-muted/30"
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-foreground">127.0.0.1</span>
                                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                                                        Recommended
                                                    </Badge>
                                                </div>
                                                <span className="text-[11px] text-muted-foreground">
                                                    Loopback only. Private and secure for local browser traffic.
                                                </span>
                                            </button>

                                            {/* 0.0.0.0 */}
                                            <button
                                                type="button"
                                                onClick={() => setHostType("0.0.0.0")}
                                                className={cn(
                                                    "p-3 rounded-lg border text-left flex flex-col gap-1 transition-all",
                                                    hostType === "0.0.0.0"
                                                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30"
                                                        : "border-border/60 bg-muted/10 hover:bg-muted/30"
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-foreground">0.0.0.0</span>
                                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                                        All Interfaces
                                                    </Badge>
                                                </div>
                                                <span className="text-[11px] text-muted-foreground">
                                                    Allows remote devices, mobile phones, and virtual machines.
                                                </span>
                                            </button>

                                            {/* Custom */}
                                            <button
                                                type="button"
                                                onClick={() => setHostType("custom")}
                                                className={cn(
                                                    "p-3 rounded-lg border text-left flex flex-col gap-1 transition-all",
                                                    hostType === "custom"
                                                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30"
                                                        : "border-border/60 bg-muted/10 hover:bg-muted/30"
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-foreground">Custom IP</span>
                                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                                        Specific
                                                    </Badge>
                                                </div>
                                                <span className="text-[11px] text-muted-foreground">
                                                    Bind to a dedicated adapter IP address.
                                                </span>
                                            </button>
                                        </div>

                                        {hostType === "custom" && (
                                            <div className="pt-2">
                                                <Label htmlFor="custom-host" className="text-xs text-muted-foreground">
                                                    Enter Custom IP
                                                </Label>
                                                <Input
                                                    id="custom-host"
                                                    value={customHost}
                                                    onChange={(e) => setCustomHost(e.target.value)}
                                                    placeholder="e.g. 192.168.1.100"
                                                    className="h-8 text-xs font-mono max-w-xs mt-1"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Port Configuration */}
                                    <div className="space-y-3">
                                        <Label htmlFor="proxy-port" className="text-xs font-semibold">
                                            Listening Port
                                        </Label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="w-36">
                                                <Input
                                                    id="proxy-port"
                                                    type="number"
                                                    min={1}
                                                    max={65535}
                                                    value={port}
                                                    onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                                                    className="h-8 text-xs font-mono"
                                                />
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
                                                {PRESET_PORTS.map((preset) => (
                                                    <Button
                                                        key={preset}
                                                        type="button"
                                                        size="sm"
                                                        variant={port === preset ? "default" : "outline"}
                                                        onClick={() => setPort(preset)}
                                                        className={cn(
                                                            "h-7 text-xs px-2.5 font-mono",
                                                            port === preset && "bg-primary text-primary-foreground"
                                                        )}
                                                    >
                                                        {preset}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        {port < 1024 && port > 0 && (
                                            <p className="text-[11px] text-amber-500 flex items-center gap-1 mt-1">
                                                <AlertTriangle className="w-3 h-3" />
                                                Ports below 1024 may require administrator / root privileges.
                                            </p>
                                        )}
                                    </div>

                                    {/* Fallback Behaviors */}
                                    <div className="space-y-4 pt-2 border-t border-border/50">
                                        <Label className="text-xs font-semibold">Resilience & Fallback Options</Label>

                                        {/* Port hunting */}
                                        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                                            <div className="space-y-0.5 pr-4">
                                                <div className="text-xs font-medium text-foreground">
                                                    Port Collision Fallback (Sequential Port Hunting)
                                                </div>
                                                <div className="text-[11px] text-muted-foreground">
                                                    If port {port} is occupied by another process, automatically try sequential ports ({port + 1}..{port + 10}) without crashing.
                                                </div>
                                            </div>
                                            <Switch
                                                checked={autoFallbackPort}
                                                onCheckedChange={setAutoFallbackPort}
                                            />
                                        </div>

                                        {/* Loopback fallback */}
                                        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
                                            <div className="space-y-0.5 pr-4">
                                                <div className="text-xs font-medium text-foreground">
                                                    Interface Fallback to Loopback (127.0.0.1)
                                                </div>
                                                <div className="text-[11px] text-muted-foreground">
                                                    If an external network interface is unplugged or fails to bind, safely fall back to <code>127.0.0.1</code>.
                                                </div>
                                            </div>
                                            <Switch
                                                checked={autoFallbackLoopback}
                                                onCheckedChange={setAutoFallbackLoopback}
                                            />
                                        </div>
                                    </div>
                                </CardContent>
                                <CardFooter className="flex items-center justify-between border-t border-border/50 bg-muted/10 px-6 py-3">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleResetDefaults}
                                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                        Reset to Defaults
                                    </Button>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={handleSaveAndApply}
                                            disabled={isSaving || isLoading}
                                            className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium px-4"
                                        >
                                            <Save className="w-3.5 h-3.5" />
                                            {isSaving ? "Saving & Applying..." : "Save & Apply"}
                                        </Button>
                                    </div>
                                </CardFooter>
                            </Card>


                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════════ */}
                    {/* TAB: CERTIFICATES */}
                    {/* ════════════════════════════════════════════════════════════ */}
                    {activeTab === "certificates" && (
                        <div className="max-w-4xl space-y-6">
                            <Card className="border-border/60 bg-card shadow-xs">
                                <CardHeader>
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-primary" />
                                        Root CA Certificate Management
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Aresius uses an internal Root Certificate Authority to dynamically generate SSL/TLS certificates for intercepted domains.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        You can install the Root CA directly into your OS certificate trust store, or export it to import manually into Firefox, Burp Suite, or mobile emulators.
                                    </p>

                                    <div className="flex flex-wrap items-center gap-3 pt-2">
                                        <Button
                                            type="button"
                                            onClick={() => setCertDialogOpen(true)}
                                            className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                                        >
                                            <Shield className="w-3.5 h-3.5" />
                                            Open Certificate Setup Dialog
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════════ */}
                    {/* TAB: SHORTCUTS */}
                    {/* ════════════════════════════════════════════════════════════ */}
                    {activeTab === "shortcuts" && (
                        <div className="max-w-4xl space-y-6">
                            <Card className="border-border/60 bg-card shadow-xs">
                                <CardHeader>
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Keyboard className="w-4 h-4 text-primary" />
                                        Global Keyboard Shortcuts
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Keyboard shortcuts available throughout the application.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="divide-y divide-border/40 text-xs">
                                        <div className="py-2.5 flex items-center justify-between">
                                            <span className="text-foreground">Open Project File</span>
                                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] border border-border/60">
                                                Ctrl+O / ⌘O
                                            </kbd>
                                        </div>
                                        <div className="py-2.5 flex items-center justify-between">
                                            <span className="text-foreground">Toggle Fullscreen</span>
                                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] border border-border/60">
                                                F11
                                            </kbd>
                                        </div>
                                        <div className="py-2.5 flex items-center justify-between">
                                            <span className="text-foreground">Zoom In</span>
                                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] border border-border/60">
                                                Ctrl++ / ⌘+
                                            </kbd>
                                        </div>
                                        <div className="py-2.5 flex items-center justify-between">
                                            <span className="text-foreground">Zoom Out</span>
                                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] border border-border/60">
                                                Ctrl+- / ⌘-
                                            </kbd>
                                        </div>
                                        <div className="py-2.5 flex items-center justify-between">
                                            <span className="text-foreground">Reset Zoom</span>
                                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px] border border-border/60">
                                                Ctrl+0 / ⌘0
                                            </kbd>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════════ */}
                    {/* TAB: ABOUT */}
                    {/* ════════════════════════════════════════════════════════════ */}
                    {activeTab === "about" && (
                        <div className="max-w-4xl space-y-6">
                            <Card className="border-border/60 bg-card shadow-xs">
                                <CardHeader>
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                        <Info className="w-4 h-4 text-primary" />
                                        About Aresius Architecture
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Aresius Network & Storage Model
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                                    <div className="p-3.5 rounded-lg border border-border/50 bg-muted/10 space-y-2">
                                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                                            <Server className="w-3.5 h-3.5 text-primary" />
                                            Data Separation Model
                                        </h3>
                                        <p>
                                            <strong>Catalog Database (<code>catalog.db</code>):</strong> Stores global application configuration such as proxy host, port, fallbacks, UI scaling, and the project index.
                                        </p>
                                        <p>
                                            <strong>Project Databases (<code>.ares</code> files):</strong> Contains all scoped HTTP traffic, requests, responses, match & replace rules, fuzzing sessions, and replayer collections for individual engagements.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </div>

            {/* Install Certificate Dialog instance */}
            <InstallCertificateDialog open={certDialogOpen} onOpenChange={setCertDialogOpen} />
        </div>
    )
}
