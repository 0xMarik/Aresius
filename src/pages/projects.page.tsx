
import React from "react"
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
// import { Checkbox } from "@/components/ui/checkbox"
import { IconGripVertical } from "@tabler/icons-react"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { Project } from "@/types/project.type"
import { setcurrentProjectId } from "@/store/slices/projectSlice"
import { Plus } from "lucide-react"
import AddProjectDialog from "@/components/add-project-dialog.component"

// Remove the Item type and defaultData, and use your actual Project type from your state
// If you have a Project type defined elsewhere, import it here. Otherwise, define it as needed:
// import { Project } from "@/types/project" // Example import

// If not already defined, define the Project type based on your state shape:
// type Project = {
//   id: number
//   name: string
//   status: string
//   // add other fields as needed
// }



function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({ id })
  return (
    <Button
      variant="ghost"
      size="icon"
      {...attributes}
      {...listeners}
      className="cursor-grab"
    >
      <IconGripVertical className="size-4" />
    </Button>
  )
}

function DraggableRow({ row }: { row: any }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })

  return (
    <TableRow
      ref={setNodeRef}
      data-dragging={isDragging}
      className="relative"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {row.getVisibleCells().map((cell: any) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
  // const [data, setData] = React.useState(projects)
  const dataIds = data.map((item) => item.id)
  const columns: ColumnDef<Project, any>[] = [
    {
      id: "drag",
      header: () => null,
      cell: ({ row }) => <DragHandle id={row.original.id} />,
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
        month: "short",     // Jul
        day: "numeric",     // 3
        year: "numeric",    // 2025
        hour: "numeric",    // 10
        minute: "2-digit",  // 46
        hour12: true        // PM
      }), // Format the timestamp to a readable date string from milliseconds
    },
    {
      accessorKey: "updatedAt",
      header: "Updated at",
      cell: (info) => new Date(info.getValue() as number).toLocaleString("en-US", {
        month: "short",     // Jul
        day: "numeric",     // 3
        year: "numeric",    // 2025
        hour: "numeric",    // 10
        minute: "2-digit",  // 46
        hour12: true        // PM
      }), // Format the timestamp to a readable date string from milliseconds
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
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active?.id !== over?.id) {
      // const oldIndex = data.findIndex((i) => i.id === active.id)
      // const newIndex = data.findIndex((i) => i.id === over!.id)
      // setData(arrayMove(data, oldIndex, newIndex))
      // todo be fixed
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
              <SortableContext items={dataIds} strategy={verticalListSortingStrategy}>
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
