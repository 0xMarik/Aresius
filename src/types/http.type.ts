export interface HttpRequest {
  id: string
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body?: string
  timestamp: string
  targetId: string
  responseId?: string
}

export interface HttpResponse {
  id: string
  requestId: string
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
  body: string
  responseTime: number
  timestamp: string
}

export interface HttpHistory {
    request: string;
    response: string;
    host: string;
    timestamp: number;
    duration: number;
}