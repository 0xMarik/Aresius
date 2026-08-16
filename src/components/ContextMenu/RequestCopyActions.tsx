import React from 'react';
import { ContextMenuItem, ContextMenuShortcut } from '@/components/ui/context-menu';
import { Copy, Terminal, Globe, Download } from 'lucide-react';
import { EditorView } from 'codemirror';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { rawRequestToCurl, saveStringToFile } from '@/pages/sitemap/utils';
import { parseRequest } from '@/components/utils';

export interface RequestCopyActionsProps {
    rawRequest?: string;
    host?: string;
    targetUrl?: string;
    viewRef?: React.MutableRefObject<EditorView | null>;
}

export const RequestCopyActions: React.FC<RequestCopyActionsProps> = ({
    rawRequest,
    host,
    targetUrl,
    viewRef,
}) => {
    const resolveRawRequest = (): string => {
        if (viewRef?.current) {
            return viewRef.current.state.doc.toString();
        }
        return rawRequest || '';
    };

    const resolveHost = (): string => {
        if (host) return host;
        if (targetUrl) {
            try {
                const parsed = new URL(targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`);
                return parsed.host;
            } catch {
                // fallback
            }
        }
        const reqStr = resolveRawRequest();
        const parsed = parseRequest(reqStr);
        const hostHeader = Object.entries(parsed.headers || {}).find(
            ([k]) => k.toLowerCase() === 'host'
        )?.[1]?.trim();
        return hostHeader || '';
    };

    const resolveFullUrl = (): string => {
        if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
            return targetUrl;
        }
        const reqStr = resolveRawRequest();
        const parsed = parseRequest(reqStr);
        const derivedHost = resolveHost();
        const path = parsed.path || '/';

        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }

        if (derivedHost) {
            const cleanHost = derivedHost.replace(/^https?:\/\//, '');
            const isHttps = !derivedHost.includes(':80') && !derivedHost.startsWith('http://');
            const scheme = isHttps ? 'https://' : 'http://';
            const cleanPath = path.startsWith('/') ? path : `/${path}`;
            return `${scheme}${cleanHost}${cleanPath}`;
        }

        return path;
    };

    const handleCopy = () => {
        if (viewRef?.current) {
            const view = viewRef.current;
            const { from, to, empty } = view.state.selection.main;
            const text = empty
                ? view.state.doc.toString()
                : view.state.sliceDoc(from, to);
            navigator.clipboard.writeText(text);
            return;
        }

        const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
        const reqStr = resolveRawRequest();
        const textToCopy = sel && sel.length > 0 ? sel : reqStr;
        navigator.clipboard.writeText(textToCopy);
    };

    const handleCopyCurl = () => {
        const reqStr = resolveRawRequest();
        const derivedHost = resolveHost();
        const curl = rawRequestToCurl(reqStr, derivedHost);
        navigator.clipboard.writeText(curl);
    };

    const handleCopyUrl = () => {
        const url = resolveFullUrl();
        navigator.clipboard.writeText(url);
    };

    const handleSaveToFile = async () => {
        const reqStr = resolveRawRequest();
        const derivedHost = resolveHost();
        const cleanHost = derivedHost.replace(/[^a-zA-Z0-9.-]/g, '_') || 'request';
        const filename = `${cleanHost}_${Date.now()}.http`;
        await saveStringToFile(filename, reqStr);
    };

    return (
        <>
            <ContextMenuItem onSelect={handleCopy}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy
                <ContextMenuShortcut>
                    <KbdGroup>
                        <Kbd>Ctrl</Kbd>
                        <span>+</span>
                        <Kbd>C</Kbd>
                    </KbdGroup>
                </ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onSelect={handleCopyCurl}>
                <Terminal className="mr-2 h-3.5 w-3.5" />
                Copy as cURL
            </ContextMenuItem>

            <ContextMenuItem onSelect={handleCopyUrl}>
                <Globe className="mr-2 h-3.5 w-3.5" />
                Copy as URL
            </ContextMenuItem>

            <ContextMenuItem onSelect={handleSaveToFile}>
                <Download className="mr-2 h-3.5 w-3.5" />
                Save to a file
            </ContextMenuItem>
        </>
    );
};

export default RequestCopyActions;
