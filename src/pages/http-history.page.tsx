import { CodeMirrorEditor } from '@/components/result-table.components';
import HttpHistoryTable from '@/components/table.components'
import { useAppSelector } from '@/hooks/redux';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';
import { useState } from 'react';

const HTTPHisotry = () => {

    const { history } = useAppSelector(state => state.httpHistory);
    const [selectedRequest, setSelectedRequest] = useState<number | null>(null);

    return (
        <div className='overflow-hidden h-screen'>
            <ReactSplit
                direction={SplitDirection.Vertical}
                initialSizes={[40, 60]} // 👈 Initial widths: 40% left, 60% right
                // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
                // gutterClassName="custom-gutter-horizontal"
                // draggerClassName="custom-dragger-horizontal"
                classes={["py-1", "py-1"]}
            >
                <div className='overflow-scroll h-full'>
                    <HttpHistoryTable reqReses={history} setSelectedRequest={setSelectedRequest} />
                </div>
                <div className='h-full'>
                    <ReactSplit
                        direction={SplitDirection.Horizontal}
                        initialSizes={[50, 50]} // 👈 Initial widths: 40% left, 60% right
                        // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
                        gutterClassName="custom-gutter-horizontal"
                        draggerClassName="custom-dragger-horizontal"
                        classes={["py-1", "py-1"]}
                    >
                        <div className=' h-full'>
                            {
                                (selectedRequest === null) ? "select a request" : <CodeMirrorEditor value={history[selectedRequest].request} />
                            }
                        </div>
                        <div className=' h-full'>
                            {
                                (selectedRequest === null) ? "select a request" : <CodeMirrorEditor value={history[selectedRequest].response} />
                            }
                        </div>
                    </ReactSplit>
                </div>
                {/* <div className='bg-blue-500'>
                    
                </div> */}
            </ReactSplit>

        </div>
    )
}

export default HTTPHisotry
