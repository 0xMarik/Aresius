import { Copy } from "lucide-react";
import { ContextMenuItem, ContextMenuShortcut } from "../ui/context-menu";
import { EditorView } from "codemirror";
import SendToFuzzer from "../ContextMenu/SendToFuzzer";
import { useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { selectReplayerState } from "@/store/slices/replayerSlice";
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
    const projectId = useProjectId();
    const { collections, selectedCollectionIndex } = useAppSelector(selectReplayerState(projectId));
    const collection = collections[selectedCollectionIndex];
    const selectedSessionIndex = collection?.selectedSessionIndex ?? null;
    const session = selectedSessionIndex !== null && collection
        ? collection.sessions[selectedSessionIndex]
        : null;

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
            <SendToFuzzer rawRequest={session?.requestTmp ?? ""} host={session?.url ?? ""} />
            <ContextMenuItem />
        </>
    );
};

export default RequestContextMenu;