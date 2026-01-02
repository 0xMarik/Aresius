import React from 'react';
import { useAppSelector } from '@/hooks/redux';

import RequestEditor from './fuzzer/request-editor/request-editor.component';
import PayloadConfigurator from './fuzzer/payloads-configurator.component';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';


const FuzzRequestPayload: React.FC = () => {

  const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate);
  if (activeSessionIndex === null) return null;
  if (fuzzerSessions[activeSessionIndex] === undefined) return null;
  // const { rawRequest } = fuzzerSessions[activeSessionIndex].payload;

  return (
    <>
      <ReactSplit
        direction={SplitDirection.Horizontal}
        initialSizes={[50, 50]}
        gutterClassName="custom-gutter-horizontal"
        draggerClassName="custom-dragger-horizontal"
        classes={["h-full"]}>
        <RequestEditor />
        {
          <PayloadConfigurator key={fuzzerSessions[activeSessionIndex].name} />

        }
      </ReactSplit>
    </>
  );
};

export default FuzzRequestPayload;
