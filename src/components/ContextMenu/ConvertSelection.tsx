import React from 'react';
import {
    ContextMenuItem,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { Binary } from 'lucide-react';
import { EditorView } from 'codemirror';
import { urlEncodeKeyChars, urlEncodeAllChars } from '@/pages/sitemap/utils';

export interface ConvertSelectionProps {
    viewRef?: React.MutableRefObject<EditorView | null>;
    text?: string;
    getText?: () => string;
    onConvert?: (encodedText: string) => void;
    disabled?: boolean;
}

export const ConvertSelection: React.FC<ConvertSelectionProps> = ({
    viewRef,
    text,
    getText,
    onConvert,
    disabled,
}) => {
    // Determine selected text and whether selection is active
    let activeSelectedText = '';
    let hasValidSelection = false;

    if (viewRef?.current) {
        const view = viewRef.current;
        const { from, to, empty } = view.state.selection.main;
        if (!empty && to > from) {
            activeSelectedText = view.state.sliceDoc(from, to);
            hasValidSelection = activeSelectedText.length > 0;
        }
    } else if (getText) {
        activeSelectedText = getText();
        hasValidSelection = activeSelectedText.length > 0;
    } else if (typeof window !== 'undefined') {
        const sel = window.getSelection()?.toString();
        if (sel && sel.length > 0) {
            activeSelectedText = sel;
            hasValidSelection = true;
        } else if (text && text.length > 0) {
            activeSelectedText = text;
            hasValidSelection = true;
        }
    }

    const isTriggerDisabled = disabled !== undefined ? disabled : !hasValidSelection;

    const applyEncodedText = (encoded: string) => {
        if (viewRef?.current) {
            const view = viewRef.current;
            const { from, to, empty } = view.state.selection.main;
            if (!empty && to > from) {
                view.dispatch({
                    changes: { from, to, insert: encoded },
                    selection: { anchor: from, head: from + encoded.length },
                });
                return;
            }
        }

        if (onConvert) {
            onConvert(encoded);
            return;
        }

        navigator.clipboard.writeText(encoded);
    };

    const handleUrlEncodeKey = () => {
        if (!activeSelectedText) return;
        const encoded = urlEncodeKeyChars(activeSelectedText);
        applyEncodedText(encoded);
    };

    const handleUrlEncodeAll = () => {
        if (!activeSelectedText) return;
        const encoded = urlEncodeAllChars(activeSelectedText);
        applyEncodedText(encoded);
    };

    return (
        <ContextMenuSub>
            <ContextMenuSubTrigger disabled={isTriggerDisabled}>
                <Binary className="mr-2 h-3.5 w-3.5" />
                Convert selection to
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52 text-xs">
                <ContextMenuSub>
                    <ContextMenuSubTrigger>
                        URL encode
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-56 text-xs">
                        <ContextMenuItem onSelect={handleUrlEncodeKey}>
                            Key characters
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handleUrlEncodeAll}>
                            All characters
                        </ContextMenuItem>
                    </ContextMenuSubContent>
                </ContextMenuSub>
            </ContextMenuSubContent>
        </ContextMenuSub>
    );
};

export default ConvertSelection;
