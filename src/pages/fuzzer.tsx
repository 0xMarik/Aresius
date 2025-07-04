
// // import High from "../High";
// // import { TabsDemo } from "../components/card-tab";
// import RequestEditor from '@/components/request-editor.component'
// import ReactSplit, { SplitDirection } from '@devbookhq/splitter'


// const Fuzzer = () => {
//   return (
//     <>
//       <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-16">
//         Header
//       </div>
//       <ReactSplit
//         direction={SplitDirection.Horizontal}
//         initialSizes={[50, 50]} // 👈 Initial widths: 40% left, 60% right
//         // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
//         gutterClassName="custom-gutter-horizontal"
//         draggerClassName="custom-dragger-horizontal"
//         classes={["py-1", "py-1"]}
//       >
//         <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
//           <RequestEditor />
//         </div>
//         <div className='bg-muted/50 aspect-video rounded-lg p-1 w-full h-full'>
//         </div>

//       </ReactSplit>
//     </>

//     // <div className="flex flex-1 flex-col gap-4 p-4">
//     //   <div className="grid auto-rows-min gap-4 md:grid-cols-2">
//     //     <div className="bg-muted/50 aspect-video rounded-xl">
//     //       <High />
//     //     </div>
//     //     <div className="bg-muted/50 aspect-video rounded-xl">
//     //       <TabsDemo />
//     //     </div>
//     //   </div>
//     //   <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
//     // </div>
//   )
// }

// export default Fuzzer

import { useRef, useEffect, useState } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import RequestEditor from '@/components/request-editor.component';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { Input } from '@/components/ui/input';
import PayloadConfigurator from '@/components/payloads-configurator.component';

// Type definitions
interface AsyncResponse {
  request_id: string;
}

interface RequestCompletedPayload {
  request_id: string;
  result?: string;
  error?: string;
}

interface FuzzParameter {
  id: string;
  placeholder: string;
  values: string[];
  currentIndex: number;
}

interface RequestResult {
  id: string;
  request: string;
  response: string;
  status: 'pending' | 'completed' | 'error';
  timestamp: Date;
}


