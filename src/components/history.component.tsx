import { useAppSelector } from '@/hooks/redux';
import ResultsTable from './result-table.components';

interface ParamsType {
    isLoading: boolean
}

const FuzzerHistoryCompo = ({ isLoading }: ParamsType) => {

    const { fuzzerSessions, activeSessionIndex } = useAppSelector(state => state.fuzzerstate);

    if (activeSessionIndex === null) {
        return <div>No active session selected</div>;
    }

    const session = fuzzerSessions[activeSessionIndex];

    if (!session) {
        return <div>Session not found</div>;
    }

    const { selectedHistoryIndex } = session;

    if (selectedHistoryIndex === null) {
        return <div>No history entry selected</div>;
    }

    const historyEntry = session.fuzzingHistory[selectedHistoryIndex];

    if (!historyEntry) {
        return <div>History entry not found</div>;
    }

    return (
        <div className='h-full'>
            <ResultsTable
                results={historyEntry.requests}
                isLoading={isLoading}
            />
        </div>
    );
};

export default FuzzerHistoryCompo