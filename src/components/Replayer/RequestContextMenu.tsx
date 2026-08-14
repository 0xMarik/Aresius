import { Copy } from "lucide-react";
import { ContextMenuItem, ContextMenuShortcut } from "../ui/context-menu";
import { EditorView } from "codemirror";
import SendToFuzzer from "../ContextMenu/SendToFuzzer";
import { useReplayerEditor } from "@/context/ReplayerContext";
import { Kbd, KbdGroup } from "../ui/kbd";

const handleCopy = ({ viewRef }: { viewRef: React.MutableRefObject<EditorView | null> }) => {
    const view = viewRef.current;
    if (!view) return;

    const { state } = view;
    const { from, to, empty } = state.selection.main;

    const text = empty
        ? state.sliceDoc(0, state.doc.length)
        : state.sliceDoc(from, to);

    navigator.clipboard.writeText(text);
};

const RequestContextMenu = ({ viewRef }: { viewRef: React.MutableRefObject<EditorView | null> }) => {
    const { activeDraft } = useReplayerEditor();

    return (
        <>
            <ContextMenuItem onSelect={() => handleCopy({ viewRef })}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy
                <ContextMenuShortcut>
                    <KbdGroup>
                        <Kbd>Ctrl</Kbd>
                        <span>+</span>
                        <Kbd>C</Kbd>
                    </KbdGroup>
                </ContextMenuShortcut>
            </ContextMenuItem>
            <SendToFuzzer rawRequest={activeDraft?.requestTmp ?? ""} host={activeDraft?.url ?? ""} />
            <ContextMenuItem />
        </>
    );
};

export default RequestContextMenu;