const Fuzzer: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedText, setSelectedText] = useState<string>('');
  const [showFuzzModal, setShowFuzzModal] = useState<boolean>(false);
  const [fuzzParameters, setFuzzParameters] = useState<FuzzParameter[]>([]);
  const [results, setResults] = useState<RequestResult[]>([]);

  const activeRequestsRef = useRef<Set<string>>(new Set());
  const editorRef = useRef<any>(null);

  // Set up the event listener
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<RequestCompletedPayload>('request-completed', (event) => {
        const { request_id, result: requestResult, error } = event.payload;

        if (activeRequestsRef.current.has(request_id)) {
          const responseText = error ? `Error: ${error}` : requestResult || 'No result';

          setResults(prev =>
            prev.map(r =>
              r.id === request_id
                ? { ...r, response: responseText, status: error ? 'error' : 'completed' }
                : r
            )
          );

          activeRequestsRef.current.delete(request_id);

          if (activeRequestsRef.current.size === 0) {
            setIsLoading(false);
          }
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const generateFuzzRequests = (): string[] => {
    if (fuzzParameters.length === 0) return [content];

    const requests: string[] = [];

    const generateCombinations = (paramIndex: number, currentRequest: string): void => {
      if (paramIndex >= fuzzParameters.length) {
        requests.push(currentRequest);
        return;
      }

      const param = fuzzParameters[paramIndex];
      param.values.forEach(value => {
        const newRequest = currentRequest.replace(param.placeholder, value);
        generateCombinations(paramIndex + 1, newRequest);
      });
    };

    generateCombinations(0, content);
    return requests;
  };

  const handleAddFuzzParameter = (): void => {
    setShowFuzzModal(true);
  };

  const handleFuzzModalAdd = (values: string[]): void => {
    const placeholder = `{{FUZZ_${fuzzParameters.length + 1}}}`;
    const newParam: FuzzParameter = {
      id: Date.now().toString(),
      placeholder,
      values,
      currentIndex: 0
    };

    // Replace selected text with placeholder in editor
    if (editorRef.current?.replaceSelectedText) {
      editorRef.current.replaceSelectedText(placeholder);
    }

    setFuzzParameters(prev => [...prev, newParam]);
  };

  const handleRemoveFuzzParameter = (id: string): void => {
    setFuzzParameters(prev => prev.filter(p => p.id !== id));
  };

  const sendRequests = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const requests = generateFuzzRequests();

      // Clear previous results
      setResults([]);

      // Create initial result entries
      const initialResults: RequestResult[] = requests.map((request, index) => ({
        id: `req_${Date.now()}_${index}`,
        request,
        response: '',
        status: 'pending',
        timestamp: new Date()
      }));

      setResults(initialResults);

      // Send all requests
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const resultId = initialResults[i].id;

        const response = await invoke<AsyncResponse>("send_data_async", { content: request });

        // Map the response ID to our result ID
        activeRequestsRef.current.add(response.request_id);

        // Update the result ID to match the response ID for tracking
        setResults(prev =>
          prev.map(r =>
            r.id === resultId
              ? { ...r, id: response.request_id }
              : r
          )
        );
      }

    } catch (error) {
      console.error('Error sending requests:', error);
      setIsLoading(false);
      setResults(prev => prev.map(r => ({
        ...r,
        status: 'error',
        response: `Error: ${error instanceof Error ? error.message : String(error)}`
      })));
    }
  };

  const cancelRequests = async (): Promise<void> => {
    try {
      for (const reqId of activeRequestsRef.current) {
        await invoke<string>("cancel_request", { requestId: reqId });
      }
      setIsLoading(false);
      setResults(prev => prev.map(r =>
        r.status === 'pending'
          ? { ...r, status: 'error', response: 'Request cancelled' }
          : r
      ));
      activeRequestsRef.current.clear();
    } catch (error) {
      console.error('Failed to cancel requests:', error);
      setIsLoading(false);
      activeRequestsRef.current.clear();
    }
  };

  const clearResults = (): void => {
    setResults([]);
  };

  return (
    <>
      <div className="flex items-center bg-muted/50 aspect-video rounded-lg p-1 w-full h-12">
        <Input className='w-72' placeholder='URL' />
      </div>
      <ReactSplit
        direction={SplitDirection.Horizontal}
        initialSizes={[50, 50]}
        gutterClassName="custom-gutter-horizontal"
        draggerClassName="custom-dragger-horizontal"
        classes={["py-1", "py-1"]}
      >
        <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
          <div className="flex items-center bg-muted/50 aspect-video rounded-lg p-1 w-full h-12">
            <h1>Request</h1>
          </div>
          <RequestEditor
            content={content}
            onContentChange={setContent}
            onTextSelect={setSelectedText}
            fuzzParameters={fuzzParameters}
            onAddFuzzParameter={handleAddFuzzParameter}
            onRemoveFuzzParameter={handleRemoveFuzzParameter}
            selectedText={selectedText}
            isLoading={isLoading}
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={sendRequests}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
            >
              {isLoading ? 'Sending...' : 'Send Request(s)'}
            </button>

            {isLoading && (
              <button
                onClick={cancelRequests}
                className="px-4 py-2 bg-red-500 text-white rounded"
              >
                Cancel All
              </button>
            )}
          </div>
        </div>
        <div className='bg-muted/50 aspect-video rounded-lg p-1 w-full h-full'>
          <PayloadConfigurator />
        </div>

      </ReactSplit>
      {/* Left Panel - Editor */}
      {/* <div className="w-1/2 flex flex-col">


        
      </div> */}

      {/* Right Panel - Results */}
      {/* <div className="w-1/2 flex flex-col">
        <ResultsTable
          results={results}
          isLoading={isLoading}
          onClearResults={clearResults}
        />
      </div> */}

      {/* Fuzz Modal */}
      {/* <FuzzModal
        isOpen={showFuzzModal}
        selectedText={selectedText}
        onClose={() => setShowFuzzModal(false)}
        onAdd={handleFuzzModalAdd}
      /> */}
    </>
  );
};

export default Fuzzer;