import {
    Menubar,
    MenubarContent,
    MenubarGroup,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger,
} from "@/components/ui/menubar"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import { useEffect, useRef, useState, useMemo } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { invoke } from "@tauri-apps/api/core"
import {
    Minus,
    Square,
    Copy,
    X,
    Sun,
    Moon,
    Laptop,
    Check,
    ChevronDown,
    CircleDot,
    FolderOpen,
    Library,
    Clock,
    Shield,
    Upload,
    Download,
    ClipboardCopy,
    RotateCcw,
    Maximize2,
    Minimize2,
    Bug,
    Info,
    Loader2,
    ZoomIn,
    ZoomOut,
    Type,
    Settings,
    Radio,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import InstallCertificateDialog from "./InstallCert"
import AddCustomCertDialog from "./AddCustomCertDialog"
import AboutDialog from "./AboutDialog"
import { open } from "@tauri-apps/plugin-shell"
import { useTheme } from "./theme-provider"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { useProjectId } from "@/hooks/useProjectId"
import { useProxyStatus } from "@/hooks/useProxyStatus"
import { selectAllScopes, selectActiveScope, selectActiveScopeId, setActiveScope, fetchScopeDataForProject } from "@/store/slices/scopeSlice"
import { addProject, setcurrentProjectId, updateProject } from "@/store/slices/projectSlice"
import { fetchSitemapStateForProject, setSiteMapBulk } from "@/store/slices/sitemapSlice"
import { fetchMatchReplaceDataForProject } from "@/store/slices/matchReplaceSlice"
import {
    setFontSizeScale,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
} from "@/store/slices/appStateSlice"
import { isMac } from "@/lib/platform"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Project } from "@/types/project.type"
import { HttpHistorySummaryRow } from "@/types/http.type"
import { cn } from "@/lib/utils"

const appWindow = getCurrentWindow()

