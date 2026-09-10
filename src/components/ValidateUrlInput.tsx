import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// scheme://host[:port][/path]
// - scheme: optional, defaults to https
// - host: required (hostname or IP)
// - port: optional, defaults to 443
// - path: optional
export const URL_PATTERN =
    /^(?<scheme>https?:\/\/)?(?<host>(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|localhost)(?<port>:\d{1,5})?(?:\/.*)?$/

export const WS_URL_PATTERN =
    /^(?<scheme>wss?:\/\/)?(?<host>(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|localhost)(?<port>:\d{1,5})?(?:\/.*)?$/

export function isValidPort(port?: string) {
    if (!port) return true
    const n = Number(port.replace(':', ''))
    return n >= 1 && n <= 65535
}

export function validateUrl(value: string, protocol: 'http' | 'ws' = 'http'): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null

    if (protocol === 'ws') {
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return 'WebSocket URL must start with wss:// or ws://'
        }
        const match = trimmed.match(WS_URL_PATTERN)
        if (!match || !match.groups?.host) {
            return 'Invalid format. Expected wss://host:port/path (host is required)'
        }
        if (!isValidPort(match.groups.port)) {
            return 'Port must be between 1 and 65535'
        }
        return null
    }

    const match = trimmed.match(URL_PATTERN)
    if (!match || !match.groups?.host) {
        return 'Invalid format. Expected schema://host:port/path (host is required)'
    }
    if (!isValidPort(match.groups.port)) {
        return 'Port must be between 1 and 65535'
    }
    return null
}

export function isDnsResolutionError(error: unknown): boolean {
    if (!error) return false;
    const str = (typeof error === 'string' ? error : (error as any)?.message || String(error)).toLowerCase();
    return (
        str.includes('11001') ||
        str.includes('no such host is known') ||
        str.includes('failed to lookup address') ||
        str.includes('name or service not known') ||
        str.includes('nodename nor servname provided') ||
        str.includes('dns') ||
        str.includes('url parsing failed')
    );
}

export function normalizeUrlWithScheme(url: string, protocol: 'http' | 'ws' = 'http'): string {
    const trimmed = url.trim()
    if (!trimmed) return trimmed

    const pattern = protocol === 'ws' ? WS_URL_PATTERN : URL_PATTERN
    const defaultScheme = protocol === 'ws' ? 'wss://' : 'https://'

    const match = trimmed.match(pattern)
    if (!match || !match.groups?.host) {
        return trimmed
    }

    const { scheme, host, port = '' } = match.groups
    if (!scheme) {
        const hostIndex = trimmed.indexOf(host)
        const afterHostAndPort = trimmed.slice(hostIndex + host.length + port.length)
        return `${defaultScheme}${host}${port}${afterHostAndPort}`
    }
    return trimmed
}

export function stripPath(url: string): string {
    const trimmed = url.trim()
    if (!trimmed) return trimmed

    const match = trimmed.match(URL_PATTERN)
    if (!match || !match.groups?.host) {
        return trimmed.includes('://') ? trimmed : `https://${trimmed}`
    }

    const { scheme, host, port = '' } = match.groups
    const finalScheme = scheme || 'https://'
    return `${finalScheme}${host}${port}`
}

export function ValidateUrlInput({
    url,
    onChange,
    disabled = false,
    protocol = 'http',
}: {
    url: string;
    onChange: (url: string, urlIsValid: boolean) => void;
    disabled?: boolean;
    protocol?: 'http' | 'ws';
}) {
    const [touched, setTouched] = useState(false)

    const error = useMemo(() => validateUrl(url, protocol), [url, protocol])
    const showError = touched && error

    const handleBlur = () => {
        setTouched(true)
        if (url && url.trim() && !validateUrl(url, protocol)) {
            const normalized = normalizeUrlWithScheme(url, protocol)
            if (normalized !== url) {
                onChange(normalized, true)
            }
        }
    }

    const isWs = protocol === 'ws'

    return (
        <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-1.5">
                <TooltipProvider delayDuration={150}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label="URL format help"
                                disabled={disabled}
                            >
                                <HelpCircle className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs font-mono text-foreground text-xs bg-background">
                            <p className="font-sans font-medium mb-1">Format</p>
                            <p>{isWs ? 'wss://host:port/path' : 'schema://host:port/path'}</p>
                            <p className="font-sans text-muted-foreground mt-1">
                                {isWs ? (
                                    <>
                                        Only <span className="font-mono">host</span> is required. If not
                                        specified, default schema is <span className="font-mono">wss</span> and
                                        default port is <span className="font-mono">443</span>. Only <span className="font-mono">wss://</span> and <span className="font-mono">ws://</span> are accepted.
                                    </>
                                ) : (
                                    <>
                                        Only <span className="font-mono">host</span> is required. If not
                                        specified, the default schema is <span className="font-mono">https</span>{' '}
                                        and the default port is <span className="font-mono">443</span>.
                                    </>
                                )}
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <Input
                    placeholder={isWs ? "Enter WebSocket URL... (e.g. wss://echo.websocket.org)" : "Enter an URL... (e.g. https://example.com)"}
                    disabled={disabled}
                    className={cn(
                        'flex-1 font-mono text-xs h-8 bg-background',
                        showError && 'border-destructive focus-visible:ring-destructive'
                    )}
                    value={url}
                    onChange={(event) => {
                        if (!touched) setTouched(true)
                        onChange(event.target.value, !validateUrl(event.target.value, protocol))
                    }}
                    onBlur={handleBlur}
                    aria-invalid={!!showError}
                />
            </div>
            {showError && (
                <span className="text-[11px] text-destructive px-1">{error}</span>
            )}
        </div>
    )
}