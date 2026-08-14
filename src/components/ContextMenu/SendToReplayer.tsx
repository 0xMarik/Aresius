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
    setReplayerLoadedData,
    setReplayerLoading,
    ReplayerCollectionMeta,
    ReplayerSessionCacheItem,
} from '@/store/slices/replayerSlice';
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
    const projectReplayer = useAppSelector(selectReplayerProjectState(projectId));
    const { collections, isLoaded, isLoading } = projectReplayer;

    useEffect(() => {
        if (!projectId || isLoaded || isLoading) return;
        dispatch(setReplayerLoading({ projectId, isLoading: true }));

        invoke<ReplayerFullData>('get_replayer_data', { projectId })
            .then((data) => {
                if (!data?.collections) {
                    dispatch(setReplayerLoadedData({
                        projectId,
                        collections: [],
                        selectedCollectionId: null,
                        selectedSessionId: null,
                        expandedIds: [],
                        sessionCache: {},
                    }));
                    return;
                }

                const cache: Record<string, ReplayerSessionCacheItem> = {};
                const treeCols: ReplayerCollectionMeta[] = [];

                let activeColId: string | null = null;
                let activeSessId: string | null = null;

                data.collections.forEach((c, cIdx) => {
                    const isColSelected = data.selectedCollectionIndex === cIdx;
                    if (isColSelected) activeColId = c.id;

                    const sessMetas = c.sessions.map((s, sIdx) => {
                        if (isColSelected && c.selectedSessionIndex === sIdx) activeSessId = s.id;
                        cache[s.id] = {
                            requestTmp: s.requestTmp,
                            url: s.url,
                            urlIsValid: s.urlIsValid,
                            history: s.history.map((h) => ({
                                id: h.id,
                                requestRaw: h.requestRaw,
                                responseRaw: h.responseRaw,
                                responseTime: h.responseTime,
                                requestTime: h.responseTime,
                                createdAt: h.createdAt,
                                status: h.status,
                                errorMessage: h.errorMessage,
                                baseUrl: h.baseUrl || s.url,
                            })),
                            selectedHistoryIndex: s.selectedHistoryIndex !== undefined && s.selectedHistoryIndex !== null
                                ? s.selectedHistoryIndex
                                : (s.history.length > 0 ? 0 : null),
                        };
                        return {
                            id: s.id,
                            name: s.name,
                            url: s.url,
                            urlIsValid: s.urlIsValid,
                        };
                    });

                    treeCols.push({
                        id: c.id,
                        name: c.name,
                        isExpanded: c.isExpanded !== false,
                        sessions: sessMetas,
                    });
                });

                if (!activeColId && treeCols.length > 0) activeColId = treeCols[0].id;
                const activeSessExists = activeSessId && treeCols.some(c => c.sessions.some(s => s.id === activeSessId));

                dispatch(setReplayerLoadedData({
                    projectId,
                    collections: treeCols,
                    selectedCollectionId: activeColId,
                    selectedSessionId: activeSessExists ? activeSessId : null,
                    expandedIds: data.expandedIds || treeCols.filter(c => c.isExpanded).map(c => c.id),
                    sessionCache: cache,
                }));
            })
            .catch((err) => {
                console.error('Failed to load replayer data for submenu:', err);
                dispatch(setReplayerLoading({ projectId, isLoading: false }));
            });
    }, [dispatch, isLoaded, isLoading, projectId]);

    const sendToExisting = async (collectionId: string, sessionCount: number) => {
        if (!projectId) return;
        const { url, urlIsValid } = getUrlFromRawRequest(rawRequest);
        const newSessId = crypto.randomUUID();
        const name = `Session ${sessionCount + 1}`;
        const requestTmp = rawRequest || 'GET / HTTP/1.1\r\n\r\n';

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
        const { url, urlIsValid } = getUrlFromRawRequest(rawRequest);
        const newColId = crypto.randomUUID();
        const newSessId = crypto.randomUUID();
        const colName = `Collection ${collections.length + 1}`;
        const requestTmp = rawRequest || 'GET / HTTP/1.1\r\n\r\n';

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
            {collections.map((col) => (
                <ContextMenuItem key={col.id} onSelect={() => sendToExisting(col.id, col.sessions.length)}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    {col.name}
                    {col.sessions.length > 0 && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            {col.sessions.length} session{col.sessions.length !== 1 ? 's' : ''}
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
