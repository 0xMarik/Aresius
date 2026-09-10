import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { IconGripVertical } from "@tabler/icons-react"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { Project } from "@/types/project.type"
import { HttpHistorySummaryRow } from "@/types/http.type"
import { addProject, setcurrentProjectId, setProjects, deleteProject, updateProject } from "@/store/slices/projectSlice"
import { setSiteMapBulk, fetchSitemapStateForProject } from "@/store/slices/sitemapSlice"
import { fetchScopeDataForProject } from "@/store/slices/scopeSlice"
import { fetchMatchReplaceDataForProject } from "@/store/slices/matchReplaceSlice"
import AddProjectDialog from "@/components/add-project-dialog.component"
import SaveProjectDialog from "@/components/SaveProjectDialog"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  CheckCircle2,
  FolderOpen,
  Trash2,
  PanelsTopLeft,
  CalendarDays,
  RefreshCw,
  Clock,
  AlertTriangle,
  FileQuestion,
  FileSearch,
  MoreHorizontal,
  Copy,
  Pencil,
  Save,
} from "lucide-react"


/** Format raw bytes into a human-readable KB / MB string. */
function formatSize(bytes: number): string {
  if (bytes === 0) return "—"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DragHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef } = useSortable({
    id,
    disabled: false,
  })

  return (
    <Button
      ref={setNodeRef}
      variant="ghost"
      size="icon"
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing touch-none h-7 w-7 text-muted-foreground hover:text-foreground"
    >
      <IconGripVertical className="size-3.5" />
    </Button>
  )
}

function DraggableRow({ row, isActive }: { row: any; isActive: boolean }) {
  const {
    transform,
    transition,
    setNodeRef,
    isDragging,
    attributes,
    listeners,
    setActivatorNodeRef,
  } = useSortable({
    id: row.original.id,
  })

  return (
    <TableRow
      ref={setNodeRef}
      data-dragging={isDragging}
      data-active={isActive}
      className={`
        relative group transition-colors duration-100
        ${isDragging ? "z-50 opacity-50 bg-muted" : ""}
        ${isActive ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"}
      `}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
    >
      {row.getVisibleCells().map((cell: any) => (
        <TableCell key={cell.id} className="py-2.5">
          {cell.column.id === "drag" ? (
            <div ref={setActivatorNodeRef} {...listeners}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          ) : (
            flexRender(cell.column.columnDef.cell, cell.getContext())
          )}
        </TableCell>
      ))}
    </TableRow>
  )
}

