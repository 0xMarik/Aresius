import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
    Copy,
    Trash2,
    Braces,
} from 'lucide-react';
import { RowContextMenuContext } from '../Table';
import { EnrichedFuzzerRow } from './FuzzerHistory';
import SendToReplayer from '../ContextMenu/SendToReplayer';

export function renderFuzzerHistoryTableContextMenu(
    ctx: RowContextMenuContext<EnrichedFuzzerRow>
): React.ReactNode {
    const {
        row,
        actionIds,
        isMultiple,
        onRemove,
    } = ctx;

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
