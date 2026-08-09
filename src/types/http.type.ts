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

export type RequestState = 'Pending' | 'Info' | 'Success' | 'Redirect' | 'Client Error' | 'Server Error' | 'Failed';


export type HttpHistory = {
    id: number;
    host: string;
    method: string;
    path: string;
    query: string | null;
    extension: string | null;
    statusCode: number;
    responseLength: number;
    responseTimeMs: number;
    sentAtTsMs: number;
    state: RequestState;
    isHttps: boolean;
    rawRequest: string;
    rawResponse: string;
};