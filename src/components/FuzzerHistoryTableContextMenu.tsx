import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
    Repeat,
    Copy,
    FolderPlus,
    Layers,
    FolderMinus,
    Trash2,
    Circle,
    Braces,
} from 'lucide-react';
import { RowContextMenuContext } from './Table';
import { EnrichedFuzzerRow } from './FuzzerHistory';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { addCollection, addSessionToCollection, selectColSess, setReaplayerContent } from '@/store/slices/replayerSlice';
import SendToReplayer from './ContextMenu/SendToReplayer';

export function renderFuzzerHistoryTableContextMenu(
    ctx: RowContextMenuContext<EnrichedFuzzerRow>
): React.ReactNode {
    const {
        row,
        actionIds,
        isMultiple,
        group,
        groups,
        onCreateGroup,
        onAssignToGroup,
        onUngroup,
        onRemove,
    } = ctx;

    const otherGroups = groups.filter((g) => g.id !== group?.id);

    const copyRawRequest = () => {
        navigator.clipboard.writeText(row.rawRequest ?? '');
    };

    const copyRawResponse = () => {
        navigator.clipboard.writeText(row.response?.rawResponse ?? '');
    };

    return (
        <>
            <ContextMenuLabel className="text-[11px] text-muted-foreground">
                {isMultiple ? `${actionIds.length} requests` : `Request #${actionIds[0]}`}
            </ContextMenuLabel>
            <ContextMenuSeparator />

            <SendToReplayer rawRequest={row.rawRequest} isMultiple={isMultiple} />

            <ContextMenuSub>
                <ContextMenuSubTrigger>
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Copy
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    <ContextMenuItem onSelect={copyRawRequest} disabled={isMultiple}>
                        <Braces className="mr-2 h-3.5 w-3.5" />
                        Raw request
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={copyRawResponse} disabled={isMultiple}>
                        <Braces className="mr-2 h-3.5 w-3.5" />
                        Raw response
                    </ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            <ContextMenuItem onSelect={() => onCreateGroup(actionIds)}>
                <FolderPlus className="mr-2 h-3.5 w-3.5" />
                New group
            </ContextMenuItem>

            <ContextMenuSub>
                <ContextMenuSubTrigger disabled={otherGroups.length === 0}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    Add to group
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    {otherGroups.length === 0 && (
                        <ContextMenuItem disabled>No other groups yet</ContextMenuItem>
                    )}
                    {otherGroups.map((g) => (
                        <ContextMenuItem key={g.id} onSelect={() => onAssignToGroup(actionIds, g.id)}>
                            <Circle className="mr-2 h-3 w-3" style={{ color: g.color, fill: g.color }} />
                            {g.name}
                        </ContextMenuItem>
                    ))}
                </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem onSelect={() => onUngroup(actionIds)} disabled={!group}>
                <FolderMinus className="mr-2 h-3.5 w-3.5" />
                Ungroup
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
                onSelect={() => onRemove(actionIds)}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Remove
            </ContextMenuItem>
        </>
    );
}

function SendToRepeaterSubmenu({ row }: { row: EnrichedFuzzerRow }) {
    const dispatch = useAppDispatch();
    const collections = useAppSelector(state => state.replayerstate.collections);

    const sendToExisting = (collectionIndex: number) => {
        const newSessionIndex = collections[collectionIndex].sessions.length;
        dispatch(addSessionToCollection({ collectionIndex }));
        dispatch(selectColSess({ collectionIndex, sessionIndex: newSessionIndex }));
        dispatch(setReaplayerContent({ rawRequest: row.rawRequest ?? '' }));
    };

    const sendToNew = () => {
        const newCollectionIndex = collections.length;
        dispatch(addCollection());
        dispatch(selectColSess({ collectionIndex: newCollectionIndex, sessionIndex: 0 }));
        dispatch(setReaplayerContent({ rawRequest: row.rawRequest ?? '' }));
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