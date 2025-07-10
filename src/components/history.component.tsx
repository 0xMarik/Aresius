import { useAppSelector } from '@/hooks/redux';
import { useParams } from 'react-router-dom';
import ResultsTable from './result-table.components';

interface ParamsType {
    isLoading: boolean
}

const FuzzerHistoryCompo = ({ isLoading}: ParamsType) => {
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
            <div>
                <ResultsTable
                    results={session.fuzzingHistory[Number(historyId)].requests}
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
};

export default FuzzerHistoryCompo