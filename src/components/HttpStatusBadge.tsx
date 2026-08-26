import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function getStatusBadgeStyle(status?: string | number | null): string {
    if (status === undefined || status === null || status === '') return 'bg-muted text-muted-foreground border-border';
    const str = String(status).trim();
    const lower = str.toLowerCase();
    if (lower === 'pending') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
    if (lower === 'error') return 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
    if (lower === 'canceled' || lower === 'cancelled') return 'bg-muted text-muted-foreground border-border';

    const num = parseInt(str, 10);
    if (!isNaN(num)) {
        if (num >= 200 && num < 300) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
        if (num >= 300 && num < 400) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
        if (num >= 400 && num < 500) return 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
        if (num >= 500) return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30';
    }
    return 'bg-muted text-muted-foreground border-border';
}

export interface HttpStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    status?: string | number | null;
    showText?: boolean;
}

export const HttpStatusBadge: React.FC<HttpStatusBadgeProps> = ({
    status,
    showText = false,
    className,
    ...props
}) => {
    if (status === undefined || status === null || status === '') return null;

    const rawStr = String(status).trim();
    const match = rawStr.match(/^\d+/);
    const codeNumber = match ? parseInt(match[0], 10) : NaN;

    const displayCode = !isNaN(codeNumber)
        ? (showText ? rawStr : String(codeNumber))
        : rawStr;

    return (
        <Badge
            variant="outline"
            className={cn(
                'font-mono text-[11px] px-1.5 py-0 font-semibold inline-flex items-center justify-center select-none border',
                getStatusBadgeStyle(status),
                className
            )}
            {...props}
        >
            {displayCode}
        </Badge>
    );
};

export default HttpStatusBadge;
