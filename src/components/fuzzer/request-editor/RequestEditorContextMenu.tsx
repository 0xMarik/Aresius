import { Copy } from "lucide-react";
import { EditorView } from "codemirror";
import { useAppSelector } from "@/hooks/redux";
import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/context-menu";
import SendToReplayer from "@/components/ContextMenu/SendToReplayer";

const handleCopy = ({ viewRef }: { viewRef: React.MutableRefObject<EditorView | null> }) => {
    const view = viewRef.current;
    if (!view) return;

    const { state } = view;
    const { from, to, empty } = state.selection.main;

    // selection present -> copy just that; otherwise copy the whole doc
    const text = empty
        ? state.sliceDoc(0, state.doc.length)
        : state.sliceDoc(from, to);

    navigator.clipboard.writeText(text);
};

const RequestEditorContextMenu = ({ viewRef }: { viewRef: React.MutableRefObject<EditorView | null> }) => {
    const { fuzzerSessions, activeSessionIndex } = useAppSelector(state => state.fuzzerstate);
    if (activeSessionIndex === null) return;
    const { fuzzConfig } = fuzzerSessions[activeSessionIndex];


    return (
        <>
            <ContextMenuItem onSelect={() => handleCopy({ viewRef })}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy
                <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <SendToReplayer isMultiple={false} rawRequest={fuzzConfig.rawRequest} />
        </>
    );
};

export default RequestEditorContextMenu;