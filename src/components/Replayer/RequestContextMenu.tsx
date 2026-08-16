import { ArrowLeftRight } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "../ui/context-menu";
import { EditorView } from "codemirror";
import SendToFuzzer from "../ContextMenu/SendToFuzzer";
import ConvertSelection from "../ContextMenu/ConvertSelection";
import RequestCopyActions from "../ContextMenu/RequestCopyActions";
import { useReplayerEditor } from "@/context/ReplayerContext";
import { toggleRequestMethod } from "../utils";

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
            <RequestCopyActions
                rawRequest={activeDraft?.requestTmp}
                targetUrl={activeDraft?.url}
                viewRef={viewRef}
            />
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleChangeMethod}>
                <ArrowLeftRight className="mr-2 h-3.5 w-3.5" />
                Change request method ({targetMethod})
            </ContextMenuItem>
            <ContextMenuSeparator />
            <SendToFuzzer rawRequest={activeDraft?.requestTmp ?? ""} host={activeDraft?.url ?? ""} />
            <ContextMenuSeparator />
            <ConvertSelection viewRef={viewRef} />
        </>
    );
};

export default RequestContextMenu;