import React from 'react';
import { cn } from '@/lib/utils';

export interface ViewModeTabsProps {
    mode: 'raw' | 'pretty';
    onChange: (mode: 'raw' | 'pretty') => void;
    className?: string;
}

export const ViewModeTabs: React.FC<ViewModeTabsProps> = ({ mode, onChange, className }) => {
    return (
        <div className={cn("flex items-center rounded-md bg-muted/40 p-0.5 border border-border/40 select-none", className)}>
            {(['raw', 'pretty'] as const).map((m) => (
                <button
                    key={m}
                    type="button"
                    onClick={() => onChange(m)}
                    className={cn(
                        'px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
                        mode === m
                            ? 'bg-background text-foreground shadow-xs font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {m}
                </button>
            ))}
        </div>
    );
};

export default ViewModeTabs;
