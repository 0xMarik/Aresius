import { useEffect } from 'react';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '../ui/context-menu';
import { FolderPlus, Layers, Repeat } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import {
    incrementReplayerReceivedSession,
    selectReplayerProjectState,
    createSessionSuccess,
    createCollectionSuccess,
    fetchReplayerDataForProject,
} from '@/store/slices/replayerSlice';
import { parseRequest } from '@/components/utils';
import { invoke } from '@tauri-apps/api/core';

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

export function SendToRepeaterSubmenu({
    rawRequest = '',
    getRawRequest,
}: {
    rawRequest?: string;
    getRawRequest?: () => Promise<string> | string;
}) {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const projectReplayer = useAppSelector(selectReplayerProjectState(projectId));
    const { collections, isLoaded, isLoading } = projectReplayer;

    useEffect(() => {
        if (!projectId || isLoaded || isLoading) return;
        dispatch(fetchReplayerDataForProject(projectId));
    }, [dispatch, isLoaded, isLoading, projectId]);

    const resolveRawRequest = async (): Promise<string> => {
        if (rawRequest && rawRequest.trim().length > 0) return rawRequest;
        if (getRawRequest) {
            try {
                const fetched = await getRawRequest();
                if (fetched && fetched.trim().length > 0) return fetched;
            } catch (err) {
                console.error('Failed to resolve raw request:', err);
            }
        }
        return rawRequest || 'GET / HTTP/1.1\r\n\r\n';
    };

    const sendToExisting = async (collectionId: string, sessionCount: number) => {
        if (!projectId) return;
        const requestTmp = await resolveRawRequest();
        const { url, urlIsValid } = getUrlFromRawRequest(requestTmp);
        const newSessId = crypto.randomUUID();
        const name = `Session ${sessionCount + 1}`;

        dispatch(createSessionSuccess({
            projectId,
            collectionId,
            session: { id: newSessId, name, url, urlIsValid },
            cacheItem: {
                requestTmp,
                url,
                urlIsValid,
                history: [],
                selectedHistoryIndex: null,
            },
        }));

        dispatch(incrementReplayerReceivedSession({ projectId }));

        try {
            await invoke('create_replayer_session', {
                collectionId,
                sessionId: newSessId,
                name,
                baseUrl: url,
                requestTmp,
                sortOrder: sessionCount,
            });
        } catch (err) {
            console.error('Failed to send session to replayer:', err);
        }
    };

    const sendToNew = async () => {
        if (!projectId) return;
        const requestTmp = await resolveRawRequest();
        const { url, urlIsValid } = getUrlFromRawRequest(requestTmp);
        const newColId = crypto.randomUUID();
        const newSessId = crypto.randomUUID();
        const colName = `Collection ${collections.length + 1}`;

        dispatch(createCollectionSuccess({
            projectId,
            collection: { id: newColId, name: colName, isExpanded: true, sessions: [] },
        }));

        dispatch(createSessionSuccess({
            projectId,
            collectionId: newColId,
            session: { id: newSessId, name: 'Session 1', url, urlIsValid },
            cacheItem: {
                requestTmp,
                url,
                urlIsValid,
                history: [],
                selectedHistoryIndex: null,
            },
        }));

        dispatch(incrementReplayerReceivedSession({ projectId }));

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
                requestTmp,
                sortOrder: 0,
            });
        } catch (err) {
            console.error('Failed to create collection and send to replayer:', err);
        }
    };

    return (
        <>
            <ContextMenuSub>
                <ContextMenuSubTrigger disabled={collections.length === 0}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    Choose from collections
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                    {collections.length === 0 ? (
                        <ContextMenuItem disabled className="text-[11px] text-muted-foreground">
                            No collections found
                        </ContextMenuItem>
                    ) : (
                        collections.map((col) => (
                            <ContextMenuItem key={col.id} onSelect={() => sendToExisting(col.id, col.sessions.length)}>
                                <Layers className="mr-2 h-3.5 w-3.5" />
                                <span className="truncate">{col.name}</span>
                                {col.sessions.length > 0 && (
                                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                                        {col.sessions.length}
                                    </span>
                                )}
                            </ContextMenuItem>
                        ))
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            <ContextMenuItem onSelect={sendToNew}>
                <FolderPlus className="mr-2 h-3.5 w-3.5" />
                New collection
            </ContextMenuItem>
        </>
    );
}

const SendToReplayer = ({
    rawRequest = '',
    getRawRequest,
    isMultiple = false,
}: {
    rawRequest?: string;
    getRawRequest?: () => Promise<string> | string;
    isMultiple?: boolean;
}) => {
    return (
        <ContextMenuSub>
            <ContextMenuSubTrigger disabled={isMultiple}>
                <Repeat className="mr-2 h-3.5 w-3.5" />
                Send to Replayer
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
                <SendToRepeaterSubmenu rawRequest={rawRequest} getRawRequest={getRawRequest} />
            </ContextMenuSubContent>
        </ContextMenuSub>
    );
};

export default SendToReplayer;

