import { MatchReplaceCollection } from './types';

export const INITIAL_DUMMY_REQUEST = `POST /api/v1/user/profile?role=user&debug=0 HTTP/1.1
Host: api.example.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Accept-Encoding: gzip, deflate, br
Authorization: Bearer old_token_abc_987
Content-Type: application/json; charset=utf-8
Content-Length: 74
Connection: keep-alive
X-Custom-Token: client_secret_123

{
  "userId": 1042,
  "role": "user",
  "email": "user@example.com",
  "isAdmin": false
}`;

export const INITIAL_DUMMY_RESPONSE = `HTTP/1.1 200 OK
Date: Thu, 20 Aug 2026 17:00:00 GMT
Content-Type: application/json; charset=utf-8
Content-Encoding: gzip
Content-Security-Policy: default-src 'self'; script-src 'self' https://trusted.cdn.com
Cache-Control: no-cache, no-store
Server: nginx/1.24.0
Content-Length: 52

{
  "status": "success",
  "access": "denied",
  "role": "user"
}`;

export const INITIAL_COLLECTIONS: MatchReplaceCollection[] = [
    {
        id: 'col-default',
        name: 'Default Proxy Rules',
        rules: [
            {
                id: 'rule-1',
                name: 'Strip Accept-Encoding (gzip)',
                enabled: false,
                type: 'request_header',
                match: 'Accept-Encoding: gzip, deflate, br',
                replace: 'Accept-Encoding: identity',
                comment: 'Prevent server from returning compressed response so body can be easily inspected.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-2',
                name: 'Inject Test Auth Token',
                enabled: false,
                type: 'request_header',
                match: 'Authorization: Bearer .*',
                replace: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_admin_token',
                comment: 'Automatically replaces incoming Bearer token with the elevated testing JWT.',
                isRegex: true,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-3',
                name: 'Elevate Role Parameter',
                enabled: false,
                type: 'request_param_value',
                match: 'role=user',
                replace: 'role=admin',
                comment: 'Replaces query parameter role=user with role=admin to test parameter privilege escalation.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-4',
                name: 'Query Param Name (debug -> verbose)',
                enabled: false,
                type: 'request_param_name',
                match: 'debug=0',
                replace: 'verbose=1',
                comment: 'Rewrites query parameter name from debug to verbose.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
        ],
    },
    {
        id: 'col-security',
        name: 'Security Header Modification',
        rules: [
            {
                id: 'rule-5',
                name: 'Remove CSP Header',
                enabled: false,
                type: 'response_header',
                match: 'Content-Security-Policy: .*',
                replace: '',
                comment: 'Strips Content-Security-Policy from responses to facilitate client-side testing.',
                isRegex: true,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-6',
                name: 'Bypass JSON isAdmin Body Flag',
                enabled: false,
                type: 'request_body',
                match: '"isAdmin": false',
                replace: '"isAdmin": true',
                comment: 'Modifies JSON request payload to set isAdmin flag to true.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-7',
                name: 'Response Body Access Granted',
                enabled: false,
                type: 'response_body',
                match: '"access": "denied"',
                replace: '"access": "granted"',
                comment: 'Modifies response body access flag from denied to granted.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
        ],
    },
    {
        id: 'col-emulation',
        name: 'Client Emulation & Routing',
        rules: [
            {
                id: 'rule-8',
                name: 'Emulate Mobile Safari UA',
                enabled: false,
                type: 'request_header',
                match: 'User-Agent: .*',
                replace: 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
                comment: 'Replaces desktop User-Agent with iPhone Safari User-Agent.',
                isRegex: true,
                isCaseSensitive: false,
                onlyInScope: true,
            },
            {
                id: 'rule-9',
                name: 'Rewrite First Line Method/Path',
                enabled: false,
                type: 'request_first_line',
                match: 'POST /api/v1/user/profile',
                replace: 'POST /api/v1/admin/dashboard',
                comment: 'Transforms the HTTP request method and path in the first line.',
                isRegex: false,
                isCaseSensitive: false,
                onlyInScope: true,
            },
        ],
    },
];
