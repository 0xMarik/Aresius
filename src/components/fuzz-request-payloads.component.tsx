// import { useEffect, useRef, useState } from 'react';
// import { useDispatch } from 'react-redux';
// import { Card, CardContent, CardHeader } from '@/components/ui/card';
// import { Badge } from '@/components/ui/badge';
// import { basicSetup } from 'codemirror';
// import { EditorView } from '@codemirror/view';
// import { EditorState } from '@codemirror/state';
// import { oneDark } from '@codemirror/theme-one-dark';
// import { http } from './http-parser.component';
// import { addParameter, updatePayloadRawRequest } from '@/store/slices/fuzzerSlice';
// import { indentWithTab } from '@codemirror/commands';
// import { keymap } from '@codemirror/view';
// import ReactSplit, { SplitDirection } from '@devbookhq/splitter';
// import { Tabs, TabsContent, TabsList, TabsTrigger } from '@radix-ui/react-tabs';
// import { Label } from '@radix-ui/react-dropdown-menu';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@radix-ui/react-select';
// import { Input } from './ui/input';
// import { Button } from './ui/button';
// import { Minus, Plus } from 'lucide-react';
// import PayloadConfigurator from './payloads-configurator.component';

// interface SelectionType {
//   start: number | null
//   end: number | null
//   selectedText: string | null
// }

// const FuzzRequestPayload = () => {
//   const dispatch = useDispatch();
//   const editorRef = useRef(null);
//   const viewRef = useRef<any>(null);

//   const [selectionInfo, setSelectionInfo] = useState<SelectionType>(
//     {
//       start: null,
//       end: null,
//       selectedText: null
//     }
//   );

//   // Get the value from Redux store


//   const rawRequest = useAppSelector(state => state.fuzzerstate.fuzzerSessions[activeSessionIndex].payload.rawRequest);
//   const parameters = useAppSelector(state => state.fuzzerstate.fuzzerSessions[activeSessionIndex].payload.parameters);

//   const handleAddParameter = () => {
//     if (!viewRef.current) return;

//     const { start, end } = selectionInfo;
//     const placeholderText = 'PARAM';
//     const paramIndex = parameters.filter(p => p.name.startsWith('PARAM')).length;


//     const placeholder = paramIndex === 0 ? placeholderText : placeholderText + "_" + paramIndex;

//     const transaction = viewRef.current.state.update({
//       changes: {
//         from: start,
//         to: end,
//         insert: `{{${placeholder}}}`
//       }
//     });

//     dispatch(addParameter({
//       name: placeholder,
//       payloadSource: "manual",
//       replacedValue: selectionInfo.selectedText || "",
//       values: []
//     }))

//     viewRef.current.dispatch(transaction);
//   };

//   const selectionListener = EditorView.updateListener.of((update) => {
//     if (update.selectionSet) {
//       const selection = update.state.selection.main;
//       const selectedText = update.state.doc.sliceString(selection.from, selection.to);
//       setSelectionInfo({
//         start: selection.from,
//         end: selection.to,
//         selectedText,
//       })
//     }
//   })


//   useEffect(() => {
//     if (editorRef.current && !viewRef.current) {
//       console.log("hello");
//       const updateListener = EditorView.updateListener.of((update) => {
//         if (update.docChanged) {
//           const value = update.state.doc.toString();
//           dispatch(updatePayloadRawRequest({ content: value }));
//         }
//       });

//       const state = EditorState.create({
//         doc: rawRequest || '',
//         extensions: [
//           basicSetup,
//           http(),
//           oneDark, // Dark theme
//           updateListener,
//           selectionListener,
//           EditorView.theme({
//             '&': {
//               fontSize: '14px',
//               fontFamily: 'Consolas, Monaco, "Courier New", monospace'
//             },
//             '.cm-content': {
//               padding: '12px',
//               minHeight: '400px',
//             },
//             '.cm-focused': {
//               outline: 'none'
//             },
//             '.cm-editor': {
//               borderRadius: '0',
//             },
//             '.cm-scroller': {
//               fontFamily: 'Consolas, Monaco, "Courier New", monospace'
//             }
//           }),
//           keymap.of([indentWithTab])
//         ]
//       });

//       viewRef.current = new EditorView({
//         state,
//         parent: editorRef.current
//       });
//     }

