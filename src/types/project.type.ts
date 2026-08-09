export interface Project {
  id: string
  name: string
  path: string
  description: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number | null
  temporary: boolean
}

export interface WorkspaceState {
  currentProjectId: string | null
  projects: Project[]
}