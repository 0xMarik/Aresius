import { ArrowLeftRight, Copy } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "../ui/context-menu";
import { EditorView } from "codemirror";
import SendToFuzzer from "../ContextMenu/SendToFuzzer";
import { useReplayerEditor } from "@/context/ReplayerContext";
import { toggleRequestMethod } from "../utils";
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
    const currentMethod = activeDraft?.requestTmp?.trim()?.split(/\s+/)[0]?.toUpperCase() || 'GET';
    const targetMethod = currentMethod === 'GET' ? 'POST' : 'GET';

    const handleChangeMethod = () => {
        const view = viewRef.current;
        if (!view) return;
        const currentDoc = view.state.sliceDoc(0, view.state.doc.length);
        const newDoc = toggleRequestMethod(currentDoc);
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newDoc },
        });
    };

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
            <ContextMenuItem onSelect={handleChangeMethod}>
                <ArrowLeftRight className="mr-2 h-3.5 w-3.5" />
                Change request method ({targetMethod})
            </ContextMenuItem>
            <ContextMenuSeparator />
            <SendToFuzzer rawRequest={activeDraft?.requestTmp ?? ""} host={activeDraft?.url ?? ""} />
        </>
    );
};

export default RequestContextMenu;