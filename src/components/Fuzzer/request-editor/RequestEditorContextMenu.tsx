import { Plus } from "lucide-react";
import { EditorView } from "codemirror";
import { useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { selectFuzzerState } from "@/store/slices/fuzzerSlice";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import SendToReplayer from "@/components/ContextMenu/SendToReplayer";
import ConvertSelection from "@/components/ContextMenu/ConvertSelection";
import RequestCopyActions from "@/components/ContextMenu/RequestCopyActions";

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
            <RequestCopyActions
                rawRequest={fuzzConfig.rawRequest}
                targetUrl={fuzzConfig.metadata?.targetUrl}
                viewRef={viewRef}
            />
            {onAddParameter && (
                <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={onAddParameter}>
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add Fuzz Parameter
                    </ContextMenuItem>
                </>
            )}
            <ContextMenuSeparator />
            <SendToReplayer isMultiple={false} rawRequest={fuzzConfig.rawRequest} />
            <ContextMenuSeparator />
            <ConvertSelection viewRef={viewRef} />
        </>
    );
};

export default RequestEditorContextMenu;