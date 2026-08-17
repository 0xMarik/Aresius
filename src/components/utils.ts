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

/**
 * Toggles HTTP request method between GET and POST, adapting query parameters,
 * body, Content-Type, and Content-Length headers accordingly.
 */
export const toggleRequestMethod = (rawRequest?: string | null): string => {
    if (!rawRequest || typeof rawRequest !== 'string') return rawRequest || '';

    const isCrLf = rawRequest.includes('\r\n');
    const newline = isCrLf ? '\r\n' : '\n';
    const lines = rawRequest.split(/\r?\n/);

    if (lines.length === 0 || !lines[0].trim()) return rawRequest;

    const firstLine = lines[0];
    const match = firstLine.match(/^(\S+)\s+(\S+)(?:\s+(HTTP\/\d(?:\.\d)?))?/i);
    if (!match) return rawRequest;

    const currentMethod = match[1].toUpperCase();
    const originalPath = match[2];
    const httpVersion = match[3] || 'HTTP/1.1';

    // Separate headers and body
    const headerLines: string[] = [];
    let bodyStartIndex = lines.length;

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') {
            bodyStartIndex = i + 1;
            break;
        }
        headerLines.push(lines[i]);
    }

    const currentBody = lines.slice(bodyStartIndex).join(newline).trim();

    if (currentMethod === 'GET') {
        // --- Convert GET -> POST ---
        let newPath = originalPath;
        let newBody = currentBody;

        // Move query string from path to body
        const qIndex = originalPath.indexOf('?');
        if (qIndex !== -1) {
            newPath = originalPath.substring(0, qIndex) || '/';
            const queryString = originalPath.substring(qIndex + 1);
            if (queryString) {
                newBody = queryString;
            }
        }

        const bodyBytes = new TextEncoder().encode(newBody).length;

        // Update headers: Content-Type & Content-Length
        let hasContentType = false;
        let hasContentLength = false;

        const updatedHeaders = headerLines.map((h) => {
            const colonIdx = h.indexOf(':');
            if (colonIdx > 0) {
                const key = h.substring(0, colonIdx).trim().toLowerCase();
                if (key === 'content-type') {
                    hasContentType = true;
                    return h;
                }
                if (key === 'content-length') {
                    hasContentLength = true;
                    return `${h.substring(0, colonIdx).trim()}: ${bodyBytes}`;
                }
            }
            return h;
        });

        if (!hasContentType) {
            updatedHeaders.push('Content-Type: application/x-www-form-urlencoded');
        }
        if (!hasContentLength) {
            updatedHeaders.push(`Content-Length: ${bodyBytes}`);
        }

        const resultLines = [
            `POST ${newPath} ${httpVersion}`,
            ...updatedHeaders,
            '',
            newBody,
        ];

        return resultLines.join(newline);
    } else {
        // --- Convert POST (or other method) -> GET ---
        let newPath = originalPath;

        // If body has content, append as query parameters to path
        if (currentBody) {
            const separator = newPath.includes('?') ? '&' : '?';
            newPath = `${newPath}${separator}${currentBody}`;
        }

        // Remove Content-Type and Content-Length headers for GET
        const filteredHeaders = headerLines.filter((h) => {
            const colonIdx = h.indexOf(':');
            if (colonIdx > 0) {
                const key = h.substring(0, colonIdx).trim().toLowerCase();
                if (key === 'content-type' || key === 'content-length') {
                    return false;
                }
            }
            return true;
        });

        const resultLines = [
            `GET ${newPath} ${httpVersion}`,
            ...filteredHeaders,
            '',
            '',
        ];

        return resultLines.join(newline);
    }
};

/**
 * Calculates the exact UTF-8 byte length of the body in an HTTP request
 * and updates or inserts the Content-Length header accordingly.
 */
export const updateContentLengthInRequest = (rawRequest?: string | null): string => {
    if (!rawRequest || typeof rawRequest !== 'string') return rawRequest || '';

    const isCrLf = rawRequest.includes('\r\n');
    const newline = isCrLf ? '\r\n' : '\n';

    // Find the boundary between headers and body (\r\n\r\n or \n\n)
    const headerEndMatch = rawRequest.match(/\r?\n\r?\n/);
    if (!headerEndMatch || headerEndMatch.index === undefined) {
        const lines = rawRequest.split(/\r?\n/);
        let hasCl = false;
        const updatedLines = lines.map((line) => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0 && line.substring(0, colonIdx).trim().toLowerCase() === 'content-length') {
                hasCl = true;
                return `${line.substring(0, colonIdx).trim()}: 0`;
            }
            return line;
        });
        return hasCl ? updatedLines.join(newline) : rawRequest;
    }

    const headerBlock = rawRequest.substring(0, headerEndMatch.index);
    const separator = headerEndMatch[0];
    const body = rawRequest.substring(headerEndMatch.index + separator.length);

    const bodyBytes = new TextEncoder().encode(body).length;

    const headerLines = headerBlock.split(/\r?\n/);
    let hasContentLength = false;

    const updatedHeaderLines = headerLines.map((line) => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            if (key === 'content-length') {
                hasContentLength = true;
                return `${line.substring(0, colonIdx).trim()}: ${bodyBytes}`;
            }
        }
        return line;
    });

    if (!hasContentLength && bodyBytes > 0) {
        updatedHeaderLines.push(`Content-Length: ${bodyBytes}`);
    }

    return `${updatedHeaderLines.join(newline)}${separator}${body}`;
};

/**
 * Ensures the HTTP request has Connection: close header to force closing connection.
 */
export const applyForceCloseConnection = (rawRequest?: string | null): string => {
    if (!rawRequest || typeof rawRequest !== 'string') return rawRequest || '';

    const isCrLf = rawRequest.includes('\r\n');
    const newline = isCrLf ? '\r\n' : '\n';

    const headerEndMatch = rawRequest.match(/\r?\n\r?\n/);
    if (!headerEndMatch || headerEndMatch.index === undefined) {
        const lines = rawRequest.split(/\r?\n/);
        let hasConn = false;
        const updatedLines = lines.map((line) => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0 && line.substring(0, colonIdx).trim().toLowerCase() === 'connection') {
                hasConn = true;
                return `${line.substring(0, colonIdx).trim()}: close`;
            }
            return line;
        });
        if (!hasConn && lines.length > 0 && lines[0].trim()) {
            updatedLines.push('Connection: close');
        }
        return updatedLines.join(newline);
    }

    const headerBlock = rawRequest.substring(0, headerEndMatch.index);
    const separator = headerEndMatch[0];
    const body = rawRequest.substring(headerEndMatch.index + separator.length);

    const headerLines = headerBlock.split(/\r?\n/);
    let hasConnectionHeader = false;

    const updatedHeaderLines = headerLines.map((line) => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            if (key === 'connection') {
                hasConnectionHeader = true;
                return `${line.substring(0, colonIdx).trim()}: close`;
            }
        }
        return line;
    });

    if (!hasConnectionHeader) {
        updatedHeaderLines.push('Connection: close');
    }

    return `${updatedHeaderLines.join(newline)}${separator}${body}`;
};

/**
 * Checks if the raw HTTP request is missing the required blank line (\r\n\r\n or \n\n)
 * between headers and body, or at the end of headers when bodyless.
 */
export const hasMissingHeaderTerminator = (rawRequest?: string | null): boolean => {
    if (!rawRequest || typeof rawRequest !== 'string' || !rawRequest.trim()) {
        return false;
    }
    return !/\r?\n\r?\n/.test(rawRequest);
};