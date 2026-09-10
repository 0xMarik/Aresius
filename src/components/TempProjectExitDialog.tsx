import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Trash2, Save, Loader2 } from "lucide-react"
import { useAppSelector } from "@/hooks/redux"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"

export default function TempProjectExitDialog() {
    const { projects, currentProjectId } = useAppSelector((state) => state.workspacestate)
    const activeProject = projects.find((p) => p.id === currentProjectId) || null

    const [open, setOpen] = useState(false)
    const [isDiscarding, setIsDiscarding] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        let unlistenFn: (() => void) | undefined

        const setupListener = async () => {
            unlistenFn = await listen("temp-project-close-requested", async () => {
                if (activeProject && activeProject.temporary) {
                    setOpen(true)
                } else {
                    // No temporary project is active, proceed with graceful exit
                    try {
                        await invoke("exit_app", { discardActiveIfTemp: false })
                    } catch (err) {
                        console.error("Failed to exit app:", err)
                    }
                }
            })
        }

        setupListener()

        return () => {
            if (unlistenFn) unlistenFn()
        }
    }, [activeProject])

    const handleDiscardAndExit = async () => {
        setIsDiscarding(true)
        try {
            await invoke("exit_app", { discardActiveIfTemp: true })
        } catch (err) {
            console.error("Failed to discard temporary project and exit:", err)
            setIsDiscarding(false)
        }
    }

    const handleSaveAndExit = async () => {
        if (!activeProject) return
        setIsSaving(true)
        try {
            // Save project with its created name and existing path by default
            await invoke("save_temporary_project", {
                id: activeProject.id,
                newName: null,
                newPath: null,
            })
            // Gracefully exit after saving
            await invoke("exit_app", { discardActiveIfTemp: false })
        } catch (err) {
            console.error("Failed to save temporary project and exit:", err)
            toast.error(typeof err === "string" ? err : "Failed to save project")
            setIsSaving(false)
        }
    }

    if (!activeProject || !activeProject.temporary) {
        return null
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <div className="flex items-center gap-2.5 text-amber-500">
                        <AlertTriangle className="size-5.5 shrink-0 text-amber-500" />
                        <DialogTitle className="text-base text-foreground">
                            Unsaved Temporary Project
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs pt-2 leading-relaxed text-muted-foreground">
                        You are currently working in temporary project{" "}
                        <strong className="text-foreground font-semibold">
                            &ldquo;{activeProject.name}&rdquo;
                        </strong>
                        . If you close Aresius now without saving, this project and all recorded HTTP traffic, replays, and sitemaps will be{" "}
                        <span className="text-destructive font-semibold">permanently lost</span>.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-md border border-border/70 bg-muted/40 p-2.5 text-[11px] flex flex-col gap-1.5 my-2">
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground shrink-0 font-medium">Project Name:</span>
                        <span className="font-semibold text-foreground truncate max-w-[280px]">
                            {activeProject.name}
                        </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground shrink-0 font-medium">Saved Location:</span>
                        <span className="font-mono text-muted-foreground/90 truncate max-w-[280px]" title={activeProject.path}>
                            {activeProject.path}
                        </span>
                    </div>
                </div>

                <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-2 pt-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDiscarding || isSaving}
                        onClick={() => setOpen(false)}
                        className="text-xs"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isDiscarding || isSaving}
                        onClick={handleDiscardAndExit}
                        className="gap-1.5 text-xs"
                    >
                        {isDiscarding ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="size-3.5" />
                        )}
                        {isDiscarding ? "Closing..." : "Close & Lose Project"}
                    </Button>
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={isDiscarding || isSaving}
                        onClick={handleSaveAndExit}
                        className="gap-1.5 text-xs"
                    >
                        {isSaving ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Save className="size-3.5" />
                        )}
                        {isSaving ? "Saving..." : "Save Project & Exit"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
