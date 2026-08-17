import {
    Menubar,
    MenubarContent,
    MenubarGroup,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarShortcut,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger,
} from "@/components/ui/menubar"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import { useEffect, useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
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
    Save,
    Shield,
    Upload,
    Download,
    ClipboardCopy,
    RotateCcw,
    Maximize2,
    Minimize2,
    RotateCw,
    Bug,
    Info,
} from "lucide-react"
import InstallCertificateDialog from "./InstallCert"
import AboutDialog from "./AboutDialog"
import { open } from "@tauri-apps/plugin-shell"
import { useTheme } from "./theme-provider"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { useProjectId } from "@/hooks/useProjectId"
import { selectAllScopes, selectActiveScope, selectActiveScopeId, setActiveScope } from "@/store/slices/scopeSlice"
import { cn } from "@/lib/utils"

const appWindow = getCurrentWindow()

export default function MenubarDemo() {
    const [isMaximized, setIsMaximized] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const { theme, setTheme } = useTheme()

    // Dialog states
    const [certDialogOpen, setCertDialogOpen] = useState(false)
    const [aboutDialogOpen, setAboutDialogOpen] = useState(false)

    // Scope state
    const dispatch = useAppDispatch()
    const projectId = useProjectId()
    const allScopes = useAppSelector(selectAllScopes(projectId))
    const activeScope = useAppSelector(selectActiveScope(projectId))
    const activeScopeId = useAppSelector(selectActiveScopeId(projectId))
    const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false)
    const scopeDropdownRef = useRef<HTMLDivElement>(null)

    // Close scope dropdown on outside click
    useEffect(() => {
        if (!scopeDropdownOpen) return
        const handler = (e: MouseEvent) => {
            if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
                setScopeDropdownOpen(false)
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [scopeDropdownOpen])

    useEffect(() => {
        // Set initial window state
        appWindow.isMaximized().then(setIsMaximized).catch(() => {})
        appWindow.isFullscreen().then(setIsFullscreen).catch(() => {})

        // Keep icon in sync if window is resized/maximized via OS controls,
        // double-click on title bar, snapping, etc.
        const unlistenPromise = appWindow.onResized(async () => {
            try {
                setIsMaximized(await appWindow.isMaximized())
                setIsFullscreen(await appWindow.isFullscreen())
            } catch {}
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

    // F11 & Escape key listeners for fullscreen toggle
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
                } catch {}
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])

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
                            <MenubarItem className="gap-2">
                                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Open Project (.ares)</span>
                                <MenubarShortcut>⌘O</MenubarShortcut>
                            </MenubarItem>
                            <MenubarItem className="gap-2">
                                <Library className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Open Project Catalog</span>
                            </MenubarItem>
                            <MenubarSub>
                                <MenubarSubTrigger className="gap-2">
                                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Recent Projects</span>
                                </MenubarSubTrigger>
                                <MenubarSubContent className="w-48">
                                    <MenubarGroup>
                                        <MenubarItem disabled className="text-xs text-muted-foreground italic">
                                            No recent projects
                                        </MenubarItem>
                                    </MenubarGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem className="gap-2">
                                <Save className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Save Project in...</span>
                                <MenubarShortcut>⌘S</MenubarShortcut>
                            </MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                {/* ── Edit Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>Edit</MenubarTrigger>
                    <MenubarContent>
                        <MenubarGroup>
                            <MenubarItem>
                                Undo <MenubarShortcut>⌘Z</MenubarShortcut>
                            </MenubarItem>
                            <MenubarItem>
                                Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem>Cut <MenubarShortcut>⌘X</MenubarShortcut></MenubarItem>
                            <MenubarItem>Copy <MenubarShortcut>⌘C</MenubarShortcut></MenubarItem>
                            <MenubarItem>Paste <MenubarShortcut>⌘V</MenubarShortcut></MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                {/* ── View Menu ── */}
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarContent className="w-52">
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
                                <MenubarShortcut>F11</MenubarShortcut>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem onClick={() => window.location.reload()} className="gap-2 justify-between">
                                <span className="flex items-center gap-2">
                                    <RotateCw className="h-3.5 w-3.5 text-muted-foreground" />
                                    Reload
                                </span>
                                <MenubarShortcut>⌘R</MenubarShortcut>
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
                            <MenubarItem className="gap-2">
                                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Import Custom Root CA...</span>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem className="gap-2">
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Export Root CA Certificate</span>
                            </MenubarItem>
                            <MenubarItem className="gap-2">
                                <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Copy CA File Path to Clipboard</span>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem className="gap-2 text-destructive focus:text-destructive">
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

            {/* ── Scope Indicator ── */}
            <div className="ml-auto flex items-center shrink-0 mr-2 relative" ref={scopeDropdownRef}>
                <button
                    type="button"
                    onClick={() => setScopeDropdownOpen((v) => !v)}
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
                    <span className={activeScope ? "text-foreground" : "text-muted-foreground/60"}>
                        {activeScope ? activeScope.name : "No Scope"}
                    </span>
                    <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/60" />
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
                            {activeScopeId === null && <Check className="w-2.5 h-2.5 ml-auto" />}
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
            <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
        </div>
    )
}