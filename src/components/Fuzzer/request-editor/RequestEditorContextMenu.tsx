import { Copy, Plus } from "lucide-react";
import { EditorView } from "codemirror";
import { useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { selectFuzzerState } from "@/store/slices/fuzzerSlice";
import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/context-menu";
import SendToReplayer from "@/components/ContextMenu/SendToReplayer";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

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

const RequestEditorContextMenu = ({
    viewRef,
    onAddParameter,
}: {
    viewRef: React.MutableRefObject<EditorView | null>;
    onAddParameter?: () => void;
}) => {
    const projectId = useProjectId();
    const { fuzzerSessions, activeSessionIndex } = useAppSelector(selectFuzzerState(projectId));
    if (activeSessionIndex === null || !fuzzerSessions[activeSessionIndex]) return null;
    const { fuzzConfig } = fuzzerSessions[activeSessionIndex];

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
            {onAddParameter && (
                <ContextMenuItem onSelect={onAddParameter}>
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Add Fuzz Parameter
                </ContextMenuItem>
            )}
            <SendToReplayer isMultiple={false} rawRequest={fuzzConfig.rawRequest} />
        </>
    );
};

export default RequestEditorContextMenu;