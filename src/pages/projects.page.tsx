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
import { IconGripVertical } from "@tabler/icons-react"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { Project } from "@/types/project.type"
import { setcurrentProjectId, setProjects } from "@/store/slices/projectSlice"
import AddProjectDialog from "@/components/add-project-dialog.component"

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
      className="cursor-grab active:cursor-grabbing touch-none"
    >
      <IconGripVertical className="size-4" />
    </Button>
  )
}

function DraggableRow({ row }: { row: any }) {
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
      className={`relative ${isDragging ? 'z-50 opacity-50' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
    >
      {row.getVisibleCells().map((cell: any) => (
        <TableCell key={cell.id}>
          {cell.column.id === 'drag' ? (
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

  const changeCurrentProject = (id: string) => {
    dispatch(setcurrentProjectId(id))
  }

  const data = projects;
  const projectsIds = projects.map((item) => item.id)

  const columns: ColumnDef<Project, any>[] = [
    {
      id: "drag",
      header: () => null,
      cell: ({ row }) => <DragHandle id={row.original.id} />,
      size: 50,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: (info) => info.getValue(),
    },
    {
      accessorKey: "createdAt",
      header: "Created at",
      cell: (info) => new Date(info.getValue() as number).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated at",
      cell: (info) => new Date(info.getValue() as number).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }),
    },
    {
      accessorKey: "id",
      header: "Action",
      cell: (info) => {
        return info.getValue() === currentProjectId ?
          <Button className="w-24" disabled>Selected</Button> :
          <Button className="w-24" onClick={() => changeCurrentProject(info.getValue())} >Select</Button>
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

  return (
    <>
      <div className="w-full h-14 flex items-center">
        <AddProjectDialog />
      </div>
      <div className="rounded-lg border overflow-hidden">
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <Table>
            <TableHeader className="bg-muted">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              <SortableContext items={projectsIds} strategy={verticalListSortingStrategy}>
                {table.getRowModel().rows.map((row) => (
                  <DraggableRow key={row.id} row={row} />
                ))}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
      </div>
    </>
  )
}