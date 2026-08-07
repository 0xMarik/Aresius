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

export function isValidPort(port?: string) {
    if (!port) return true
    const n = Number(port.replace(':', ''))
    return n >= 1 && n <= 65535
}

export function validateUrl(value: string): string | null {
    if (!value.trim()) return null

    const match = value.match(URL_PATTERN)
    if (!match || !match.groups?.host) {
        return 'Invalid format. Expected schema://host:port/path (host is required)'
    }
    if (!isValidPort(match.groups.port)) {
        return 'Port must be between 1 and 65535'
    }
    return null
}

export function stripPath(url: string): string {
    const match = url.match(URL_PATTERN)
    if (!match || !match.groups?.host) return url

    const { scheme = '', host, port = '' } = match.groups
    return `${scheme}${host}${port}`
}


export function ValidateUrlInput({ url, onChange }: { url: string; onChange: (url: string, urlIsValid: boolean) => void }) {
    const [touched, setTouched] = useState(false)


    const error = useMemo(() => validateUrl(url), [url])
    console.error('ValidateUrlInput error:', error)
    const showError = touched && error

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
                            >
                                <HelpCircle className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs font-mono text-foreground text-xs bg-background">
                            <p className="font-sans font-medium mb-1">Format</p>
                            <p>schema://host:port/path</p>
                            <p className="font-sans text-muted-foreground mt-1">
                                Only <span className="font-mono">host</span> is required. If not
                                specified, the default schema is <span className="font-mono">https</span>{' '}
                                and the default port is <span className="font-mono">443</span>.
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <Input
                    placeholder="Enter an URL... (e.g. https://example.com)"
                    className={cn(
                        'flex-1 font-mono text-xs h-8 bg-background',
                        showError && 'border-destructive focus-visible:ring-destructive'
                    )}
                    value={url}
                    onChange={(event) => {
                        if (!touched) setTouched(true)
                        onChange(event.target.value, !validateUrl(event.target.value))
                    }}
                    onBlur={() => setTouched(true)}
                    aria-invalid={!!showError}
                />
            </div>

        </div>
    )
}