export interface Target {
  id: string
  host: string
  port: number
  protocol: 'http' | 'https'
  inScope: boolean
  createdAt: string
}

export interface ScopeRule {
  id: string
  type: 'include' | 'exclude'
  pattern: string
  patternType: 'glob' | 'regex' | 'exact'
  enabled: boolean
}