// import { HttpRequest, HttpResponse } from "./http.type"
// import { ScopeRule, Target } from "./other.type"

// interface ProjectSettings {
//   proxyPort: number
//   interceptEnabled: boolean
//   autoScan: boolean
//   scanDepth: 'light' | 'normal' | 'deep'
//   excludeExtensions: string[]
//   includeSubdomains: boolean
//   followRedirects: boolean
//   maxThreads: number
//   requestTimeout: number
// }

export interface Project {
  id: `${string}-${string}-${string}-${string}-${string}`
  name: string
  description: string
  createdAt: number
  updatedAt: number
  temporary: boolean
  
  // All project data stored locally
//   targets: Target[]
//   scopeRules: ScopeRule[]
//   requests: HttpRequest[]
//   responses: HttpResponse[]
//   vulnerabilities: Vulnerability[]
  // settings: ProjectSettings
  
  // Project metadata
  // stats: {
  //   totalRequests: number
  //   totalVulnerabilities: number
  //   uniqueHosts: number
  //   lastScanDate: string | null
  // }
}

export interface WorkspaceState {
  currentProjectId: `${string}-${string}-${string}-${string}-${string}` | null
  projects: Project[]
  
  // UI state will be handled by react router
}