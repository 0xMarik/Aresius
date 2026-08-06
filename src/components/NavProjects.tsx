import { ChevronRight, type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

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
} from "@/components/ui/sidebar"

interface NavItem {
  name: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  badge?: number
}

interface NavProjectsProps {
  name: string
  items: NavItem[]
  defaultOpen?: boolean
}

export function NavProjects({ name, items, defaultOpen = true }: NavProjectsProps) {
  const location = useLocation()

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
                <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                    <Link to={item.url} className="flex items-center">
                      <item.icon />
                      <span className="flex-1">{item.name}</span>
                      {!!item.badge && item.badge > 0 && (
                        <span
                          className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-medium leading-none text-sidebar-primary-foreground"
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