import { useState, useCallback, RefObject } from 'react';
import { getHttpqlSuggestions, AutocompleteSuggestion } from '@/lib/httpql/autocomplete';

export interface UseHttpqlAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
    dynamicPresets?: { alias: string; name: string; description?: string }[];
}

export function useHttpqlAutocomplete({
    value,
    onChange,
    inputRef,
    dynamicPresets,
}: UseHttpqlAutocompleteProps) {
    const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
    const [replacementRange, setReplacementRange] = useState<{ start: number; end: number }>({
        start: 0,
        end: 0,
    });

    const updateSuggestions = useCallback(
        (text: string, pos: number) => {
            const { suggestions: list, startPos, endPos } = getHttpqlSuggestions(
                text,
                pos,
                dynamicPresets
            );
            setSuggestions(list);
            setSelectedIndex(0);
            setShowSuggestions(list.length > 0);
            setReplacementRange({ start: startPos, end: endPos });
        },
        [dynamicPresets]
    );

    const applySuggestion = useCallback(
        (suggestion: AutocompleteSuggestion) => {
            const text = value;
            const before = text.slice(0, replacementRange.start);
            const after = text.slice(replacementRange.end);
            const newText =
                before +
                suggestion.replacement +
                (after.startsWith(' ') || suggestion.replacement.endsWith(' ')
                    ? after
                    : after
                    ? ' ' + after
                    : '');

            onChange(newText);

            const newPos = before.length + suggestion.replacement.length;

            if (suggestion.hasMoreLayers) {
                updateSuggestions(newText, newPos);
            } else {
                setShowSuggestions(false);
            }

            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.setSelectionRange(newPos, newPos);
                }
            }, 10);
        },
        [value, replacementRange, onChange, inputRef, updateSuggestions]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
            if (showSuggestions && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex((prev) => (prev + 1) % suggestions.length);
                    return true;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                    return true;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    if (suggestions[selectedIndex]) {
                        e.preventDefault();
                        applySuggestion(suggestions[selectedIndex]);
                        return true;
                    }
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowSuggestions(false);
                    return true;
                }
            }
            return false;
        },
        [showSuggestions, suggestions, selectedIndex, applySuggestion]
    );

    return {
        suggestions,
        selectedIndex,
        showSuggestions,
        setShowSuggestions,
        updateSuggestions,
        handleKeyDown,
        applySuggestion,
    };
}

export default useHttpqlAutocomplete;
