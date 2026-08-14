import { useEffect, useState } from 'react';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '../ui/context-menu';
import { FolderPlus, Layers, Repeat } from 'lucide-react';
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { incrementReplayerReceivedSession } from '@/store/slices/replayerSlice';
import { parseRequest } from '@/components/utils';
import { invoke } from '@tauri-apps/api/core';
import { ReplayerFullData } from '@/types/replayer.type';

function getUrlFromRawRequest(rawRequest?: string): { url: string; urlIsValid: boolean } {
    if (!rawRequest) return { url: 'https://', urlIsValid: false };
    const req = parseRequest(rawRequest);
    const hostHeader = Object.entries(req.headers || {}).find(
        ([k]) => k.toLowerCase() === 'host'
    )?.[1]?.trim();

    if (hostHeader) {
        const url = hostHeader.includes('://') ? hostHeader : `https://${hostHeader}`;
        return { url, urlIsValid: true };
    }
    return { url: 'https://', urlIsValid: false };
}

export function SendToRepeaterSubmenu({ rawRequest }: { rawRequest: string }) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const [collections, setCollections] = useState<Array<{ id: string; name: string; sessionCount: number }>>([]);

    useEffect(() => {
        if (!projectId) return;
        invoke<ReplayerFullData>('get_replayer_data', { projectId })
            .then((data) => {
                if (data?.collections) {
                    setCollections(data.collections.map(c => ({
                        id: c.id,
                        name: c.name,
                        sessionCount: c.sessions.length,
                    })));
                }
            })
            .catch(console.error);
    }, [projectId]);

    const sendToExisting = async (collectionId: string, sessionCount: number) => {
        if (!projectId) return;
        const { url } = getUrlFromRawRequest(rawRequest);
        const newSessId = crypto.randomUUID();
        const name = `Session ${sessionCount + 1}`;
        try {
            await invoke('create_replayer_session', {
                collectionId,
                sessionId: newSessId,
                name,
                baseUrl: url,
                requestTmp: rawRequest || 'GET / HTTP/1.1\r\n\r\n',
                sortOrder: sessionCount,
            });
            dispatch(incrementReplayerReceivedSession({ projectId }));
        } catch (err) {
            console.error('Failed to send session to replayer:', err);
        }
    };

    const sendToNew = async () => {
        if (!projectId) return;
        const { url } = getUrlFromRawRequest(rawRequest);
        const newColId = crypto.randomUUID();
        const newSessId = crypto.randomUUID();
        const colName = `Collection ${collections.length + 1}`;

        try {
            await invoke('create_replayer_collection', {
                projectId,
                collectionId: newColId,
                name: colName,
                sortOrder: collections.length,
            });

            await invoke('create_replayer_session', {
                collectionId: newColId,
                sessionId: newSessId,
                name: 'Session 1',
                baseUrl: url,
                requestTmp: rawRequest || 'GET / HTTP/1.1\r\n\r\n',
                sortOrder: 0,
            });

            dispatch(incrementReplayerReceivedSession({ projectId }));
        } catch (err) {
            console.error('Failed to create collection and send to replayer:', err);
        }
    };

    return (
        <>
            {collections.map((col) => (
                <ContextMenuItem key={col.id} onSelect={() => sendToExisting(col.id, col.sessionCount)}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    {col.name}
                    {col.sessionCount > 0 && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            {col.sessionCount} session{col.sessionCount !== 1 ? 's' : ''}
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
    );
};

export default SendToReplayer;
