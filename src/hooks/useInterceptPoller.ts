import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppDispatch, useAppSelector } from './redux';
import {
    setQueue,
    setSettings,
    InterceptItem,
    InterceptSettings,
} from '@/store/slices/interceptorSlice';

export function useInterceptPoller() {
    const dispatch = useAppDispatch();
    const { pollIntervalMs, isPolling, settings } = useAppSelector((state) => state.interceptor);
    const settingsRef = useRef(settings);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

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
                const queue = await invoke<InterceptItem[]>('get_intercept_queue');
                if (isMounted) {
                    dispatch(setQueue(queue));
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
