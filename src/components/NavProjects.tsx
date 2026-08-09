import { ChevronRight, type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { toast } from "sonner"
import { useAppSelector } from "@/hooks/redux"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { RunningDot } from "@/components/ui/RunningDot"

const PUBLIC_ROUTES = ["/projects", "/"]

interface NavItem {
  name: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  badge?: number
  isRunning?: boolean
}

interface NavProjectsProps {
  name: string
  items: NavItem[]
  defaultOpen?: boolean
}

export function NavProjects({ name, items, defaultOpen = true }: NavProjectsProps) {
  const location = useLocation()
  const { state: sidebarState } = useSidebar()
  const isCollapsed = sidebarState === "collapsed"
  const currentProjectId = useAppSelector((s) => s.workspacestate.currentProjectId)

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    const isPublic = PUBLIC_ROUTES.some((r) => url === r)
    if (!currentProjectId && !isPublic) {
      e.preventDefault()
      toast.error("No project selected — please select or create a project before accessing other pages.", {
        id: "no-project-selected",
      })
    }
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/collapsible">
      <SidebarGroup>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="flex w-full items-center gap-2 cursor-pointer hover:text-sidebar-foreground">
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            {name}
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenu>
            {items.map((item) => {
              const isActive = location.pathname === item.url

              return (
                <SidebarMenuItem key={item.name} className="relative">
                  {/* Collapsed-mode dot — absolutely positioned on the li, icon stays unwrapped */}
                  {item.isRunning && isCollapsed && (
                    <RunningDot className="pointer-events-none absolute top-1 right-1 z-10" />
                  )}
                  <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                    <Link
                      to={item.url}
                      onClick={(e) => handleLinkClick(e, item.url)}
                      className="flex items-center gap-2"
                    >
                      <item.icon />
                      <span className="flex-1 truncate">{item.name}</span>

                      {/* Expanded-mode dot */}
                      {item.isRunning && !isCollapsed && (
                        <RunningDot className="ml-auto" />
                      )}

                      {!!item.badge && item.badge > 0 && (
                        <span
                          className={`flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-medium leading-none text-sidebar-primary-foreground ${!item.isRunning ? 'ml-auto' : ''}`}
                          aria-label={`${item.badge} new`}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}