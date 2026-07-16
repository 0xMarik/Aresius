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
import { useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Minus, Square, Copy, X } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import InstallCertificateDialog from "./InstallCert"

const appWindow = getCurrentWindow()

export default function MenubarDemo() {
    const [isMaximized, setIsMaximized] = useState(false)

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
            className="flex w-full items-center gap-2 border-b bg-background px-2 py-1.5"
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
                    <MenubarContent className="w-44">
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
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>Hide Sidebar</MenubarItem>
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
                        <MenubarRadioGroup value="benoit">
                            <MenubarRadioItem value="andy">Andy</MenubarRadioItem>
                            <MenubarRadioItem value="benoit">Benoit</MenubarRadioItem>
                            <MenubarRadioItem value="Luis">Luis</MenubarRadioItem>
                        </MenubarRadioGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenubarItem inset>Add Profile...</MenubarItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>

            {/* Window controls: minimize, maximize/restore, close */}
            <div className="ml-auto flex items-center shrink-0">
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