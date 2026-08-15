import { ContextMenuItem } from '../ui/context-menu'
import { Send } from 'lucide-react'
import { addFuzzSession } from '@/store/slices/fuzzerSlice';
import { useAppDispatch } from '@/hooks/redux';
import { useProjectId } from '@/hooks/useProjectId';

const SendToFuzzer = ({ rawRequest, host }: { rawRequest: string, host: string }) => {
    const dispatch = useAppDispatch();
    const projectId = useProjectId();

    const sendToFuzzer = () => {
        if (!projectId) return;
        const targetUrl = host ? (host.includes('://') ? host : `https://${host}`) : 'https://';
        dispatch(addFuzzSession({ name: "From history", rawRequest: rawRequest, targetUrl, isItFuzzerPage: false, projectId }));
    };
    return (
        <ContextMenuItem onSelect={sendToFuzzer}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Send to Fuzzer
        </ContextMenuItem>
    )
}

export default SendToFuzzer

