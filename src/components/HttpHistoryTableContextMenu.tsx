import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { Copy, Braces, Trash2, Send } from 'lucide-react';
import { RowContextMenuContext } from './Table';
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { addFuzzSession, DEFAULT_FUZZER_RAW_REQUEST } from '@/store/slices/fuzzerSlice';
import { SendToRepeaterSubmenu } from './ContextMenu/SendToReplayer';
import { invoke } from '@tauri-apps/api/core';
import { HttpHistory } from '@/types/http.type';

async function getFullItemPayload(row: any): Promise<{ rawRequest: string; rawResponse: string }> {
    if (row.rawRequest && row.rawRequest.length > 0) {
        return { rawRequest: row.rawRequest, rawResponse: row.rawResponse ?? '' };
    }
    try {
        const item = await invoke<HttpHistory | null>('get_http_history_item', { id: row.id });
        if (item) {
            return { rawRequest: item.rawRequest || '', rawResponse: item.rawResponse || '' };
        }
    } catch (e) {
        console.error('Failed to load item payload for context action:', e);
    }
    return { rawRequest: '', rawResponse: '' };
}

function ContextMenuSendToFuzzer({ row }: { row: any }) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const handleSend = async () => {
        if (!projectId) return;
        const { rawRequest } = await getFullItemPayload(row);
        const host = row.host || '';
        const targetUrl = host ? (host.includes('://') ? host : `https://${host}`) : 'https://';
        dispatch(
            addFuzzSession({
                name: 'From history',
                rawRequest: rawRequest || DEFAULT_FUZZER_RAW_REQUEST,
                targetUrl,
                isItFuzzerPage: false,
                projectId,
            })
        );
    };

    return (
        <ContextMenuItem onSelect={handleSend}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Send to Fuzzer
        </ContextMenuItem>
    );
}

export function renderHttpHistoryTableContextMenu(
    ctx: RowContextMenuContext<any>
): React.ReactNode {
    const {
        row,
        actionIds,
        isMultiple,
        onRemove,
    } = ctx;

    const copyRawRequest = async () => {
        const { rawRequest } = await getFullItemPayload(row);
        navigator.clipboard.writeText(rawRequest);
    };

    const copyRawResponse = async () => {
        const { rawResponse } = await getFullItemPayload(row);
        navigator.clipboard.writeText(rawResponse);
    };

    return (
        <>
            <ContextMenuLabel className="text-[11px] text-muted-foreground">
                {isMultiple ? `${actionIds.length} requests` : `Request #${actionIds[0]}`}
            </ContextMenuLabel>
            <ContextMenuSeparator />

            <ContextMenuSendToFuzzer row={row} />

            <SendToRepeaterSubmenu rawRequest={row.rawRequest || ''} />

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