
interface ParsedRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
}

interface ParsedResponse {
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}


export const parseResponse = (rawResponse?: string | null): ParsedResponse => {
    if (!rawResponse || typeof rawResponse !== 'string') {
        return { statusCode: 0, statusText: '', headers: {}, body: '' };
    }
    const lines = rawResponse.split('\n');
    const statusLine = lines[0] || '';
    const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
    const statusText = statusMatch ? statusMatch[2] : '';

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            bodyStartIndex = i + 1;
            break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }

    const body = lines.slice(bodyStartIndex).join('\n').trim();

    return { statusCode, statusText, headers, body };
};

export const parseRequest = (rawRequest?: string | null): ParsedRequest => {
    if (!rawRequest || typeof rawRequest !== 'string') {
        return { method: 'GET', path: '/', headers: {}, body: '' };
    }
    const lines = rawRequest.split('\n');
    const requestLine = lines[0] || '';
    const [method = 'GET', path = '/'] = requestLine.split(' ');

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            bodyStartIndex = i + 1;
            break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }

    const body = lines.slice(bodyStartIndex).join('\n').trim();

    return { method, path, headers, body };
};