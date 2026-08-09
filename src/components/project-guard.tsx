import { useEffect } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAppSelector } from "@/hooks/redux"
import { toast } from "sonner"

/** Routes that don't require a project to be selected */
const PUBLIC_ROUTES = ["/projects", "/"]

interface ProjectGuardProps {
  children: React.ReactNode
}

/**
 * Synchronously blocks protected routes during render.
 * If no project is selected and the current route is protected,
 * a <Navigate> is returned immediately — the child page never mounts (no flash).
 * Upon redirect to /projects, a toast error is displayed.
 */
export function ProjectGuard({ children }: ProjectGuardProps) {
  const currentProjectId = useAppSelector((s) => s.workspacestate.currentProjectId)
  const location = useLocation()
  const navigate = useNavigate()

  const isPublic = PUBLIC_ROUTES.some((r) => location.pathname === r)
  const needsProject = (location.state as any)?.needsProject === true

  useEffect(() => {
    if (needsProject && !currentProjectId) {
      toast.error("No project selected — please select or create a project before accessing other pages.", {
        id: "no-project-selected",
      })
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [needsProject, currentProjectId, location.pathname, navigate])

  // Redirect synchronously — no useEffect delay, no flash of protected page
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

export function NoProjectBanner() {
  return null
}

export function noProjectBanner() {
  return null
}