import { useEffect, useState, useRef, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
    Terminal,
    RefreshCw,
    Trash2,
    FolderOpen,
    Copy,
    Search,
    Check,
    SlidersHorizontal,
    Pause,
    Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface LogEntry {
    id: number
    timestamp: number
    level: string
    target: string
    message: string
    spans?: string | null
    fields?: Record<string, string>
}

export interface LogSettings {
    activeLevel: string
    filterDirective: string
    logDir: string
    totalCachedLogs: number
}

const LOG_LEVELS = ["all", "error", "warn", "info", "debug", "trace"] as const
type LogLevelFilter = (typeof LOG_LEVELS)[number]

export default function LogViewer() {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [settings, setSettings] = useState<LogSettings | null>(null)
    const [activeFilterLevel, setActiveFilterLevel] = useState<LogLevelFilter>("all")
    const [searchQuery, setSearchQuery] = useState("")
    const [autoScroll, setAutoScroll] = useState(true)
    const [isLivePaused, setIsLivePaused] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [copied, setCopied] = useState(false)

    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Load current log settings
    const fetchSettings = useCallback(async () => {
        try {
            const res = await invoke<LogSettings>("get_log_settings")
            setSettings(res)
        } catch (err) {
            console.error("Failed to fetch log settings:", err)
        }
    }, [])

    // Fetch recent logs from in-memory ring buffer
    const fetchLogs = useCallback(async () => {
        try {
            const minLevelParam = activeFilterLevel === "all" ? null : activeFilterLevel
            const fetched = await invoke<LogEntry[]>("get_recent_logs", {
                limit: 500,
                minLevel: minLevelParam,
                search: searchQuery.trim() || null,
            })
            // `query` returns most recent first, reverse to display chronologically in console
            setLogs([...fetched].reverse())
        } catch (err) {
            console.error("Failed to fetch logs:", err)
        }
    }, [activeFilterLevel, searchQuery])

    // Initial load
    useEffect(() => {
        fetchSettings()
        fetchLogs()
    }, [fetchSettings, fetchLogs])

    // Polling effect when live is not paused
    useEffect(() => {
        if (isLivePaused) return

        const interval = setInterval(() => {
            fetchLogs()
        }, 1500)

        return () => clearInterval(interval)
    }, [isLivePaused, fetchLogs])

    // Auto-scroll to bottom on new logs
    useEffect(() => {
        if (autoScroll && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
    }, [logs, autoScroll])

    // Change runtime log level
    const handleSetLogLevel = async (newLevel: string) => {
        setIsLoading(true)
        try {
            await invoke("set_log_level", { level: newLevel })
            toast.success(`Log level updated to ${newLevel.toUpperCase()}`)
            await fetchSettings()
            await fetchLogs()
        } catch (err) {
            toast.error(`Failed to update log level: ${err}`)
        } finally {
            setIsLoading(false)
        }
    }

    // Clear logs
    const handleClearLogs = async () => {
        try {
            await invoke("clear_memory_logs")
            setLogs([])
            toast.success("In-memory logs cleared")
            await fetchSettings()
        } catch (err) {
            toast.error(`Failed to clear logs: ${err}`)
        }
    }

    // Open logs directory
    const handleOpenLogDir = async () => {
        try {
            await invoke("open_log_directory")
        } catch (err) {
            toast.error(`Failed to open logs folder: ${err}`)
        }
    }

    // Copy all current logs to clipboard
    const handleCopyLogs = () => {
        if (!logs.length) return
        const text = logs
            .map((l) => {
                const date = new Date(l.timestamp).toISOString()
                const spanPart = l.spans ? ` [${l.spans}]` : ""
                return `${date} [${l.level.padEnd(5)}] [${l.target}]${spanPart} ${l.message}`
            })
            .join("\n")

        navigator.clipboard.writeText(text)
        setCopied(true)
        toast.success("Logs copied to clipboard")
        setTimeout(() => setCopied(false), 2000)
    }

    const getLevelBadge = (level: string) => {
        const lvl = level.toUpperCase()
        switch (lvl) {
            case "ERROR":
                return <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-mono">ERROR</Badge>
            case "WARN":
                return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 px-1.5 py-0 text-[10px] font-mono">WARN</Badge>
            case "INFO":
                return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 px-1.5 py-0 text-[10px] font-mono">INFO</Badge>
            case "DEBUG":
                return <Badge className="bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30 px-1.5 py-0 text-[10px] font-mono">DEBUG</Badge>
            case "TRACE":
                return <Badge className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30 px-1.5 py-0 text-[10px] font-mono">TRACE</Badge>
            default:
                return <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono">{lvl}</Badge>
        }
    }

    const formatTimestamp = (ms: number) => {
        const d = new Date(ms)
        const pad = (n: number) => String(n).padStart(2, "0")
        const msPad = (n: number) => String(n).padStart(3, "0")
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${msPad(d.getMilliseconds())}`
    }

    return (
        <div className="space-y-4">
            {/* Header Controls Card */}
            <Card className="border-border bg-card/60 backdrop-blur-sm shadow-sm">
                <CardHeader className="pb-3 pt-4 px-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <Terminal className="h-5 w-5 text-primary" />
                                <CardTitle className="text-base font-semibold">Tracing & Application Logs</CardTitle>
                            </div>
                            <CardDescription className="text-xs mt-1">
                                Real-time diagnostic stream from proxy connections, background workers, and SQLite operations.
                            </CardDescription>
                        </div>

                        {/* Runtime Level Dropdown */}
                        <div className="flex items-center gap-2">
                            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">Runtime Level:</span>
                            <Select
                                value={settings?.activeLevel || "debug"}
                                onValueChange={handleSetLogLevel}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-8 w-28 text-xs font-mono">
                                    <SelectValue placeholder="Level" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="error">ERROR</SelectItem>
                                    <SelectItem value="warn">WARN</SelectItem>
                                    <SelectItem value="info">INFO</SelectItem>
                                    <SelectItem value="debug">DEBUG</SelectItem>
                                    <SelectItem value="trace">TRACE</SelectItem>
                                </SelectContent>
                            </Select>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleOpenLogDir}
                                className="h-8 text-xs gap-1.5"
                                title="Open log files directory"
                            >
                                <FolderOpen className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Log Folder</span>
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="px-5 pb-4 pt-0">
                    {/* Filter & Search Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
                        {/* Search Input */}
                        <div className="relative flex-1 min-w-[200px] max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search message, target, or span..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-8 pl-8 text-xs bg-background/80"
                            />
                        </div>

                        {/* Level Filter Badges */}
                        <div className="flex items-center gap-1 overflow-x-auto py-1">
                            {LOG_LEVELS.map((lvl) => (
                                <Button
                                    key={lvl}
                                    variant={activeFilterLevel === lvl ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setActiveFilterLevel(lvl)}
                                    className={cn(
                                        "h-7 px-2.5 text-[11px] font-mono capitalize transition-all",
                                        activeFilterLevel === lvl
                                            ? "shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {lvl}
                                </Button>
                            ))}
                        </div>

                        {/* Stream Controls */}
                        <div className="flex items-center gap-1.5 ml-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsLivePaused(!isLivePaused)}
                                className={cn(
                                    "h-7 px-2 text-xs gap-1",
                                    isLivePaused ? "text-amber-500 hover:text-amber-600" : "text-emerald-500 hover:text-emerald-600"
                                )}
                                title={isLivePaused ? "Resume live streaming" : "Pause live streaming"}
                            >
                                {isLivePaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                                <span className="text-[11px]">{isLivePaused ? "Paused" : "Live"}</span>
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCopyLogs}
                                className="h-7 w-7 p-0"
                                title="Copy logs to clipboard"
                            >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleClearLogs}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                title="Clear in-memory logs"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => fetchLogs()}
                                className="h-7 w-7 p-0"
                                title="Refresh"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Terminal Log Console */}
            <div className="rounded-lg border border-border bg-zinc-950 font-mono text-[12px] shadow-md overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-[11px] text-zinc-400 select-none">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                            <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                        </div>
                        <span className="font-semibold text-zinc-300 ml-1">aresius-trace-console</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                                className="rounded text-primary focus:ring-0 h-3 w-3 bg-zinc-800 border-zinc-700"
                            />
                            <span>Auto-scroll</span>
                        </label>
                        <span>{logs.length} entries</span>
                    </div>
                </div>

                {/* Console Log Lines */}
                <div
                    ref={scrollContainerRef}
                    className="p-3 overflow-y-auto max-h-[520px] min-h-[300px] space-y-1 select-text scrollbar-thin scrollbar-thumb-zinc-800"
                >
                    {logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                            <Terminal className="h-8 w-8 mb-2 opacity-50" />
                            <p>No log events captured yet matching the current filter.</p>
                            <p className="text-[11px] text-zinc-600 mt-1">
                                Activity from proxy requests and background services will appear here.
                            </p>
                        </div>
                    ) : (
                        logs.map((entry) => (
                            <div
                                key={entry.id}
                                className="flex items-start gap-2.5 py-0.5 px-1.5 rounded hover:bg-zinc-900/60 leading-relaxed group"
                            >
                                <span className="text-zinc-500 whitespace-nowrap select-none text-[11px]">
                                    {formatTimestamp(entry.timestamp)}
                                </span>

                                <span className="select-none flex-shrink-0">
                                    {getLevelBadge(entry.level)}
                                </span>

                                <span className="text-zinc-400 whitespace-nowrap text-[11px] truncate max-w-[160px] select-none" title={entry.target}>
                                    {entry.target.replace(/^aresius::/, "")}
                                </span>

                                {entry.spans && (
                                    <span className="text-primary/70 text-[11px] whitespace-nowrap" title={`Span Context: ${entry.spans}`}>
                                        [{entry.spans}]
                                    </span>
                                )}

                                <span
                                    className={cn(
                                        "flex-1 break-all text-zinc-200",
                                        entry.level === "ERROR" && "text-rose-400",
                                        entry.level === "WARN" && "text-amber-300",
                                        entry.level === "DEBUG" && "text-zinc-300",
                                        entry.level === "TRACE" && "text-zinc-400"
                                    )}
                                >
                                    {entry.message}
                                    {entry.fields && Object.keys(entry.fields).length > 0 && (
                                        <span className="text-zinc-500 ml-2">
                                            {Object.entries(entry.fields)
                                                .map(([k, v]) => `${k}=${v}`)
                                                .join(" ")}
                                        </span>
                                    )}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
