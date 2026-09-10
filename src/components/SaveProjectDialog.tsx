import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, Save, Loader2 } from "lucide-react"
import { useAppDispatch } from "@/hooks/redux"
import { updateProject } from "@/store/slices/projectSlice"
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Project } from "@/types/project.type"
import { toast } from "sonner"

interface SaveProjectDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    project: Project | null
    onSaved?: (project: Project) => void
}

export default function SaveProjectDialog({
    open,
    onOpenChange,
    project,
    onSaved,
}: SaveProjectDialogProps) {
    const dispatch = useAppDispatch()
    const [projectName, setProjectName] = useState<string>("")
    const [customDir, setCustomDir] = useState<string>("")
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(false)

    useEffect(() => {
        if (open && project) {
            setProjectName(project.name)
            setError(null)

            // Extract directory from current project.path
            const p = project.path || ""
            const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
            if (lastSlash > 0) {
                setCustomDir(p.substring(0, lastSlash))
            } else {
                invoke<string>("get_default_project_dir")
                    .then((dir) => setCustomDir(dir))
                    .catch(() => {})
            }
        }
    }, [open, project])

    if (!project) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        const sanitizedName = projectName.trim()
        if (!sanitizedName) {
            setError("Project name cannot be empty")
            return
        }

        const rawDir = customDir.trim()
        const isWindows = rawDir.includes("\\") && !rawDir.includes("/")
        const sep = isWindows ? "\\" : "/"
        const cleanBase = rawDir.replace(/[/\\]+$/, "")
        const targetPath = `${cleanBase}${sep}${sanitizedName}.ares`

        setLoading(true)
        try {
            const updated = await invoke<Project>("save_temporary_project", {
                id: project.id,
                newName: sanitizedName,
                newPath: targetPath,
            })

            dispatch(updateProject(updated))
            toast.success(`Project "${updated.name}" saved as permanent project`)
            onOpenChange(false)
            if (onSaved) {
                onSaved(updated)
            }
        } catch (err: any) {
            setError(typeof err === "string" ? err : err?.message || "Failed to save project")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[460px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <div className="flex items-center gap-2 text-primary">
                            <Save className="size-5 shrink-0" />
                            <DialogTitle>Save as Permanent Project</DialogTitle>
                        </div>
                        <DialogDescription className="text-xs pt-1">
                            Convert this temporary project to a permanent Aresius project file. All session data, HTTP history, and sitemaps will be preserved on disk.
                        </DialogDescription>
                    </DialogHeader>

                    {error && (
                        <div className="my-3 p-2.5 rounded border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                            <AlertCircle className="size-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="grid gap-4 py-3">
                        <div className="grid gap-2">
                            <Label htmlFor="save-project-name" className="text-xs">Project Name</Label>
                            <Input
                                id="save-project-name"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                placeholder="Permanent project name"
                                autoFocus
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="save-project-folder" className="text-xs">Save Directory</Label>
                            <Input
                                id="save-project-folder"
                                value={customDir}
                                onChange={(e) => setCustomDir(e.target.value)}
                                placeholder="Directory path"
                            />
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                                Will save to: <code className="text-foreground">{`${customDir.replace(/[/\\]+$/, "")}${(customDir.includes('\\') && !customDir.includes('/')) ? '\\' : '/'}${projectName.trim() || 'project'}.ares`}</code>
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <DialogClose asChild>
                            <Button type="button" variant="outline" size="sm" disabled={loading}>
                                Cancel
                            </Button>
                        </DialogClose>
                        <Button type="submit" size="sm" disabled={loading} className="gap-1.5">
                            {loading && <Loader2 className="size-3.5 animate-spin" />}
                            <Save className="size-3.5" />
                            {loading ? "Saving..." : "Save Project"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
