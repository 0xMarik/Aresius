import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { Layers, FolderPlus, Copy, Braces, Circle, FolderMinus, Trash2 } from 'lucide-react';
import { useAppDispatch, } from '@/hooks/redux';
import { RowContextMenuContext } from './Table';
import SendToFuzzer from './ContextMenu/SendToFuzzer';
import SendToReplayer from './ContextMenu/SendToReplayer';





export function renderHttpHistoryTableContextMenu(
    ctx: RowContextMenuContext<any>
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
        navigator.clipboard.writeText(row.rawResponse ?? '');
    };



    return (
        <>
            <ContextMenuLabel className="text-[11px] text-muted-foreground">
                {isMultiple ? `${actionIds.length} requests` : `Request #${actionIds[0]}`}
            </ContextMenuLabel>
            <ContextMenuSeparator />

            <SendToFuzzer rawRequest={row.rawRequest} host={row.host} />

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