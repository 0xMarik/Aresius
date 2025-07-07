import { useAppSelector } from '@/hooks/redux';
import { useParams } from 'react-router-dom';

const FuzzerHistoryCompo = () => {
    const { historyId } = useParams();
    console.log("History ID:", historyId);

    if (!historyId) {
        return <div>No history ID provided</div>;
    }

    const { fuzzerSessions, activeSessionIndex } = useAppSelector(state => state.fuzzerstate);
    if (activeSessionIndex === null) {
        return <div>No active session selected</div>;
    }
    const session = fuzzerSessions[activeSessionIndex]

    if (!session) {
        return <div>Session not found</div>;
    }

    return (
        <div>
            <h1>Fuzzing session ID: {historyId}</h1>
            <div>
                {session.fuzzingHistory[Number(historyId)].date}
            </div>
        </div>
    );
};

export default FuzzerHistoryCompo