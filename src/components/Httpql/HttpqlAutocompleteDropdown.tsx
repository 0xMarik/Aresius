import React from 'react';
import { AutocompleteSuggestion } from '@/lib/httpql/autocomplete';

export interface HttpqlAutocompleteDropdownProps {
    suggestions: AutocompleteSuggestion[];
    selectedIndex: number;
    onSelect: (suggestion: AutocompleteSuggestion) => void;
    className?: string;
}

export const HttpqlAutocompleteDropdown: React.FC<HttpqlAutocompleteDropdownProps> = ({
    suggestions,
    selectedIndex,
    onSelect,
    className = '',
}) => {
    if (suggestions.length === 0) return null;

    return (
        <div
            className={`absolute top-[calc(100%+3px)] left-0 w-full max-w-lg max-h-52 overflow-y-auto bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-md p-0.5 text-xs divide-y divide-border/20 z-50 animate-in fade-in-50 zoom-in-95 duration-100 ${className}`}
        >
            {suggestions.map((s, idx) => (
                <div
                    key={s.id}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(s);
                    }}
                    className={`px-2.5 py-1.5 rounded flex items-center justify-between cursor-pointer transition-colors ${
                        idx === selectedIndex
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'hover:bg-accent/60 text-foreground'
                    }`}
                >
                    <span className="font-mono text-[11.5px] truncate">
                        {s.displayText || s.text}
                    </span>
                    <span
                        className={`text-[10.5px] truncate max-w-[220px] ml-2 ${
                            idx === selectedIndex ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        }`}
                    >
                        {s.description}
                    </span>
                </div>
            ))}
        </div>
    );
};

export default HttpqlAutocompleteDropdown;
