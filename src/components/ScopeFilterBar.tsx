import React from 'react';
import { cn } from '@/lib/utils';
import type { Scope } from '@/store/slices/scopeSlice';

export type ScopeFilterOption = 'all' | 'in' | 'out';

export interface ScopeFilterBarProps {
    activeScope: Scope | null | undefined;
    value: ScopeFilterOption;
    onChange: (value: ScopeFilterOption) => void;
    className?: string;
}

export const ScopeFilterBar: React.FC<ScopeFilterBarProps> = ({
    activeScope,
    value,
    onChange,
    className,
}) => {
    if (!activeScope) return null;

    return (
        <div
            className={cn(
                'flex items-center justify-between gap-3 px-3 py-1.5 bg-card/30 border-b border-border/60 text-xs shrink-0',
                className
            )}
        >
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mr-1">
                    Scope
                </span>
                {(['all', 'in', 'out'] as const).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => onChange(f)}
                        className={cn(
                            'px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors border',
                            value === f
                                ? f === 'in'
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                    : f === 'out'
                                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400'
                                        : 'bg-primary/10 border-primary/30 text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                        )}
                    >
                        {f === 'all' ? 'All' : f === 'in' ? 'In Scope' : 'Out of Scope'}
                    </button>
                ))}
            </div>

            {/* Active Scope info */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                    className="w-2 h-2 rounded-full inline-block shrink-0"
                    style={{ backgroundColor: activeScope.color }}
                />
                <span className="font-semibold text-foreground truncate max-w-[200px]">
                    {activeScope.name}
                </span>
            </div>
        </div>
    );
};

export default ScopeFilterBar;
