import { Navigate, useLocation } from "react-router-dom"
import { useAppSelector } from "@/hooks/redux"
import { FolderOpen } from "lucide-react"

/** Routes that don't require a project to be selected */
const PUBLIC_ROUTES = ["/projects", "/"]

interface ProjectGuardProps {
  children: React.ReactNode
}

/**
 * Synchronously blocks protected routes during render.
 * If no project is selected and the current route is protected,
 * a <Navigate> is returned immediately — the child page never mounts.
 */
export function ProjectGuard({ children }: ProjectGuardProps) {
  const currentProjectId = useAppSelector((s) => s.workspacestate.currentProjectId)
  const location = useLocation()

  const isPublic = PUBLIC_ROUTES.some((r) => location.pathname === r)

  // Redirect synchronously — no useEffect, no flash of the protected page
  if (!currentProjectId && !isPublic) {
    return (
      <Navigate
        to="/projects"
        replace
        state={{ needsProject: true }}
      />
    )
  }

  return <>{children}</>
}

/**
 * Banner shown on the /projects page when the user was redirected
 * because no project was selected.
 */
export function NoProjectBanner() {
  const location = useLocation()
  const currentProjectId = useAppSelector((s) => s.workspacestate.currentProjectId)
  const fromGuard = (location.state as any)?.needsProject === true

  if (!fromGuard || currentProjectId) return null

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/10 px-4 py-2.5 text-[12px] text-primary mb-4"
      role="alert"
    >
      <FolderOpen className="size-4 shrink-0" />
      <div>
        <span className="font-semibold">No project selected — </span>
        <span className="text-primary/80">please select or create a project below before accessing other pages.</span>
      </div>
    </div>
  )
}
