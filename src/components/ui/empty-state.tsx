import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon,
    title,
    description,
    action,
    className,
}) => {
    return (
        <div className={cn("flex flex-col items-center justify-center h-full p-6 text-center select-none animate-in fade-in-50 duration-300", className)}>
            {Icon && (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground/80 mb-3 border border-border/40 shadow-xs">
                    <Icon className="h-6 w-6 stroke-[1.75]" />
                </div>
            )}
            <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
            {description && (
                <p className="mt-1 text-xs text-muted-foreground max-w-sm leading-relaxed">
                    {description}
                </p>
            )}
            {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
        </div>
    );
};
