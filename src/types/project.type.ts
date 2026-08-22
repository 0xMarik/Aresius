export interface Project {
  id: string
  name: string
  path: string
  version: string
  description?: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number | null
  temporary?: boolean
  sizeBytes: number
  exists?: boolean
}

export interface WorkspaceState {
  currentProjectId: string | null
  projects: Project[]
}

export interface AppState {
  sidebarCollapsed: boolean
  activeProjectId: string | null
  lastPage: string
}