export default function Projects() {
  const { projects, currentProjectId } = useAppSelector((state) => state.workspacestate)
  const dispatch = useAppDispatch()

  const changeCurrentProject = async (id: string) => {
    try {
      const updatedProject = await invoke<Project>("select_project", { id })
      dispatch(setcurrentProjectId(id))
      dispatch(updateProject(updatedProject))

      // Pre-populate sitemap summaries from the project's persisted DB rows.
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
    } catch (err) {
      console.error("Failed to select/mount project:", err)
    }
  }

  const handleOpenProject = async () => {
    try {
      const opened = await invoke<Project | null>("open_project_file", { filePath: null })
      if (!opened) return

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

      try { dispatch(fetchScopeDataForProject(opened.id) as any) } catch {}
      try { dispatch(fetchSitemapStateForProject(opened.id) as any) } catch {}
      try { dispatch(fetchMatchReplaceDataForProject(opened.id) as any) } catch {}

      toast.success(`Project "${opened.name}" opened successfully`)
    } catch (err: any) {
      console.error("Failed to open project file:", err)
      toast.error(typeof err === "string" ? err : err?.message || "Failed to open project file")
    }
  }

  const handleRelocateProject = async (id: string) => {
    try {
      const relocated = await invoke<Project | null>("relocate_project", { id, newPath: null })
      if (!relocated) return

      const updatedList = projects
        .filter((p) => p.id !== id && p.id !== relocated.id)
        .concat(relocated)
      dispatch(setProjects(updatedList))
      dispatch(setcurrentProjectId(relocated.id))

      try {
        const summaries = await invoke<HttpHistorySummaryRow[]>("get_http_history_summaries", { projectId: relocated.id })
        dispatch(setSiteMapBulk({ items: summaries, projectId: relocated.id }))
      } catch (err) {
        console.warn("Could not load persisted HTTP history summaries:", err)
      }

      try { dispatch(fetchScopeDataForProject(relocated.id) as any) } catch {}
      try { dispatch(fetchSitemapStateForProject(relocated.id) as any) } catch {}
      try { dispatch(fetchMatchReplaceDataForProject(relocated.id) as any) } catch {}

      toast.success(`Project relocated to "${relocated.path}" and opened successfully`)
    } catch (err: any) {
      console.error("Failed to relocate project:", err)
      toast.error(typeof err === "string" ? err : err?.message || "Failed to relocate project")
    }
  }

  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [projectToSave, setProjectToSave] = useState<Project | null>(null)

  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState("")
  const [isSavingRename, setIsSavingRename] = useState(false)

  const handleStartRename = (project: Project) => {
    setRenamingProjectId(project.id)
    setRenamingName(project.name)
  }

  const handleCancelRename = () => {
    setRenamingProjectId(null)
    setRenamingName("")
  }

  const handleSaveRename = async (projectId: string) => {
    const trimmed = renamingName.trim()
    if (!trimmed) {
      toast.error("Project name cannot be empty")
      return
    }

    const currentProj = projects.find((p) => p.id === projectId)
    if (currentProj && currentProj.name === trimmed) {
      setRenamingProjectId(null)
      return
    }

    setIsSavingRename(true)
    try {
      const updated = await invoke<Project>("update_project_details", {
        id: projectId,
        name: trimmed,
        description: currentProj?.description || "",
      })

      dispatch(updateProject(updated))
      setRenamingProjectId(null)
    } catch (err: any) {
      console.error("Failed to rename project:", err)
      toast.error(typeof err === "string" ? err : err?.message || "Failed to rename project")
    } finally {
      setIsSavingRename(false)
    }
  }

  const handleCopyPath = async (path: string) => {
    try {
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
      toast.success("Project path copied to clipboard")
    } catch {
      toast.error("Failed to copy path to clipboard")
    }
  }

  const confirmDelete = async () => {
    if (!projectToDelete) return
    setIsDeleting(true)
    try {
      await invoke("delete_project", { id: projectToDelete.id })
      dispatch(deleteProject(projectToDelete.id))
      toast.success(`Project "${projectToDelete.name}" deleted successfully`)
      setProjectToDelete(null)
    } catch (err: any) {
      console.error("Failed to delete project:", err)
      toast.error(typeof err === "string" ? err : "Failed to delete project")
    } finally {
      setIsDeleting(false)
    }
  }

  const data = projects
  const projectsIds = projects.map((item) => item.id)

  const columns: ColumnDef<Project, any>[] = [
    {
      id: "drag",
      header: () => null,
      cell: ({ row }) => <DragHandle id={row.original.id} />,
      size: 40,
    },
    {
      accessorKey: "name",
      header: "Project",
      cell: (info) => {
        const project = info.row.original
        const isActive = project.id === currentProjectId
        const isMissing = project.exists === false
        const isRenaming = renamingProjectId === project.id

        if (isRenaming) {
          return (
            <div
              className="flex items-center py-0.5"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Input
                value={renamingName}
                onChange={(e) => setRenamingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleSaveRename(project.id)
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    handleCancelRename()
                  }
                }}
                onBlur={() => handleSaveRename(project.id)}
                autoFocus
                disabled={isSavingRename}
                className="h-6 px-2 py-0 text-xs font-medium max-w-[220px]"
              />
            </div>
          )
        }

        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className={cn("font-medium", isMissing ? "text-muted-foreground line-through" : "text-foreground")}>
                {info.getValue()}
              </span>
              {isMissing && (
                <Badge
                  variant="destructive"
                  className="h-4 px-1.5 text-[9.5px] leading-none gap-1 bg-destructive/15 text-destructive border-destructive/30"
                >
                  <FileQuestion className="size-2.5" />
                  missing
                </Badge>
              )}
              {project.temporary && (
                <Badge
                  variant="outline"
                  className="h-4 px-1.5 text-[9.5px] leading-none border-amber-500/40 text-amber-500 bg-amber-500/10 gap-1 font-medium"
                >
                  <Clock className="size-2.5" />
                  temporary
                </Badge>
              )}
              {isActive && !isMissing && (
                <Badge
                  className="h-4 px-1.5 text-[10px] leading-none bg-primary/15 text-primary border-primary/30"
                  variant="outline"
                >
                  active
                </Badge>
              )}
            </div>
            {project.path && (
              <span
                className={cn("text-[10px] font-mono truncate max-w-[220px]", isMissing ? "text-destructive/70 italic" : "text-muted-foreground/70")}
                title={isMissing ? `File not found on disk at: ${project.path}` : project.path}
              >
                {project.path}
              </span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "lastOpenedAt",
      header: "Last Opened",
      cell: (info) => {
        const val = info.getValue() as number | null | undefined
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3 shrink-0 text-primary/70" />
            <span>
              {val
                ? new Date(val).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
                : "Never"}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: (info) => (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="size-3 shrink-0" />
          <span>
            {info.getValue()
              ? new Date(info.getValue() as number).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
              : "—"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: (info) => (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <RefreshCw className="size-3 shrink-0" />
          <span>
            {info.getValue()
              ? new Date(info.getValue() as number).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
              : "—"}
          </span>
        </div>
      ),
    },
    {
      id: "size",
      header: "Size",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {row.original.exists === false ? (
            <span className="text-[10.5px] text-destructive/70 italic">Missing</span>
          ) : (
            <span>{formatSize(row.original.sizeBytes)}</span>
          )}
        </div>
      ),
      size: 80,
    },
    {
      id: "version",
      header: "Version",
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className="h-4.5 px-1.5 text-[10px] leading-none font-mono border-muted-foreground/30 text-muted-foreground"
        >
          v{row.original.version}
        </Badge>
      ),
      size: 80,
    },
    {
      accessorKey: "id",
      header: "Action",
      cell: (info) => {
        const project = info.row.original
        const isActive = project.id === currentProjectId
        const isMissing = project.exists === false

        return (
          <div className="flex items-center gap-1.5">
            {isMissing ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px] gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400 w-24"
                onClick={() => handleRelocateProject(project.id)}
                title="Locate moved or renamed .ares file"
              >
                <FileSearch className="size-3" />
                Locate
              </Button>
            ) : isActive ? (
              <Button
                size="sm"
                variant="outline"
                disabled
                className="h-7 px-2.5 text-[11px] gap-1.5 border-primary/40 text-primary bg-primary/5 w-24"
              >
                <CheckCircle2 className="size-3" />
                Selected
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 px-2.5 text-[11px] gap-1.5 w-24"
                onClick={() => changeCurrentProject(info.getValue())}
              >
                <FolderOpen className="size-3" />
                Select
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                  title="Project options"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => handleStartRename(project)} className="gap-2 text-xs">
                  <Pencil className="size-3.5 text-muted-foreground" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCopyPath(project.path)} className="gap-2 text-xs">
                  <Copy className="size-3.5 text-muted-foreground" />
                  <span>Copy Path</span>
                </DropdownMenuItem>
                {project.temporary && (
                  <DropdownMenuItem
                    onClick={() => setProjectToSave(project)}
                    className="gap-2 text-xs text-primary focus:text-primary focus:bg-primary/10"
                  >
                    <Save className="size-3.5" />
                    <span>Save as Permanent...</span>
                  </DropdownMenuItem>
                )}
                {isMissing && (
                  <DropdownMenuItem onClick={() => handleRelocateProject(project.id)} className="gap-2 text-xs text-amber-500">
                    <FileSearch className="size-3.5 text-amber-500" />
                    <span>Relocate File...</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setProjectToDelete(project)}
                  className="gap-2 text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                  <span>{isMissing ? "Remove from Catalog" : "Delete Project"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id.toString(),
  })

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (active?.id !== over?.id && over?.id) {
      const oldIndex = data.findIndex((i) => i.id === active.id)
      const newIndex = data.findIndex((i) => i.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newData = arrayMove(data, oldIndex, newIndex)
        dispatch(setProjects(newData))
      }
    }
  }

  const currentProject = projects.find((p) => p.id === currentProjectId)

  return (
    <div className="p-4 flex flex-col gap-4 min-h-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 border border-primary/20">
            <PanelsTopLeft className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-tight">Projects</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
              {currentProject ? ` · Active: ${currentProject.name}` : " · No project selected"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenProject} className="gap-1.5 text-xs">
            <FolderOpen className="size-3.5 text-primary" /> Open (.ares)
          </Button>
          <AddProjectDialog />
        </div>
      </div>

      {/* Active Temporary Project Warning Banner */}
      {currentProject?.temporary && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            <span className="text-[11.5px] leading-tight">
              Active project <strong className="text-foreground font-semibold">&ldquo;{currentProject.name}&rdquo;</strong> is temporary. Data will be discarded upon quitting unless saved.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6.5 px-2.5 text-[11px] gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400 shrink-0"
            onClick={() => setProjectToSave(currentProject)}
          >
            <Save className="size-3" />
            Save Project
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden flex-1">
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="bg-muted/60 hover:bg-muted/60 border-b border-border">
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="h-8 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide py-0"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              <SortableContext items={projectsIds} strategy={verticalListSortingStrategy}>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FolderOpen className="size-8 opacity-30" />
                        <p className="text-[11px]">No projects yet. Create one or open an existing .ares file to get started.</p>
                        <Button variant="outline" size="sm" onClick={handleOpenProject} className="mt-1 gap-1.5 text-xs">
                          <FolderOpen className="size-3.5 text-primary" /> Open .ares project
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <DraggableRow
                      key={row.id}
                      row={row}
                      isActive={row.original.id === currentProjectId}
                    />
                  ))
                )}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              <DialogTitle>
                {projectToDelete?.exists === false ? "Remove Missing Project" : "Delete Project"}
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-xs leading-relaxed text-muted-foreground">
              {projectToDelete?.exists === false ? (
                <>
                  The project <strong className="text-foreground">{projectToDelete?.name}</strong> no longer exists at its saved location.
                  This will remove its record from the catalog.
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong className="text-foreground">{projectToDelete?.name}</strong>?
                  This will permanently remove the project and its database file from disk.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {projectToDelete && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-[11px] flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Saved Location:</span>
                <span className="font-mono text-muted-foreground/80 truncate max-w-[230px]" title={projectToDelete.path}>
                  {projectToDelete.path}
                </span>
              </div>
              {projectToDelete.exists === false && (
                <div className="text-destructive font-medium flex items-center gap-1 text-[10.5px]">
                  <FileQuestion className="size-3 shrink-0" />
                  <span>File not found on disk (may have been moved or deleted).</span>
                </div>
              )}
              {projectToDelete.id === currentProjectId && (
                <div className="pt-1 border-t border-border/40 text-amber-500 font-medium flex items-center gap-1.5 text-[10.5px]">
                  <span>Active project will be closed and deselected.</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeleting}
              onClick={() => setProjectToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={confirmDelete}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {isDeleting
                ? "Removing..."
                : projectToDelete?.exists === false
                ? "Remove from Catalog"
                : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Project Dialog */}
      <SaveProjectDialog
        open={!!projectToSave}
        onOpenChange={(open) => !open && setProjectToSave(null)}
        project={projectToSave}
      />
    </div>
  )
}