export default function MenubarDemo() {
    const navigate = useNavigate()
    const location = useLocation()
    const [isMaximized, setIsMaximized] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const { theme, setTheme } = useTheme()

    // Dialog states
    const [certDialogOpen, setCertDialogOpen] = useState(false)
    const [customCertDialogOpen, setCustomCertDialogOpen] = useState(false)
    const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
    const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)
    const [isRegenerating, setIsRegenerating] = useState(false)

    const handleRegenerateCA = async () => {
        setIsRegenerating(true)
        try {
            await invoke("regenerate_ca_cert")
            setRegenerateConfirmOpen(false)
            toast.success("CA Certificate regenerated successfully")
            setCertDialogOpen(true)
        } catch (err) {
            toast.error(typeof err === "string" ? err : "Failed to regenerate CA certificate")
        } finally {
            setIsRegenerating(false)
        }
    }

    const handleCopyCaPath = async () => {
        try {
            const path = (await invoke("get_ca_cert_path")) as string
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(path)
            } else {
                const textarea = document.createElement("textarea")
                textarea.value = path
                textarea.style.position = "fixed"
                textarea.style.opacity = "0"
                document.body.appendChild(textarea)
                textarea.select()
                document.execCommand("copy")
                document.body.removeChild(textarea)
            }
            toast.success("CA Certificate path copied to clipboard")
        } catch (err) {
            toast.error(typeof err === "string" ? err : "Failed to copy CA certificate path")
        }
    }

    const handleExportCaCert = async () => {
        try {
            const pem = (await invoke("get_ca_cert_pem")) as string
            const defaultFilename = "aresius-ca-cert.pem"

            // 1. Try native File System Access API (Save file picker)
            if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: defaultFilename,
                        types: [
                            {
                                description: "PEM Certificate (*.pem, *.crt)",
                                accept: {
                                    "application/x-pem-file": [".pem", ".crt"],
                                    "text/plain": [".pem", ".crt", ".txt"],
                                },
                            },
                        ],
                    })
                    const writable = await handle.createWritable()
                    await writable.write(pem)
                    await writable.close()
                    toast.success("CA Certificate saved successfully")
                    return
                } catch (err: unknown) {
                    if (err instanceof Error && err.name === "AbortError") {
                        return
                    }
                }
            }

            // 2. Fallback to standard browser download
            const blob = new Blob([pem], { type: "application/x-pem-file" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = defaultFilename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            toast.success("CA certificate downloaded")
        } catch (err) {
            toast.error(typeof err === "string" ? err : "Failed to export CA certificate")
        }
    }

    // Proxy state
    const { status: proxyStatus, setStatus: setProxyStatus } = useProxyStatus()
    const [proxyDropdownOpen, setProxyDropdownOpen] = useState(false)
    const proxyDropdownRef = useRef<HTMLDivElement>(null)
    const [isRestartingProxy, setIsRestartingProxy] = useState(false)

    // Project state
    const { projects, currentProjectId } = useAppSelector((state) => state.workspacestate)
    const activeProject = useMemo(() => projects.find((p) => p.id === currentProjectId) || null, [projects, currentProjectId])
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
    const projectDropdownRef = useRef<HTMLDivElement>(null)

    // Scope state
    const dispatch = useAppDispatch()
    const fontSizeScale = useAppSelector((state) => state.appState.fontSizeScale ?? 1.0)
    const zoomPercent = Math.round(fontSizeScale * 100)
    const projectId = useProjectId()
    const allScopes = useAppSelector(selectAllScopes(projectId))
    const activeScope = useAppSelector(selectActiveScope(projectId))
    const activeScopeId = useAppSelector(selectActiveScopeId(projectId))
    const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false)
    const scopeDropdownRef = useRef<HTMLDivElement>(null)

    // Close dropdowns on outside click
    useEffect(() => {
        if (!scopeDropdownOpen && !projectDropdownOpen && !proxyDropdownOpen) return
        const handler = (e: MouseEvent) => {
            if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
                setScopeDropdownOpen(false)
            }
            if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
                setProjectDropdownOpen(false)
            }
            if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node)) {
                setProxyDropdownOpen(false)
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [scopeDropdownOpen, projectDropdownOpen, proxyDropdownOpen])

    const handleCopyProxySocket = async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        if (!proxyStatus.boundAddress) return
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(proxyStatus.boundAddress)
            } else {
                const textarea = document.createElement("textarea")
                textarea.value = proxyStatus.boundAddress
                textarea.style.position = "fixed"
                textarea.style.opacity = "0"
                document.body.appendChild(textarea)
                textarea.select()
                document.execCommand("copy")
                document.body.removeChild(textarea)
            }
            toast.success(`Copied proxy socket ${proxyStatus.boundAddress} to clipboard`)
        } catch {
            toast.error("Failed to copy proxy address")
        }
    }

    const handleRestartProxy = async () => {
        setIsRestartingProxy(true)
        try {
            const newStatus = await invoke<import("@/types/proxySettings.type").ProxyStatus>("restart_proxy_listener")
            setProxyStatus(newStatus)
            if (newStatus.fallbackApplied) {
                toast.warning(`Proxy active with fallback on ${newStatus.boundAddress}`)
            } else {
                toast.success(`Proxy listening on ${newStatus.boundAddress}`)
            }
        } catch (err) {
            const msg = typeof err === "string" ? err : "Failed to restart proxy listener"
            toast.error(msg)
        } finally {
            setIsRestartingProxy(false)
        }
    }

    const handleSwitchProject = async (id: string) => {
        setProjectDropdownOpen(false)
        if (id === currentProjectId) return

        try {
            const updatedProject = await invoke<Project>("select_project", { id })
            dispatch(setcurrentProjectId(id))
            dispatch(updateProject(updatedProject))

            try {
                const summaries = await invoke<HttpHistorySummaryRow[]>("get_http_history_summaries", { projectId: id })
                dispatch(setSiteMapBulk({ items: summaries, projectId: id }))
            } catch (err) {
                console.warn("Could not load persisted HTTP history summaries:", err)
            }

            try {
                dispatch(fetchScopeDataForProject(id) as any)
            } catch (err) {
                console.warn("Could not load persisted Scope data:", err)
            }

            try {
                dispatch(fetchSitemapStateForProject(id) as any)
            } catch (err) {
                console.warn("Could not load persisted Sitemap state:", err)
            }

            try {
                dispatch(fetchMatchReplaceDataForProject(id) as any)
            } catch (err) {
                console.warn("Could not load persisted Match & Replace data:", err)
            }
        } catch (err: any) {
            console.error("Failed to switch project:", err)
            const targetProj = projects.find((p) => p.id === id)
            if (targetProj) {
                dispatch(updateProject({ ...targetProj, exists: false }))
            }
            const msg = typeof err === "string" ? err : err?.message || "Failed to switch project"
            toast.error(msg, {
                description: "The project file may have been moved or deleted. Go to Projects to relocate it.",
            })
        }
    }

    const recentProjects = useMemo(() => {
        return [...projects]
            .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt ?? 0) - (a.lastOpenedAt ?? a.updatedAt ?? 0))
            .slice(0, 8)
    }, [projects])

    const handleOpenProjectFile = async () => {
        try {
            const opened = await invoke<Project | null>("open_project_file", { filePath: null })
            if (!opened) {
                // User cancelled file dialog
                return
            }

            const existing = projects.find((p) => p.id === opened.id)
            if (existing) {
                dispatch(updateProject(opened))
            } else {
                dispatch(addProject(opened))
            }

            dispatch(setcurrentProjectId(opened.id))

            try {
                const summaries = await invoke<HttpHistorySummaryRow[]>("get_http_history_summaries", { projectId: opened.id })
                dispatch(setSiteMapBulk({ items: summaries, projectId: opened.id }))
            } catch (err) {
                console.warn("Could not load persisted HTTP history summaries:", err)
            }

            try {
                dispatch(fetchScopeDataForProject(opened.id) as any)
            } catch (err) {
                console.warn("Could not load persisted Scope data:", err)
            }

            try {
                dispatch(fetchSitemapStateForProject(opened.id) as any)
            } catch (err) {
                console.warn("Could not load persisted Sitemap state:", err)
            }

            try {
                dispatch(fetchMatchReplaceDataForProject(opened.id) as any)
            } catch (err) {
                console.warn("Could not load persisted Match & Replace data:", err)
            }

            toast.success(`Project "${opened.name}" opened successfully`)
        } catch (err: any) {
            console.error("Failed to open project file:", err)
            toast.error(typeof err === "string" ? err : err?.message || "Failed to open project file")
        }
    }

    useEffect(() => {
        // Set initial window state
        appWindow.isMaximized().then(setIsMaximized).catch(() => { })
        appWindow.isFullscreen().then(setIsFullscreen).catch(() => { })

        // Keep icon in sync if window is resized/maximized via OS controls,
        // double-click on title bar, snapping, etc.
        const unlistenPromise = appWindow.onResized(async () => {
            try {
                setIsMaximized(await appWindow.isMaximized())
                setIsFullscreen(await appWindow.isFullscreen())
            } catch { }
        })

        return () => {
            unlistenPromise.then((unlisten) => unlisten())
        }
    }, [])

    const handleToggleFullscreen = async () => {
        try {
            const isFull = await appWindow.isFullscreen()
            if (!isFull) {
                const wasMax = await appWindow.isMaximized()
                if (wasMax) {
                    await appWindow.unmaximize()
                }
                await appWindow.setFullscreen(true)
                setIsFullscreen(true)
            } else {
                await appWindow.setFullscreen(false)
                setIsFullscreen(false)
            }
        } catch (err) {
            console.error("Failed to toggle fullscreen:", err)
        }
    }

    // F11, Escape & Cmd/Ctrl+O key listeners
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.key === "F11") {
                e.preventDefault()
                await handleToggleFullscreen()
            } else if (e.key === "Escape") {
                try {
                    const isFull = await appWindow.isFullscreen()
                    if (isFull) {
                        e.preventDefault()
                        await appWindow.setFullscreen(false)
                        setIsFullscreen(false)
                    }
                } catch { }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
                e.preventDefault()
                handleOpenProjectFile()
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [projects])

    const handleMinimize = () => appWindow.minimize()

    const handleMaximizeToggle = async () => {
        const isFull = await appWindow.isFullscreen()
        if (isFull) {
            await appWindow.setFullscreen(false)
            setIsFullscreen(false)
        }
        await appWindow.toggleMaximize()
        setIsMaximized(await appWindow.isMaximized())
    }


    const handleClose = () => appWindow.close()

    return (
        <div
            className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1 select-none z-30"
            data-tauri-drag-region
        >
            <Avatar className="h-6 w-6 rounded-md shrink-0">
                <AvatarImage src="/icon.png" alt="Aresius" />
                <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-[10px] font-semibold">
                    AR
                </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium select-none shrink-0">Aresius</span>

            <Menubar className="border-none bg-transparent p-0 shrink-0 shadow-none rounded-none h-auto">
                {/* ── File Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarContent>
                        <MenubarGroup>
                            <MenubarItem onClick={handleOpenProjectFile} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Open Project (.ares)</span>
                                </span>
                                <KbdGroup>
                                    <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                                    {!isMac && <span>+</span>}
                                    <Kbd>O</Kbd>
                                </KbdGroup>
                            </MenubarItem>
                            <MenubarItem onClick={() => navigate("/projects")} className="gap-2">
                                <Library className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Open Project Catalog</span>
                            </MenubarItem>
                            <MenubarSub>
                                <MenubarSubTrigger className="gap-2">
                                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Recent Projects</span>
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-56">
                                    <MenubarGroup>
                                        {recentProjects.length === 0 ? (
                                            <MenubarItem disabled className="text-xs text-muted-foreground italic">
                                                No recent projects
                                            </MenubarItem>
                                        ) : (
                                            recentProjects.map((proj) => (
                                                <MenubarItem
                                                    key={proj.id}
                                                    onClick={() => handleSwitchProject(proj.id)}
                                                    className={cn(
                                                        "gap-2 text-xs flex items-center justify-between",
                                                        proj.id === currentProjectId && "text-primary font-medium bg-primary/10",
                                                        proj.exists === false && "opacity-60"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <FolderOpen className={cn("h-3.5 w-3.5 shrink-0", proj.id === currentProjectId ? "text-primary" : "text-muted-foreground")} />
                                                        <span className={cn("truncate", proj.exists === false && "line-through")}>{proj.name}</span>
                                                        {proj.exists === false && (
                                                            <span className="text-[9px] text-destructive shrink-0 font-normal">missing</span>
                                                        )}
                                                    </div>
                                                    {proj.id === currentProjectId && <Check className="w-3 h-3 text-primary shrink-0" />}
                                                </MenubarItem>
                                            ))
                                        )}
                                    </MenubarGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>

                    </MenubarContent>

                </MenubarMenu>


                {/* ── View Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarContent className="w-56">
                        <MenubarGroup>
                            <MenubarItem onClick={() => dispatch(increaseFontSize(0.05))} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
                                    Zoom In
                                </span>
                                <KbdGroup>
                                    <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                                    {!isMac && <span>+</span>}
                                    <Kbd>+</Kbd>
                                </KbdGroup>
                            </MenubarItem>
                            <MenubarItem onClick={() => dispatch(decreaseFontSize(0.05))} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
                                    Zoom Out
                                </span>
                                <KbdGroup>
                                    <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                                    {!isMac && <span>+</span>}
                                    <Kbd>-</Kbd>
                                </KbdGroup>
                            </MenubarItem>
                            <MenubarItem onClick={() => dispatch(resetFontSize())} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                                    Actual Size ({zoomPercent}%)
                                </span>
                                <KbdGroup>
                                    <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                                    {!isMac && <span>+</span>}
                                    <Kbd>0</Kbd>
                                </KbdGroup>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarSub>
                                <MenubarSubTrigger className="gap-2">
                                    <Type className="h-4 w-4 text-muted-foreground" />
                                    Font Size Scale
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-44">
                                    {[
                                        { label: "Small (85%)", value: 0.85 },
                                        { label: "Default (100%)", value: 1.00 },
                                        { label: "Medium (115%)", value: 1.15 },
                                        { label: "Large (130%)", value: 1.30 },
                                        { label: "Extra Large (150%)", value: 1.50 },
                                    ].map((preset) => {
                                        const isSelected = Math.abs(fontSizeScale - preset.value) < 0.03
                                        return (
                                            <MenubarItem
                                                key={preset.value}
                                                onClick={() => dispatch(setFontSizeScale(preset.value))}
                                                className="flex items-center justify-between"
                                            >
                                                <span>{preset.label}</span>
                                                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                                            </MenubarItem>
                                        )
                                    })}
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarSub>
                                <MenubarSubTrigger className="gap-2">
                                    {theme === "light" ? (
                                        <Sun className="h-4 w-4 text-amber-500" />
                                    ) : theme === "dark" ? (
                                        <Moon className="h-4 w-4 text-primary" />
                                    ) : (
                                        <Laptop className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    Theme
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-36">
                                    <MenubarItem onClick={() => setTheme("light")} className="flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                            <Sun className="h-3.5 w-3.5 text-amber-500" />
                                            Light
                                        </span>
                                        {theme === "light" && <Check className="h-3.5 w-3.5" />}
                                    </MenubarItem>
                                    <MenubarItem onClick={() => setTheme("dark")} className="flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                            <Moon className="h-3.5 w-3.5 text-primary" />
                                            Dark
                                        </span>
                                        {theme === "dark" && <Check className="h-3.5 w-3.5" />}
                                    </MenubarItem>
                                    <MenubarItem onClick={() => setTheme("system")} className="flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                            <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                                            System
                                        </span>
                                        {theme === "system" && <Check className="h-3.5 w-3.5" />}
                                    </MenubarItem>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem onClick={handleToggleFullscreen} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    {isFullscreen ? (
                                        <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                        <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                    {isFullscreen ? "Exit Fullscreen" : "Toggle Fullscreen"}
                                </span>
                                <KbdGroup>
                                    <Kbd>F11</Kbd>
                                </KbdGroup>
                            </MenubarItem>
                        </MenubarGroup>

                    </MenubarContent>
                </MenubarMenu>

                {/* ── Certificate Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>Certificate</MenubarTrigger>
                    <MenubarContent className="w-56">
                        <MenubarGroup>
                            <MenubarItem
                                className="gap-2"
                                onSelect={(event) => {
                                    event.preventDefault()
                                    setCertDialogOpen(true)
                                }}
                            >
                                <Shield className="h-3.5 w-3.5 text-primary" />
                                <span>Install Certificate</span>
                            </MenubarItem>
                            <MenubarItem
                                className="gap-2 cursor-pointer"
                                onSelect={() => {
                                    setCustomCertDialogOpen(true)
                                }}
                            >
                                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Add a Custom Certificate</span>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem
                                className="gap-2 cursor-pointer"
                                onSelect={() => {
                                    handleExportCaCert()
                                }}
                            >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Export Root CA Certificate</span>
                            </MenubarItem>
                            <MenubarItem
                                className="gap-2 cursor-pointer"
                                onSelect={() => {
                                    handleCopyCaPath()
                                }}
                            >
                                <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Copy CA File Path to Clipboard</span>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem
                                className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                onSelect={(event) => {
                                    event.preventDefault()
                                    setRegenerateConfirmOpen(true)
                                }}
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>Regenerate / Reset CA Certificates</span>
                            </MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                {/* ── Help Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>Help</MenubarTrigger>
                    <MenubarContent className="w-44">
                        <MenubarGroup>
                            <MenubarItem
                                className="gap-2"
                                onSelect={() => open("https://github.com/0xMarik/Aresius/issues")}
                            >
                                <Bug className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Report Bugs...</span>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem
                                className="gap-2"
                                onSelect={(event) => {
                                    event.preventDefault()
                                    setAboutDialogOpen(true)
                                }}
                            >
                                <Info className="h-3.5 w-3.5 text-primary" />
                                <span>About Aresius</span>
                            </MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>

            {/* ── Project, Proxy & Scope Switchers ── */}
            <div className="ml-auto flex items-center shrink-0 gap-1.5 mr-2">
                {/* ── Proxy Socket Indicator & Dropdown ── */}
                <div className="relative" ref={proxyDropdownRef}>
                    <button
                        type="button"
                        onClick={() => {
                            setProxyDropdownOpen((v) => !v)
                            setProjectDropdownOpen(false)
                            setScopeDropdownOpen(false)
                        }}
                        className={cn(
                            "flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-medium transition-all select-none",
                            proxyStatus.isRunning
                                ? proxyStatus.fallbackApplied
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                                : "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
                        )}
                        title={
                            proxyStatus.isRunning
                                ? `Proxy Active: ${proxyStatus.boundAddress}${proxyStatus.fallbackApplied ? " (Fallback active)" : ""}`
                                : "Proxy Offline"
                        }
                    >
                        {proxyStatus.isRunning ? (
                            <span className="relative flex h-2 w-2 shrink-0">
                                {proxyStatus.fallbackApplied ? (
                                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                                ) : (
                                    <>
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                    </>
                                )}
                            </span>
                        ) : (
                            <span className="h-2 w-2 rounded-full shrink-0 bg-destructive" />
                        )}

                        <span className="font-mono text-[10.5px] tracking-tight">
                            {proxyStatus.isRunning && proxyStatus.boundAddress
                                ? proxyStatus.boundAddress
                                : "Proxy Off"}
                        </span>
                        <ChevronDown className="w-2.5 h-2.5 opacity-60 shrink-0" />
                    </button>

                    {/* Proxy dropdown */}
                    {proxyDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 z-50 w-64 rounded-md border border-border bg-popover shadow-xl py-1 text-[11px] divide-y divide-border/30">
                            <div className="px-3 py-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                                        Proxy Listener
                                    </span>
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-medium",
                                            proxyStatus.isRunning
                                                ? proxyStatus.fallbackApplied
                                                    ? "bg-amber-500/15 text-amber-500"
                                                    : "bg-emerald-500/15 text-emerald-500"
                                                : "bg-destructive/15 text-destructive"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "w-1.5 h-1.5 rounded-full",
                                                proxyStatus.isRunning
                                                    ? proxyStatus.fallbackApplied
                                                        ? "bg-amber-500"
                                                        : "bg-emerald-500"
                                                    : "bg-destructive"
                                            )}
                                        />
                                        {proxyStatus.isRunning
                                            ? proxyStatus.fallbackApplied
                                                ? "Fallback Port"
                                                : "Listening"
                                            : "Offline"}
                                    </span>
                                </div>

                                {proxyStatus.isRunning && proxyStatus.boundAddress ? (
                                    <div className="mt-2 flex items-center justify-between rounded bg-muted/50 p-1.5 border border-border/40">
                                        <div className="min-w-0 pr-2">
                                            <div className="text-[9.5px] text-muted-foreground">Socket Address</div>
                                            <div className="font-mono text-xs font-semibold text-foreground truncate">
                                                {proxyStatus.boundAddress}
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-[10px] gap-1 shrink-0"
                                            onClick={handleCopyProxySocket}
                                        >
                                            <ClipboardCopy className="w-3 h-3" />
                                            Copy
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="mt-2 text-xs text-destructive">
                                        {proxyStatus.lastError || "Proxy server is not running"}
                                    </div>
                                )}

                                {proxyStatus.fallbackApplied && (
                                    <div className="mt-1.5 text-[10px] text-amber-500/90 leading-tight">
                                        Requested {proxyStatus.requestedAddress} was busy; fell back to {proxyStatus.boundAddress}.
                                    </div>
                                )}
                            </div>

                            <div className="p-1">
                                {proxyStatus.boundAddress && (
                                    <button
                                        type="button"
                                        onClick={handleCopyProxySocket}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                                    >
                                        <ClipboardCopy className="w-3.5 h-3.5 text-primary" />
                                        <span>Copy Socket Address</span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => {
                                        setProxyDropdownOpen(false)
                                        navigate("/settings")
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                                >
                                    <Settings className="w-3.5 h-3.5 text-primary" />
                                    <span>Proxy Settings...</span>
                                </button>

                                {!proxyStatus.isRunning && (
                                    <button
                                        type="button"
                                        disabled={isRestartingProxy}
                                        onClick={handleRestartProxy}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-primary hover:bg-accent rounded transition-colors"
                                    >
                                        {isRestartingProxy ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <RotateCcw className="w-3.5 h-3.5" />
                                        )}
                                        <span>{isRestartingProxy ? "Starting..." : "Start Proxy Listener"}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Project Dropdown Switcher ── */}
                <div className="relative" ref={projectDropdownRef}>
                    <button
                        type="button"
                        onClick={() => {
                            setProjectDropdownOpen((v) => !v)
                            setScopeDropdownOpen(false)
                            setProxyDropdownOpen(false)
                        }}
                        className={cn(
                            "flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-medium transition-all select-none",
                            activeProject
                                ? "border-border bg-accent/60 text-foreground hover:bg-accent"
                                : "border-border/50 bg-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40"
                        )}
                        title={activeProject ? `Active Project: ${activeProject.name}` : "No active project"}
                    >
                        <FolderOpen className="w-3 h-3 shrink-0 text-primary" />
                        <span className={cn("max-w-[120px] truncate", activeProject ? "text-foreground" : "text-muted-foreground/60")}>
                            {activeProject ? activeProject.name : "Select Project"}
                        </span>
                        <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
                    </button>

                    {/* Project dropdown */}
                    {projectDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 z-50 w-60 rounded-md border border-border bg-popover shadow-xl py-1 text-[11px] divide-y divide-border/30">
                            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none flex items-center justify-between">
                                <span>Projects</span>
                                <span className="text-[9px] font-normal">{projects.length} available</span>
                            </div>

                            <div className="max-h-60 overflow-y-auto py-1">
                                {projects.map((proj) => (
                                    <button
                                        key={proj.id}
                                        type="button"
                                        onClick={() => handleSwitchProject(proj.id)}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left transition-colors",
                                            proj.id === currentProjectId ? "text-primary font-medium bg-primary/10" : "text-foreground",
                                            proj.exists === false && "opacity-60"
                                        )}
                                    >
                                        <FolderOpen className={cn("w-3.5 h-3.5 shrink-0", proj.id === currentProjectId ? "text-primary" : "text-muted-foreground")} />
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className={cn("truncate", proj.exists === false && "line-through text-muted-foreground")}>{proj.name}</span>
                                                {proj.exists === false && (
                                                    <span className="text-[9px] text-destructive bg-destructive/10 px-1 rounded font-normal shrink-0">missing</span>
                                                )}
                                            </div>
                                            {proj.description && (
                                                <span className="text-[9.5px] text-muted-foreground truncate">{proj.description}</span>
                                            )}
                                        </div>
                                        {proj.id === currentProjectId && <Check className="w-3 h-3 ml-auto text-primary shrink-0" />}
                                    </button>
                                ))}

                                {projects.length === 0 && (
                                    <div className="px-3 py-2 text-muted-foreground/60 text-center italic">
                                        No projects found
                                    </div>
                                )}
                            </div>

                            <div className="p-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProjectDropdownOpen(false)
                                        navigate("/projects")
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                                >
                                    <Library className="w-3.5 h-3.5 text-primary" />
                                    <span>Manage Projects...</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Scope Indicator ── */}
                <div className="relative" ref={scopeDropdownRef}>
                    <button
                        type="button"
                        onClick={() => {
                            setScopeDropdownOpen((v) => !v)
                            setProjectDropdownOpen(false)
                            setProxyDropdownOpen(false)
                        }}
                        className={cn(
                            "flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-medium transition-all select-none",
                            activeScope
                                ? "border-border bg-accent/60 text-foreground hover:bg-accent"
                                : "border-border/50 bg-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40"
                        )}
                        title={activeScope ? `Active scope: ${activeScope.name}` : "No active scope"}
                    >
                        {activeScope ? (
                            <span
                                className="w-2 h-2 rounded-full shrink-0 ring-1 ring-inset ring-white/20"
                                style={{ backgroundColor: activeScope.color }}
                            />
                        ) : (
                            <CircleDot className="w-2.5 h-2.5 shrink-0 text-muted-foreground/50" />
                        )}
                        <span className={cn("max-w-[120px] truncate", activeScope ? "text-foreground" : "text-muted-foreground/60")}>
                            {activeScope ? activeScope.name : "No Scope"}
                        </span>
                        <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
                    </button>

                    {/* Scope dropdown */}
                    {scopeDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 z-50 w-52 rounded-md border border-border bg-popover shadow-lg py-1 text-[11px]">
                            {/* No scope option */}
                            <button
                                type="button"
                                onClick={() => {
                                    if (projectId) dispatch(setActiveScope({ scopeId: null, projectId }))
                                    setScopeDropdownOpen(false)
                                }}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left transition-colors",
                                    activeScopeId === null ? "text-primary font-medium" : "text-muted-foreground"
                                )}
                            >
                                <CircleDot className="w-2.5 h-2.5 shrink-0" />
                                <span>No Scope (all traffic)</span>
                                <span className="ml-auto flex items-center">{activeScopeId === null && <Check className="w-2.5 h-2.5" />}</span>
                            </button>

                            {allScopes.length > 0 && (
                                <div className="my-1 h-px bg-border/50 mx-2" />
                            )}

                            {allScopes.map((scope) => (
                                <button
                                    key={scope.id}
                                    type="button"
                                    onClick={() => {
                                        if (projectId) dispatch(setActiveScope({ scopeId: scope.id, projectId }))
                                        setScopeDropdownOpen(false)
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left transition-colors",
                                        scope.id === activeScopeId ? "text-foreground font-medium" : "text-muted-foreground"
                                    )}
                                >
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0 ring-1 ring-inset ring-white/20"
                                        style={{ backgroundColor: scope.color }}
                                    />
                                    <span className="flex-1 truncate">{scope.name}</span>
                                    {scope.id === activeScopeId && <Check className="w-2.5 h-2.5 ml-auto shrink-0" />}
                                </button>
                            ))}

                            {allScopes.length === 0 && (
                                <div className="px-3 py-2 text-muted-foreground/50 text-center">
                                    No scopes defined
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Settings Page Button ── */}
                <button
                    type="button"
                    onClick={() => navigate("/settings")}
                    className={cn(
                        "flex items-center justify-center h-6 w-6 rounded-md border text-[11px] font-medium transition-all select-none",
                        location.pathname === "/settings"
                            ? "border-primary bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    )}
                    title="Settings"
                    aria-label="Settings"
                >
                    <Settings className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Window controls: minimize, maximize/restore, close */}
            <div className="flex items-center shrink-0">
                <button
                    type="button"
                    aria-label="Minimize"
                    onClick={handleMinimize}
                    className="flex h-7 w-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                    <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                    onClick={handleMaximizeToggle}
                    className="flex h-7 w-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                    {isMaximized ? (
                        <Copy className="h-3 w-3" />
                    ) : (
                        <Square className="h-3 w-3" />
                    )}
                </button>
                <button
                    type="button"
                    aria-label="Close"
                    onClick={handleClose}
                    className="flex h-7 w-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <InstallCertificateDialog open={certDialogOpen} onOpenChange={setCertDialogOpen} />
            <AddCustomCertDialog open={customCertDialogOpen} onOpenChange={setCustomCertDialogOpen} />
            <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />

            {/* ── Regenerate CA Confirmation Dialog ── */}
            <Dialog open={regenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
                <DialogContent className="sm:max-w-[460px]">
                    <DialogHeader className="gap-1">
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <RotateCcw className="size-5 shrink-0" />
                            Regenerate / Reset CA Certificates?
                        </DialogTitle>
                        <DialogDescription className="text-sm pt-2 text-muted-foreground">
                            This will permanently delete the current Aresius Root CA certificate and private key, and generate a new one.
                            <br /><br />
                            Active proxy TLS sessions will be invalidated, and you will need to install and trust the new certificate in your operating system / browser store.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 mt-4">
                        <Button
                            variant="outline"
                            onClick={() => setRegenerateConfirmOpen(false)}
                            disabled={isRegenerating}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleRegenerateCA}
                            disabled={isRegenerating}
                            className="gap-2"
                        >
                            {isRegenerating && <Loader2 className="size-4 animate-spin" />}
                            {isRegenerating ? "Regenerating..." : "Regenerate Certificate"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}