//     return () => {
//       if (viewRef.current) {
//         viewRef.current.destroy();
//         viewRef.current = null;
//       }
//     };
//   }, [activeSessionIndex]);

//   // useEffect(() => {
//   //    .refresh()
//   // }, [activeSessionIndex])


//   // Sync Redux state to CodeMirror
//   useEffect(() => {
//     if (viewRef.current && viewRef.current.state.doc.toString() !== rawRequest) {
//       const transaction = viewRef.current.state.update({
//         changes: {
//           from: 0,
//           to: viewRef.current.state.doc.length,
//           insert: rawRequest || ''
//         }
//       });
//       viewRef.current.dispatch(transaction);
//     }
//   }, [rawRequest]);

//   const lineCount = rawRequest ? rawRequest.split('\n').length : 0;
//   const charCount = rawRequest ? rawRequest.length : 0;



//   return (
//     <ReactSplit
//       direction={SplitDirection.Horizontal}
//       initialSizes={[50, 50]}
//       gutterClassName="custom-gutter-horizontal"
//       draggerClassName="custom-dragger-horizontal">
//       <Card className="bg-background border-border">
//         <CardHeader className="pb-3">
//           {/* <div className="flex items-center justify-between">
//             <CardTitle className="text-lg font-semibold">
//               Raw Request Editor
//             </CardTitle>
//             <div className="flex gap-2">
//               <Badge variant="secondary" className="text-xs">
//                 Session {activeSessionIndex + 1}
//               </Badge>
//               <Badge variant="outline" className="text-xs">
//                 HTTP
//               </Badge>
//             </div>
//           </div> */}
//           <div className="flex items-center gap-1">
//             <Badge variant="secondary" className="text-xs">
//               Session {activeSessionIndex + 1}
//             </Badge>
//             <Badge variant="outline" className="text-xs">
//               HTTP
//             </Badge>
//             <Button className="h-[2rem]">
//               Clear Fuzzes
//             </Button>
//             <Button
//               size="icon"
//               className="size-8"
//               title="Select a {{FUZZ_X}} placeholder to remove"
//             >
//               <Minus />
//             </Button>
//             <Button
//               size="icon"
//               className="size-8"
//               title="Select text to add as fuzz parameter"
//               onClick={handleAddParameter}
//             >
//               <Plus />
//             </Button>
//           </div>
//         </CardHeader>

//         <CardContent className="p-0 ">
//           <div className="border-t border-border ">
//             <div
//               ref={editorRef}
//               className="min-h-[400px] max-h-[600px] overflow-auto"
//             />
//           </div>

//           <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-t border-border text-xs text-muted-foreground">
//             <div className="flex gap-4">
//               <span>Lines: {lineCount}</span>
//               <span>Characters: {charCount}</span>
//             </div>
//             <div className="flex gap-2">
//               <span>HTTP Mode</span>
//               <span>•</span>
//               <span>One Dark</span>
//             </div>
//           </div>
//         </CardContent>
//       </Card>
//       <div className='bg-muted/50 aspect-video rounded-lg p-1 h-full'>


//       </div>
//       {/* Debug Panel - Remove in production */}
//       {/* {process.env.NODE_ENV === 'development' && (
//         <Card className="mt-4">
//           <CardHeader>
//             <CardTitle className="text-sm">Debug Info</CardTitle>
//           </CardHeader>
//           <CardContent>
//             <div className="space-y-2">
//               <div className="text-xs">
//                 <span className="font-medium">Active Session:</span> {activeSessionIndex}
//               </div>
//               <div className="text-xs">
//                 <span className="font-medium">Raw Request Preview:</span>
//                 <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
//                   {rawRequest || '(empty)'}
//                 </pre>
//               </div>
//             </div>
//           </CardContent>
//         </Card>
//       )} */}
//     </ReactSplit>
//   );
// };

// export default FuzzRequestPayload;

// <Tabs defaultValue="payload" className="w-full max-w-lg p-4">
//   <TabsList>
//     <TabsTrigger value="payload">Payload</TabsTrigger>
//     <TabsTrigger value="preprocessors">Preprocessors</TabsTrigger>
//     <TabsTrigger value="settings">Settings</TabsTrigger>
//   </TabsList>

