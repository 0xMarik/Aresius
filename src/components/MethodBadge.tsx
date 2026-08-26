import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const METHOD_COLORS: Record<string, string> = {
    GET: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
    POST: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    PUT: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    DELETE: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
    PATCH: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
    HEAD: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
    OPTIONS: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
    CONNECT: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/30',
    TRACE: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
};

export function getMethodColor(method?: string | null, selected?: boolean): string {
    if (selected) return 'bg-primary-foreground/15 text-primary-foreground border-transparent';
    if (!method) return 'bg-muted text-muted-foreground border-border';
    const normalized = method.trim().toUpperCase();
    return METHOD_COLORS[normalized] ?? 'bg-muted text-muted-foreground border-border';
}

export interface MethodBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    method?: string | null;
    selected?: boolean;
}

export const MethodBadge: React.FC<MethodBadgeProps> = ({
    method,
    selected = false,
    className,
    ...props
}) => {
    const displayMethod = (method || 'GET').trim().toUpperCase();
    return (
        <Badge
            variant="outline"
            className={cn(
                'font-mono text-[11px] px-1.5 py-0 font-medium inline-flex items-center justify-center select-none',
                getMethodColor(displayMethod, selected),
                className
            )}
            {...props}
        >
            {displayMethod}
        </Badge>
    );
};

export default MethodBadge;
