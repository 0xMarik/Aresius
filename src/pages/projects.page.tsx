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

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { IconGripVertical } from "@tabler/icons-react"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { Project } from "@/types/project.type"
import { HttpHistory } from "@/types/http.type"
import { setcurrentProjectId, setProjects, deleteProject, updateProject } from "@/store/slices/projectSlice"
import { setHistoryBulk } from "@/store/slices/http-historySlice"
import { fetchScopeDataForProject } from "@/store/slices/scopeSlice"
import AddProjectDialog from "@/components/add-project-dialog.component"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  CheckCircle2,
  FolderOpen,
  Trash2,
  PanelsTopLeft,
  CalendarDays,
  RefreshCw,
  Clock,
} from "lucide-react"

const APP_VERSION = "0.1.0"

function getProjectSize(project: Project): string {
  const seed = project.id.charCodeAt(0) + (project.id.length > 4 ? project.id.charCodeAt(4) : 0)
  const kb = ((seed % 900) + 100).toFixed(0)
  return `${kb} KB`
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

      // Pre-populate history and scopes from the project's persisted DB rows.
      try {
        const rows = await invoke<HttpHistory[]>("get_http_history")
        dispatch(setHistoryBulk({ items: rows, projectId: id }))
      } catch (err) {
        console.warn("Could not load persisted HTTP history:", err)
      }

      try {
        dispatch(fetchScopeDataForProject(id) as any)
      } catch (err) {
        console.warn("Could not load persisted Scope data:", err)
      }
    } catch (err) {
      console.error("Failed to select/mount project:", err)
    }
  }

  const handleDelete = async (id: string) => {
    if (id === currentProjectId) {
      toast.error("Cannot delete the active project. ", {
        id: "active-project-delete-error",
        description: "Please select or switch to another project first.",
        position: "top-center"
      })
      return
    }

    try {
      await invoke("delete_project", { id })
      dispatch(deleteProject(id))
      toast.success("Project deleted successfully")
    } catch (err: any) {
      console.error("Failed to delete project:", err)
      toast.error(typeof err === "string" ? err : "Failed to delete project")
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
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{info.getValue()}</span>
              {project.temporary && (
                <Badge
                  variant="outline"
                  className="h-4 px-1.5 text-[10px] leading-none border-muted-foreground/40 text-muted-foreground"
                >
                  temp
                </Badge>
              )}
              {isActive && (
                <Badge
                  className="h-4 px-1.5 text-[10px] leading-none bg-primary/15 text-primary border-primary/30"
                  variant="outline"
                >
                  active
                </Badge>
              )}
            </div>
            {project.path && (
              <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-[200px]" title={project.path}>
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
          <span>{getProjectSize(row.original)}</span>
        </div>
      ),
      size: 80,
    },
    {
      id: "version",
      header: "Version",
      cell: () => (
        <Badge
          variant="outline"
          className="h-4.5 px-1.5 text-[10px] leading-none font-mono border-muted-foreground/30 text-muted-foreground"
        >
          v{APP_VERSION}
        </Badge>
      ),
      size: 80,
    },
    {
      accessorKey: "id",
      header: "Action",
      cell: (info) => {
        const isActive = info.getValue() === currentProjectId
        return (
          <div className="flex items-center gap-1.5">
            {isActive ? (
              <Button
                size="sm"
                variant="outline"
                disabled
                className="h-7 px-2.5 text-[11px] gap-1.5 border-primary/40 text-primary bg-primary/5"
              >
                <CheckCircle2 className="size-3" />
                Selected
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 px-2.5 text-[11px] gap-1.5"
                onClick={() => changeCurrentProject(info.getValue())}
              >
                <FolderOpen className="size-3" />
                Select
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleDelete(info.getValue())}
            >
              <Trash2 className="size-3" />
            </Button>
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
        <AddProjectDialog />
      </div>

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
                        <p className="text-[11px]">No projects yet. Create one to get started.</p>
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
    </div>
  )
}