//   <TabsContent value="payload" className="space-y-4 mt-4">
//     <div className="grid grid-cols-2 gap-4">
//       <div>
//         <Label>Payload #</Label>
//         <Select
//         // value={String(selectedPayloadIndex + 1)}
//         // onValueChange={(value) =>
//         //   setSelectedPayloadIndex(Number(value) - 1)
//         // }
//         >
//           <SelectTrigger>
//             <SelectValue />
//           </SelectTrigger>
//           <SelectContent>
//             {/* {fuzzParameters.map((_, index) => (
//                           <SelectItem key={index} value={String(index + 1)}>
//                             {index + 1}
//                           </SelectItem>
//                         ))} */}
//           </SelectContent>
//         </Select>
//       </div>
//       <div>
//         <Label>Placeholder</Label>
//         <Input
//           // value={currentParam?.placeholder || ""}
//           placeholder="(empty)"
//           readOnly
//         />
//       </div>
//     </div>

//     <div>
//       <Label>Original Text</Label>
//       <Input
//         // value={currentParam?.originalText || ""}
//         placeholder="(empty)"
//         readOnly
//       />
//     </div>

//     <div>
//       <Label>Type</Label>
//       <Select
//       // value={currentParam?.payloadType || "manual"}
//       // onValueChange={(value) =>
//       //   updatePayloadType(value as FuzzParam["payloadType"])
//       // }
//       >
//         <SelectTrigger>
//           <SelectValue />
//         </SelectTrigger>
//         <SelectContent>
//           <SelectItem value="hosted-file">Hosted File</SelectItem>
//           <SelectItem value="manual">Manual Input</SelectItem>
//           <SelectItem value="generator">Generator</SelectItem>
//         </SelectContent>
//       </Select>
//     </div>

//     {/* {currentParam?.payloadType === "manual" && (
//               <div>
//                 <Label>Payload Values (one per line)</Label>
//                 <textarea
//                   value={currentParam.values.join("\n")}
//                   onChange={(e) => updatePayloadValues(e.target.value)}
//                   placeholder="value1\nvalue2\nvalue3"
//                   className="w-full h-32 p-2 border border-gray-300 rounded resize-none"
//                 />
//                 <div className="text-xs text-gray-500 mt-1">
//                   Values count: {currentParam.values.length}
//                 </div>
//               </div>
//             )} */}

//     {/* {currentParam?.payloadType === "hosted-file" && (
//               <div>
//                 <Label>Selected File</Label>
//                 <Select
//                   value={currentParam.selectedFile || ""}
//                   onValueChange={updateSelectedFile}
//                 >
//                   <SelectTrigger>
//                     <SelectValue placeholder="Choose file" />
//                   </SelectTrigger>
//                   <SelectContent>
//                     <SelectItem value="wordlist1.txt">
//                       wordlist1.txt
//                     </SelectItem>
//                     <SelectItem value="users.txt">users.txt</SelectItem>
//                   </SelectContent>
//                 </Select>
//               </div>
//             )} */}
//   </TabsContent>

//   <TabsContent value="preprocessors">
//     <p>Preprocessor config goes here</p>
//   </TabsContent>

//   <TabsContent value="settings">
//     <p>Settings config goes here</p>
//   </TabsContent>
// </Tabs>

import React from 'react';
import { useAppSelector } from '@/hooks/redux';

import RequestEditor from './request-editor.component';
import PayloadConfigurator from './payloads-configurator.component';
import ReactSplit, { SplitDirection } from '@devbookhq/splitter';


const FuzzRequestPayload: React.FC = () => {

  const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate);
  if (activeSessionIndex === null) return null;
  if (fuzzerSessions[activeSessionIndex] === undefined) return null;
  const { rawRequest } = fuzzerSessions[activeSessionIndex].payload;

  return (
    <>
      <ReactSplit
        direction={SplitDirection.Horizontal}
        initialSizes={[50, 50]}
        gutterClassName="custom-gutter-horizontal"
        draggerClassName="custom-dragger-horizontal"
        classes={["h-full"]}>
        <RequestEditor rawRequest={rawRequest} activeSessionIndex={activeSessionIndex} />
        {
          // fuzzerSessions[activeSessionIndex].payload.parameters.length === 0 ?
          //   "Their is no payload yet" : <PayloadConfigurator />
        }
      </ReactSplit>
    </>
  );
};

export default FuzzRequestPayload;
