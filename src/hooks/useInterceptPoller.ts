import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppDispatch, useAppSelector } from './redux';
import {
    setQueue,
    setSettings,
    InterceptItem,
    InterceptSettings,
} from '@/store/slices/interceptorSlice';

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
    const settings = useAppSelector((state) => state.interceptor.settings);

    const updateSettings = async (newSettings: InterceptSettings) => {
        dispatch(setSettings(newSettings));
        try {
            await invoke('set_intercept_settings', { settings: newSettings });
        } catch (err) {
            console.error('Failed to update intercept settings:', err);
        }
    };

    return { settings, updateSettings };
}

export function useInterceptPoller() {
    const dispatch = useAppDispatch();
    // Select ONLY the fields needed for the poller — never the full interceptor
    // object, because selecting `state.interceptor` causes App to re-render on
    // every setQueue / setSelectedId dispatch, cascading through the whole tree.
    const pollIntervalMs = useAppSelector((state) => state.interceptor.pollIntervalMs);
    const isPolling = useAppSelector((state) => state.interceptor.isPolling);
    const queue = useAppSelector((state) => state.interceptor.queue);
    const queueRef = useRef(queue);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    // Stable refs for interval config so the interval effect doesn't restart
    // when only queue changes (which would happen if we read from the closure).
    const pollIntervalMsRef = useRef(pollIntervalMs);
    const isPollingRef = useRef(isPolling);
    useEffect(() => { pollIntervalMsRef.current = pollIntervalMs; }, [pollIntervalMs]);
    useEffect(() => { isPollingRef.current = isPolling; }, [isPolling]);

    // Initial settings fetch
    useEffect(() => {
        invoke<InterceptSettings>('get_intercept_settings')
            .then((res) => {
                dispatch(setSettings(res));
            })
            .catch((err) => {
                console.error('Failed to get intercept settings:', err);
            });
    }, [dispatch]);

    // Sync settings change to Rust backend
    const updateSettings = async (newSettings: InterceptSettings) => {
        dispatch(setSettings(newSettings));
        try {
            await invoke('set_intercept_settings', { settings: newSettings });
        } catch (err) {
            console.error('Failed to update intercept settings:', err);
        }
    };

    // Polling hook for single queue state command
    useEffect(() => {
        if (!isPolling) return;

        let isMounted = true;

        const poll = async () => {
            try {
                const newQueue = await invoke<InterceptItem[]>('get_intercept_queue');
                if (isMounted && !isQueueEqual(newQueue, queueRef.current)) {
                    dispatch(setQueue(newQueue));
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
    }, [dispatch, pollIntervalMs, isPolling]);

    return {
        updateSettings,
    };
}
