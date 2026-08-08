import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '../ui/context-menu'
import { FolderPlus, Layers, Repeat } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { addCollection, addSessionToCollection, selectColSess, setReaplayerContent, selectReplayerState } from '@/store/slices/replayerSlice';

export function SendToRepeaterSubmenu({ rawRequest }: { rawRequest: string }) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const { collections } = useAppSelector(selectReplayerState(projectId));

    const sendToExisting = (collectionIndex: number) => {
        if (!projectId) return;
        const newSessionIndex = collections[collectionIndex].sessions.length;
        dispatch(addSessionToCollection({ collectionIndex, isItReplayerPage: false, projectId }));
        dispatch(selectColSess({ collectionIndex, sessionIndex: newSessionIndex, projectId }));
        dispatch(setReaplayerContent({ rawRequest: rawRequest ?? '', projectId }));
    };

    const sendToNew = () => {
        if (!projectId) return;
        const newCollectionIndex = collections.length;
        dispatch(addCollection(projectId));
        dispatch(selectColSess({ collectionIndex: newCollectionIndex, sessionIndex: 0, projectId }));
        dispatch(setReaplayerContent({ rawRequest: rawRequest ?? '', projectId }));
    };

    return (
        <>
            {collections.map((collection, index) => (
                <ContextMenuItem key={index} onSelect={() => sendToExisting(index)}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    Collection {index + 1}
                    {collection.sessions.length > 0 && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            {collection.sessions.length} session{collection.sessions.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </ContextMenuItem>
            ))}
            {collections.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={sendToNew}>
                <FolderPlus className="mr-2 h-3.5 w-3.5" />
                New collection
            </ContextMenuItem>
        </>
    );
}

const SendToReplayer = ({ rawRequest, isMultiple }: { rawRequest: string; isMultiple: boolean }) => {
    return (
        <ContextMenuSub>
            <ContextMenuSubTrigger disabled={isMultiple}>
                <Repeat className="mr-2 h-3.5 w-3.5" />
                Send to Replayer
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
                <SendToRepeaterSubmenu rawRequest={rawRequest} />
            </ContextMenuSubContent>
        </ContextMenuSub>
    )
}

export default SendToReplayer;
