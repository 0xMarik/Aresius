import { ContextMenuItem } from '../ui/context-menu'
import { Send } from 'lucide-react'
import { addFuzzSession, DEFAULT_FUZZER_RAW_REQUEST } from '@/store/slices/fuzzerSlice';
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';
import { invoke } from '@tauri-apps/api/core';

const SendToFuzzer = ({ rawRequest, host }: { rawRequest: string, host: string }) => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const sendToFuzzer = async () => {
        if (!projectId) return;
        const targetUrl = host ? (host.includes('://') ? host : `https://${host}`) : 'https://';
        dispatch(addFuzzSession({ name: "From history", rawRequest: rawRequest, targetUrl, isItFuzzerPage: false, projectId }));
        try {
            await invoke('create_fuzzer_session_db', {
                projectId,
                name: "From history",
                targetUrl,
                rawRequest: rawRequest || DEFAULT_FUZZER_RAW_REQUEST,
            });
        } catch (e) {
            console.error('Failed to create fuzzer session in DB:', e);
        }
    };
    return (
        <ContextMenuItem onSelect={sendToFuzzer}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Send to Fuzzer
        </ContextMenuItem>
    )
}

export default SendToFuzzer

