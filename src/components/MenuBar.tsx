import {
    Menubar,
    MenubarCheckboxItem,
    MenubarContent,
    MenubarGroup,
    MenubarItem,
    MenubarMenu,
    MenubarRadioGroup,
    MenubarRadioItem,
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
import { Minus, Square, Copy, X, Sun, Moon, Laptop, Check, ChevronDown, CircleDot } from "lucide-react"
import InstallCertificateDialog from "./InstallCert"
import { open } from "@tauri-apps/plugin-shell";
import { useTheme } from "./theme-provider";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { selectAllScopes, selectActiveScope, selectActiveScopeId, setActiveScope } from "@/store/slices/scopeSlice";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow()

export default function MenubarDemo() {
    const [isMaximized, setIsMaximized] = useState(false)
    const { theme, setTheme } = useTheme()

    // Scope state
    const dispatch = useAppDispatch();
    const allScopes = useAppSelector(selectAllScopes);
    const activeScope = useAppSelector(selectActiveScope);
    const activeScopeId = useAppSelector(selectActiveScopeId);
    const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false);
    const scopeDropdownRef = useRef<HTMLDivElement>(null);

    // Close scope dropdown on outside click
    useEffect(() => {
        if (!scopeDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
                setScopeDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [scopeDropdownOpen]);

    useEffect(() => {
        // Set initial state
        appWindow.isMaximized().then(setIsMaximized)

        // Keep icon in sync if window is resized/maximized via OS controls,
        // double-click on title bar, snapping, etc.
        const unlistenPromise = appWindow.onResized(async () => {
            setIsMaximized(await appWindow.isMaximized())
        })

        return () => {
            unlistenPromise.then((unlisten) => unlisten())
        }
    }, [])

    const handleMinimize = () => appWindow.minimize()

    const handleMaximizeToggle = async () => {
        await appWindow.toggleMaximize()
        setIsMaximized(await appWindow.isMaximized())
    }

    const handleClose = () => appWindow.close()

    const [certDialogOpen, setCertDialogOpen] = useState(false)

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
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarContent>
                        <MenubarGroup>
                            <MenubarItem>
                                New Tab <MenubarShortcut>⌘T</MenubarShortcut>
                            </MenubarItem>
                            <MenubarItem>
                                New Window <MenubarShortcut>⌘N</MenubarShortcut>
                            </MenubarItem>
                            <MenubarItem disabled>New Incognito Window</MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarSub>
                                <MenubarSubTrigger>Share</MenubarSubTrigger>
                                <MenubarSubContent>
                                    <MenubarGroup>
                                        <MenubarItem>Email link</MenubarItem>
                                        <MenubarItem>Messages</MenubarItem>
                                        <MenubarItem>Notes</MenubarItem>
                                    </MenubarGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem>
                                Print... <MenubarShortcut>⌘P</MenubarShortcut>
                            </MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

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
                            <MenubarSub>
                                <MenubarSubTrigger>Find</MenubarSubTrigger>
                                <MenubarSubContent>
                                    <MenubarGroup>
                                        <MenubarItem>Search the web</MenubarItem>
                                    </MenubarGroup>
                                    <MenubarSeparator />
                                    <MenubarGroup>
                                        <MenubarItem>Find...</MenubarItem>
                                        <MenubarItem>Find Next</MenubarItem>
                                        <MenubarItem>Find Previous</MenubarItem>
                                    </MenubarGroup>
                                </MenubarSubContent>
                            </MenubarSub>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem>Cut</MenubarItem>
                            <MenubarItem>Copy</MenubarItem>
                            <MenubarItem>Paste</MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarContent className="w-48">
                        <MenubarGroup>
                            <MenubarSub>
                                <MenubarSubTrigger className="gap-2">
                                    {theme === 'light' ? (
                                        <Sun className="h-4 w-4 text-amber-500" />
                                    ) : theme === 'dark' ? (
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
                            <MenubarCheckboxItem>Bookmarks Bar</MenubarCheckboxItem>
                            <MenubarCheckboxItem checked>Full URLs</MenubarCheckboxItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>
                                Reload <MenubarShortcut>⌘R</MenubarShortcut>
                            </MenubarItem>
                            <MenubarItem disabled inset>
                                Force Reload <MenubarShortcut>⇧⌘R</MenubarShortcut>
                            </MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>Toggle Fullscreen</MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger>Profiles</MenubarTrigger>
                    <MenubarContent>
                        <MenubarRadioGroup value="benoit">
                            <MenubarRadioItem value="andy">Andy</MenubarRadioItem>
                            <MenubarRadioItem value="benoit">Benoit</MenubarRadioItem>
                            <MenubarRadioItem value="Luis">Luis</MenubarRadioItem>
                        </MenubarRadioGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>Edit...</MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>Add Profile...</MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger>Certificate</MenubarTrigger>
                    <MenubarContent>
                        <MenubarGroup>
                            <MenubarItem
                                onSelect={(event) => {
                                    event.preventDefault()
                                    setCertDialogOpen(true)
                                }}

                            >Install Certificate</MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem>Reset All Aresius Certificates</MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Help</MenubarTrigger>
                    <MenubarContent>

                        <MenubarGroup >
                            <MenubarItem onSelect={() => open("https://github.com/0xMarik/Aresius/issues")}>Report Bugs?...</MenubarItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup >
                            <MenubarItem>
                                About
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
                        'flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-medium transition-all select-none',
                        activeScope
                            ? 'border-border bg-accent/60 text-foreground hover:bg-accent'
                            : 'border-border/50 bg-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40'
                    )}
                    title={activeScope ? `Active scope: ${activeScope.name}` : 'No active scope'}
                >
                    {activeScope ? (
                        <span
                            className="w-2 h-2 rounded-full shrink-0 ring-1 ring-inset ring-white/20"
                            style={{ backgroundColor: activeScope.color }}
                        />
                    ) : (
                        <CircleDot className="w-2.5 h-2.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className={activeScope ? 'text-foreground' : 'text-muted-foreground/60'}>
                        {activeScope ? activeScope.name : 'No Scope'}
                    </span>
                    <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/60" />
                </button>

                {/* Scope dropdown */}
                {scopeDropdownOpen && (
                    <div className="absolute top-full right-0 mt-1 z-50 w-52 rounded-md border border-border bg-popover shadow-lg py-1 text-[11px]">
                        {/* No scope option */}
                        <button
                            type="button"
                            onClick={() => { dispatch(setActiveScope(null)); setScopeDropdownOpen(false); }}
                            className={cn(
                                'w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left transition-colors',
                                activeScopeId === null ? 'text-primary font-medium' : 'text-muted-foreground'
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
                                onClick={() => { dispatch(setActiveScope(scope.id)); setScopeDropdownOpen(false); }}
                                className={cn(
                                    'w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left transition-colors',
                                    scope.id === activeScopeId ? 'text-foreground font-medium' : 'text-muted-foreground'
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
        </div>
    )
}