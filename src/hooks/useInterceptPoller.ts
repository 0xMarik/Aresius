import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppDispatch, useAppSelector } from './redux';
import {
    setQueue,
    setSettings,
    selectInterceptor,
    InterceptItem,
    InterceptSettings,
} from '@/store/slices/interceptorSlice';
import { useProjectId } from './useProjectId';

function isQueueEqual(a: InterceptItem[], b: InterceptItem[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (
            a[i].id !== b[i].id ||
            a[i].rawMessage !== b[i].rawMessage ||
            a[i].itemType !== b[i].itemType ||
            a[i].host !== b[i].host
        ) {
            return false;
        }
    }
    return true;
}

export function useInterceptSettings() {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const interceptor = useAppSelector(selectInterceptor(projectId));
    const settings = interceptor.settings;

    // Load persisted settings on project mount
    useEffect(() => {
        if (!projectId) return;
        invoke<{
            projectId: string;
            requestsEnabled: boolean;
            responsesEnabled: boolean;
            scopeFilterEnabled: boolean;
        } | null>('get_interceptor_settings_db', { projectId })
            .then((persisted) => {
                if (persisted) {
                    dispatch(
                        setSettings({
                            settings: {
                                requestsEnabled: Boolean(persisted.requestsEnabled),
                                responsesEnabled: Boolean(persisted.responsesEnabled),
                                scopeFilterEnabled: Boolean(persisted.scopeFilterEnabled),
                                activeScope: settings.activeScope ?? null,
                            },
                            projectId,
                        })
                    );
                }
            })
            .catch(() => {});

        invoke('sync_interception_filters_db', { projectId }).catch(() => {});
    }, [projectId, dispatch]);

    const updateSettings = async (newSettings: InterceptSettings) => {
        if (!projectId) return;
        dispatch(setSettings({ settings: newSettings, projectId }));
        try {
            await invoke('set_intercept_settings', { settings: newSettings });
            await invoke('save_interceptor_settings_db', {
                settings: {
                    projectId,
                    requestsEnabled: Boolean(newSettings.requestsEnabled),
                    responsesEnabled: Boolean(newSettings.responsesEnabled),
                    scopeFilterEnabled: Boolean(newSettings.scopeFilterEnabled),
                    updatedAt: Date.now(),
                },
            });
        } catch (err) {
            console.error('Failed to update intercept settings:', err);
        }
    };

    return { settings, updateSettings };
}

export function useInterceptPoller() {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();
    const interceptor = useAppSelector(selectInterceptor(projectId));

    const pollIntervalMs = interceptor.pollIntervalMs;
    const isPolling = interceptor.isPolling;
    const queue = interceptor.queue;
    const queueRef = useRef(queue);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    const pollIntervalMsRef = useRef(pollIntervalMs);
    const isPollingRef = useRef(isPolling);
    useEffect(() => { pollIntervalMsRef.current = pollIntervalMs; }, [pollIntervalMs]);
    useEffect(() => { isPollingRef.current = isPolling; }, [isPolling]);

    // Initial settings fetch
    useEffect(() => {
        if (!projectId) return;
        invoke<InterceptSettings>('get_intercept_settings')
            .then((res) => {
                dispatch(setSettings({ settings: res, projectId }));
            })
            .catch((err) => {
                console.error('Failed to get intercept settings:', err);
            });
    }, [dispatch, projectId]);

    // Sync settings change to Rust backend
    const updateSettings = async (newSettings: InterceptSettings) => {
        if (!projectId) return;
        dispatch(setSettings({ settings: newSettings, projectId }));
        try {
            await invoke('set_intercept_settings', { settings: newSettings });
        } catch (err) {
            console.error('Failed to update intercept settings:', err);
        }
    };

    // Polling hook for single queue state command
    useEffect(() => {
        if (!isPolling || !projectId) return;

        let isMounted = true;

        const poll = async () => {
            try {
                const newQueue = await invoke<InterceptItem[]>('get_intercept_queue');
                if (isMounted && !isQueueEqual(newQueue, queueRef.current)) {
                    dispatch(setQueue({ items: newQueue, projectId }));
                }
            } catch (err) {
                console.error('Failed to poll intercept queue:', err);
            }
        };

        poll();
        const intervalId = setInterval(poll, pollIntervalMs);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [dispatch, pollIntervalMs, isPolling, projectId]);

    return {
        updateSettings,
    };
}
