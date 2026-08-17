import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { hasMissingHeaderTerminator } from '@/components/utils';
import { cn } from '@/lib/utils';

interface HttpRequestFormatWarningProps {
    rawRequest?: string | null;
    className?: string;
}

export const HttpRequestFormatWarning: React.FC<HttpRequestFormatWarningProps> = ({
    rawRequest,
    className,
}) => {
    const isMissing = hasMissingHeaderTerminator(rawRequest);

    if (!isMissing) return null;

    return (
        <TooltipProvider>
            <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            "inline-flex items-center justify-center p-0.5 rounded text-amber-500 hover:text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-colors select-none",
                            className
                        )}
                        aria-label="Missing HTTP header terminator"
                    >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    </button>
                </TooltipTrigger>
                <TooltipContent
                    side="bottom"
                    align="center"
                    className="max-w-xs text-xs p-3 bg-popover text-popover-foreground border border-border shadow-lg z-50 select-text"
                >
                    <div className="flex items-center gap-1.5 font-semibold text-amber-500 mb-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Missing Header Terminator</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        HTTP headers must be separated from the body (or ended when there is no body) with a blank line (<code className="px-1 py-0.5 rounded bg-muted font-mono text-[10px] text-foreground font-semibold">\r\n\r\n</code>).
                    </p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default HttpRequestFormatWarning;
