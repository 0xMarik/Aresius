import * as React from "react"
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  // Frame,
  PanelsTopLeft,
  GalleryVerticalEnd,
  Waves,
  Settings2,
  Repeat2,
  SquareTerminal,
  Antenna,
  Logs,
  Network,
  Crosshair
} from "lucide-react"

// import { NavMain } from '@/components/nav-main'
import { NavProjects } from '@/components/nav-projects'
import { TeamSwitcher } from '@/components/team-switcher'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  // SidebarRail,
} from '@/components/ui/sidebar'
// import { IconSatellite } from "@tabler/icons-react"

// This is sample data.
const data = {
  // user: {
  //   name: "shadcn",
  //   email: "m@example.com",
  //   avatar: "/avatars/shadcn.jpg",
  // },
  // teams: [
  //   {
  //     name: "Acme Inc",
  //     logo: GalleryVerticalEnd,
  //     plan: "Ares",
  //   },
  //   {
  //     name: "Acme Corp.",
  //     logo: AudioWaveform,
  //     plan: "Startup",
  //   },
  //   {
  //     name: "Evil Corp.",
  //     logo: Command,
  //     plan: "Free",
  //   },
  // ],
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
    // {
    //   name: "Travel",
    //   url: "#",
    //   icon: Map,
    // },
  ],
  discovery: [{
    name: "Sitemap",
    url: "/site-map",
    icon: Network,
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
  return (
    <Sidebar collapsible="icon" variant="floating" {...props} >
      {/* <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader> */}
      <SidebarContent>
        {/* <NavMain items={data.navMain} /> */}
        <NavProjects name="Discovery" items={data.discovery} />
        <NavProjects name="Proxy" items={data.proxy} />
        <NavProjects name="Testing" items={data.projects} />
        <NavProjects name="Workspace" items={data.workspace} />
      </SidebarContent>
      <SidebarFooter>
        {/* <NavUser user={data.user} /> */}
        <SidebarTrigger />
      </SidebarFooter>

      {/* <SidebarRail /> */}
    </Sidebar>
  )
}
