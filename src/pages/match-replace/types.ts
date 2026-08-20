export type MatchReplaceType =
    | 'request_header'
    | 'request_body'
    | 'request_param_name'
    | 'request_param_value'
    | 'request_first_line'
    | 'response_header'
    | 'response_body';

export interface MatchReplaceRule {
    id: string;
    name: string;
    enabled: boolean;
    type: MatchReplaceType;
    match: string;
    replace: string;
    comment: string;
    isRegex?: boolean;
    isCaseSensitive?: boolean;
    onlyInScope?: boolean;
}

export interface MatchReplaceCollection {
    id: string;
    name: string;
    rules: MatchReplaceRule[];
}

export const MATCH_REPLACE_TYPE_LABELS: Record<MatchReplaceType, string> = {
    request_header: 'Request header',
    request_body: 'Request body',
    request_param_name: 'Request param name',
    request_param_value: 'Request param value',
    request_first_line: 'Request first line',
    response_header: 'Response header',
    response_body: 'Response body',
};
