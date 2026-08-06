import * as React from "react"
import {
  BookOpen,
  Bot,
  PanelsTopLeft,
  Waves,
  Settings2,
  Repeat2,
  SquareTerminal,
  Antenna,
  Logs,
  Crosshair,
  ListTree
} from "lucide-react"

// import { NavMain } from '@/components/nav-main'
import { NavProjects } from '@/components/NavProjects'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  // SidebarRail,
} from '@/components/ui/sidebar'
import { useAppSelector } from "@/hooks/redux"

// This is sample data.
const data = {
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "History",
          url: "#",
        },
        {
          title: "Starred",
          url: "#",
        },
        {
          title: "Settings",
          url: "#",
        },
      ],
    },
    {
      title: "Models",
      url: "#",
      icon: Bot,
      items: [
        {
          title: "Genesis",
          url: "#",
        },
        {
          title: "Explorer",
          url: "#",
        },
        {
          title: "Quantum",
          url: "#",
        },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: BookOpen,
      items: [
        {
          title: "Introduction",
          url: "#",
        },
        {
          title: "Get Started",
          url: "#",
        },
        {
          title: "Tutorials",
          url: "#",
        },
        {
          title: "Changelog",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Team",
          url: "#",
        },
        {
          title: "Billing",
          url: "#",
        },
        {
          title: "Limits",
          url: "#",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Replayer",
      url: "/replayer",
      icon: Repeat2,
    },
    {
      name: "Fuzzer",
      url: "/fuzzer",
      icon: Waves,

    },

  ],
  discovery: [{
    name: "Sitemap",
    url: "/site-map",
    icon: ListTree,
    isActive: true,

  }, {
    name: "Scope",
    url: "/scope",
    icon: Crosshair
  }],
  proxy: [{
    name: "Interceptor",
    url: "/interceptor",
    icon: Antenna,
  }, {
    name: "HTTP History",
    url: "/http-history",
    icon: Logs,
  }],
  workspace: [
    {
      name: "Projects",
      url: "/projects",
      icon: PanelsTopLeft,

    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {

  const fuzzerReceivedSession = useAppSelector((state) => state.fuzzerstate.receivedSession)
  const replayerReceivedSession = useAppSelector((state) => state.replayerstate.receivedSession);

  const testingItems = React.useMemo(
    () =>
      data.projects.map((item) => {
        if (item.name === "Fuzzer") {
          return { ...item, badge: fuzzerReceivedSession }
        }
        if (item.name === "Replayer") {
          return { ...item, badge: replayerReceivedSession }
        }
        return item;
      }
      ),
    [fuzzerReceivedSession, replayerReceivedSession]
  )

  return (
    <Sidebar collapsible="icon" variant="sidebar" {...props}>
      <SidebarContent>
        <NavProjects name="Discovery" items={data.discovery} />
        <NavProjects name="Proxy" items={data.proxy} />
        <NavProjects name="Testing" items={testingItems} />
        <NavProjects name="Workspace" items={data.workspace} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarTrigger />
      </SidebarFooter>
    </Sidebar>
  )
}