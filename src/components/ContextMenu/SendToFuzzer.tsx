import { ContextMenuItem } from '../ui/context-menu'
import { Send } from 'lucide-react'
import { addFuzzSession } from '@/store/slices/fuzzerSlice';
import { useAppDispatch } from '@/hooks/redux';

const SendToFuzzer = ({ rawRequest, host }: any) => {
    const dispatch = useAppDispatch();

    const sendToFuzzer = () => {
        dispatch(addFuzzSession({ name: "From history", rawRequest: rawRequest, targetUrl: host }))
    };
    return (
        <ContextMenuItem onSelect={sendToFuzzer}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Send to Fuzzer
        </ContextMenuItem>
    )
}

export default SendToFuzzer

