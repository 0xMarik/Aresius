import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, AlertCircle } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useAppDispatch } from "@/hooks/redux"
import { addProject } from "@/store/slices/projectSlice"
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Project } from "@/types/project.type"

const AddProjectDialog = () => {
    const dispatch = useAppDispatch()
    const [open, setOpen] = useState<boolean>(false)
    const [projectName, setProjectName] = useState<string>("New project")
    const [isTemporary, setIsTemporary] = useState<boolean>(false)
    const [defaultDir, setDefaultDir] = useState<string>("")
    const [customPath, setCustomPath] = useState<string>("")
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(false)

    useEffect(() => {
        if (open) {
            setError(null)
            invoke<string>("get_default_project_dir")
                .then((dir) => {
                    setDefaultDir(dir)
                })
                .catch((err) => console.error("Failed to get default project dir:", err))
        }
    }, [open])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setError(null)
        if (!projectName.trim()) {
            setError("Project name cannot be empty")
            return
        }

        const sanitizedName = projectName.trim()
        const baseDir = customPath.trim() || defaultDir
        const targetPath = `${baseDir}${baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : '\\'}${sanitizedName}.ares`

        setLoading(true)
        try {
            const project = await invoke<Project>("create_project", {
                path: targetPath,
                name: sanitizedName,
                temporary: isTemporary,
            })

            dispatch(addProject(project))
            setOpen(false)
            setProjectName("New project")
            setIsTemporary(false)
            setCustomPath("")
        } catch (err: any) {
            setError(typeof err === "string" ? err : err?.message || "Failed to create project")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="default">
                    <Plus className="mr-1 size-4" /> Add new project
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[440px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add new Project</DialogTitle>
                        <DialogDescription>
                            Create a new Aresius project (.ares). The project file will be initialized and stored on catalog.
                        </DialogDescription>
                    </DialogHeader>

                    {error && (
                        <div className="my-2 p-2.5 rounded border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                            <AlertCircle className="size-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="grid gap-4 py-3">
                        <div className="grid gap-2">
                            <Label htmlFor="project-name">Project name</Label>
                            <Input
                                id="project-name"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                placeholder="e.g. Target App Audit"
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="project-folder">Directory Location</Label>
                            <Input
                                id="project-folder"
                                value={customPath || defaultDir}
                                onChange={(e) => setCustomPath(e.target.value)}
                                placeholder="Default project directory"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Will save to: <code className="text-foreground">{`${customPath.trim() || defaultDir || '...'}\\${projectName.trim() || 'project'}.ares`}</code>
                            </p>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            <Checkbox
                                id="temporary"
                                checked={isTemporary}
                                onCheckedChange={(checked) => setIsTemporary(!!checked)}
                            />
                            <Label htmlFor="temporary" className="text-xs cursor-pointer">
                                Mark as temporary project
                            </Label>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={loading}>
                                Cancel
                            </Button>
                        </DialogClose>
                        <Button type="submit" disabled={loading}>
                            {loading ? "Creating..." : "Create Project"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default AddProjectDialog
