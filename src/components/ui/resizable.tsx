import * as React from "react"
import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"
import { useProjectId } from "@/hooks/useProjectId"

export interface ResizablePanelGroupProps
  extends React.ComponentProps<typeof ResizablePrimitive.PanelGroup> {
  layoutId?: string
  projectId?: string | null
}

const ResizablePanelGroup = ({
  className,
  autoSaveId,
  layoutId,
  projectId: projectIdProp,
  ...props
}: ResizablePanelGroupProps) => {
  const currentProjectId = useProjectId()
  const projectId = projectIdProp !== undefined ? projectIdProp : currentProjectId
  const baseLayoutId = layoutId || autoSaveId
  const persistentId = baseLayoutId
    ? (projectId ? `${projectId}-${baseLayoutId}` : baseLayoutId)
    : undefined

  return (
    <ResizablePrimitive.PanelGroup
      key={persistentId}
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      autoSaveId={persistentId}
      {...props}
    />
  )
}

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90 group",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border transition-colors group-hover:bg-primary group-hover:border-primary group-hover:text-primary-foreground group-data-[resize-handle-state=hover]:bg-primary group-data-[resize-handle-state=hover]:border-primary group-data-[resize-handle-state=hover]:text-primary-foreground group-data-[resize-handle-state=drag]:bg-primary group-data-[resize-handle-state=drag]:border-primary group-data-[resize-handle-state=drag]:text-primary-foreground">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
