export interface HttpRequest {
  id: string;
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: string;
  targetId: string;
  responseId?: string;
}

export interface HttpResponse {
  id: string;
  requestId: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
  timestamp: string;
}

export type RequestState =
  | 'Pending'
  | 'Info'
  | 'Success'
  | 'Redirect'
  | 'Client Error'
  | 'Server Error'
  | 'Failed';

export type EditType = 'automated' | 'manual' | 'both';

export type HttpHistory = {
  id: number;
  projectId?: string;
  host: string;
  method: string;
  path: string;
  query: string | null;
  extension: string | null;
  statusCode: number;
  responseLength: number;
  responseTimeMs: number;
  sentAtMs: number;
  state: RequestState;
  isHttps: boolean;
  rawRequest: string;
  rawResponse: string;
  requestAutoPatch?: string | null;
  requestManualPatch?: string | null;
  responseAutoPatch?: string | null;
  responseManualPatch?: string | null;
  requestEditType?: EditType | null;
  responseEditType?: EditType | null;
};

export type HttpTransaction = {
  id: number;
  projectId?: string;
  host: string;
  method: string;
  path: string;
  query: string | null;
  extension: string | null;
  statusCode: number;
  responseLength: number;
  responseTimeMs: number;
  sentAtMs: number;
  state: RequestState;
  isHttps: boolean;
  rawRequest?: string;
  rawResponse?: string;
  requestAutoPatch?: string | null;
  requestManualPatch?: string | null;
  responseAutoPatch?: string | null;
  responseManualPatch?: string | null;
  requestEditType?: EditType | null;
  responseEditType?: EditType | null;
};

export type HttpHistorySummaryRow = {
  id: number;
  projectId?: string;
  host: string;
  method: string;
  path: string;
  query?: string | null;
  extension?: string | null;
  statusCode: number;
  responseLength: number;
  responseTimeMs: number;
  sentAtMs: number;
  state?: string;
  isHttps: boolean;
  requestAutoPatch?: string | null;
  requestManualPatch?: string | null;
  responseAutoPatch?: string | null;
  responseManualPatch?: string | null;
  requestEditType?: EditType | null;
  responseEditType?: EditType | null;
};

export function stateFromCode(code: number): RequestState {
  if (!code) return 'Pending';
  if (code >= 100 && code < 200) return 'Info';
  if (code >= 200 && code < 300) return 'Success';
  if (code >= 300 && code < 400) return 'Redirect';
  if (code >= 400 && code < 500) return 'Client Error';
  if (code >= 500 && code < 600) return 'Server Error';
  return 'Failed';
}