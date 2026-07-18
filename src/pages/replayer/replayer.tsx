import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import { basicSetup, EditorView } from "codemirror";
import './replayer.style.css'
import { EditorState, } from '@codemirror/state';
import { useEffect, useRef, useState } from 'react'
import { http } from '@/components/http-parser.component';
import { oneDark } from '@codemirror/theme-one-dark';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { addCollection, addReplayerHistory, addSessionToCollection, selectColSess, selectedHisotryIndex, setReaplayerContent, setReaplayerURL } from '@/store/slices/replayerSlice';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { invoke } from '@tauri-apps/api/core';
import { ReplayerHistoryItem } from '@/types/replayer.type';
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RsTree, TreeNode } from 'rstree-ui';
import { ChevronDown, ChevronDownIcon, ChevronLeft, ChevronRight, Plus, } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Add to imports
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseRequest, parseResponse } from '@/components/utils';


// type TaskResult = {
//     id: string;
//     message: string;
// };

const fullHeightTheme = EditorView.theme({
    '&': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    '.cm-scroller': {
        flex: 1,
        overflow: 'auto',
    },
});

const RequestCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // const [content, setContent] = useState<string>("");
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { requestTmp, selectedHistoryIndex } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    const { selectedSessionIndex } = collections[selectedCollectionIndex]
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;

        // Clean up existing editor
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                // Update Redux state with new content
                // setContent(code);
                console.log({ code })
                dispatch(setReaplayerContent({ rawRequest: code }));
            }
        });

        const state = EditorState.create({
            doc: requestTmp,
            extensions: [
                basicSetup,
                http(),
                // javascript(),
                oneDark,
                fullHeightTheme,
                updateListener,
                EditorView.lineWrapping,
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        // Initialize global state after editor creation
        // globalRanges = [...currentFuzzerSession.payload.parameters];
        // selectedRangeId = currentFuzzerSession.selectedHighlightId;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [selectedHistoryIndex, selectedCollectionIndex, selectedSessionIndex]);

    return (
        <div ref={editorRef} className="h-full w-full border rounded-lg">
        </div>
    )
}

const ResponseCodeEditor = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // const [content, setContent] = useState<string>("");
    const { collections, selectedCollectionIndex, } = useAppSelector(state => state.replayerstate);

    const { history, selectedHistoryIndex, } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    const { selectedSessionIndex } = collections[selectedCollectionIndex]
    // const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;

        // Clean up existing editor
        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }


        const state = EditorState.create({
            doc: selectedHistoryIndex !== null ? history[selectedHistoryIndex].responseRaw : "",
            extensions: [
                basicSetup,
                http(),
                // javascript(),
                oneDark,
                fullHeightTheme,
                EditorView.lineWrapping,
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [history, selectedHistoryIndex, selectedCollectionIndex, selectedSessionIndex]);
    // SelectedHistoryIndex for re-render when changeing the history item
    // SelectedCollectionIndex for re-render when changing collection

    return (
        <div ref={editorRef} className="h-full w-full border rounded-lg">
        </div>
    )
}



function Replayer() {
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { url, requestTmp, history, selectedHistoryIndex } = collections[selectedCollectionIndex].sessions[collections[selectedCollectionIndex].selectedSessionIndex];
    const [responseLoading, setResponseLoading] = React.useState<boolean>(false);

    const dispatch = useAppDispatch();

    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

    // Inside Replayer(), alongside handleSelectedHisotry:
    const goNewer = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex === 0) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex - 1 }));
    };

    const goOlder = () => {
        if (selectedHistoryIndex === null || selectedHistoryIndex >= history.length - 1) return;
        dispatch(selectedHisotryIndex({ historyIndex: selectedHistoryIndex + 1 }));
    };

    const handleSelection = (value: string[]) => {
        if (value !== undefined && value.length === 1 && value[0].includes("-")) {
            const newValue = value[0]?.split("-") || [];
            dispatch(selectColSess({ collectionIndex: Number(newValue[0]), sessionIndex: Number(newValue[1]) }));
        }
        setSelectedIds(value)
    }
    const triggerRequest = async () => {
        console.log("Triggering request with:", { requestTmp, url });
        setResponseLoading(true)
        const response = await invoke<ReplayerHistoryItem>('replay_request', { requestTmp: requestTmp, url: url });
        setResponseLoading(false)
        dispatch(addReplayerHistory({ historyItem: response }));
        dispatch(selectedHisotryIndex({ historyIndex: 0 }));
    }
    const [searchTerm, setSearchTerm] = useState('')

    const handleSelectedHisotry = (value: string) => {
        dispatch(selectedHisotryIndex({ historyIndex: parseInt(value) }));
    }

    const data: TreeNode<unknown>[] = collections.map((collection, colIndex) => ({
        id: `${colIndex}`,
        label: `Collection ${colIndex + 1}`,
        children: collection.sessions.map((session, sessIndex) => ({
            id: `${colIndex}-${sessIndex}`,
            label: `Session ${sessIndex + 1} - ${session.url}`,
            // You can add more nesting if needed
        }))
    }))



    return (
        <ReactSplit
            direction={SplitDirection.Horizontal}
            initialSizes={[20, 80]} // 👈 Initial widths: 40% left, 60% right
            // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
            gutterClassName="custom-gutter-horizontal"
            draggerClassName="custom-dragger-horizontal"
            classes={["py-1", "py-1"]}
        >
            <div className='h-full'>
                <ButtonGroup>
                    <Button className='mb-2 w-full' onClick={() => dispatch(addSessionToCollection({ collectionIndex: Number((selectedIds[0] ?? "0-0").split('-')[0]) }))}><Plus /> New Session</Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="default" className="pl-2!">
                                <ChevronDownIcon />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => dispatch(addCollection())}>
                                <Plus />
                                New Collection
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </ButtonGroup>
                <div className="bg-muted/50 rounded-lg p-1 w-full h-full ">
                    <Input value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search..."
                    />
                    <RsTree
                        className='!h-full bg-transparent'
                        data={data}
                        selectedIds={selectedIds}
                        onSelect={handleSelection}
                        searchTerm={searchTerm}
                        showIcons={true}
                        virtualizeEnabled={true}

                    // multiSelect={true}
                    // checkable={true}
                    />
                </div>
            </div>
            <div className='h-full flex flex-col gap-1'>
                <div className=' flex  items-center h-10 bg-muted/50 aspect-video rounded-lg p-1 gap-5'>
                    <Input placeholder='Enter URL to replay...' className='w-64 bg-transparent border-0 focus:ring-0'
                        value={url}
                        onChange={(event) => dispatch(setReaplayerURL({ url: event.target.value }))}
                    />
                    <Button
                        onClick={triggerRequest}
                        // disabled={isLoading}
                        className="p-4  text-white rounded disabled:bg-gray-400"
                    >
                        RUN
                    </Button>
                    {/* <Select
                        value={selectedHistoryIndex?.toString() || ""}
                        onValueChange={handleSelectedHisotry}
                        disabled={history.length === 0}>
                        <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="Select Session" />
                        </SelectTrigger>
                        <SelectContent >
                            {
                                history.map((item, index) => (
                                    <SelectItem key={index} value={index.toString()}>
                                        {item.requestRaw.slice(0, 30).replace(/\r?\n|\r/g, ' ')}...
                                    </SelectItem>
                                ))
                            }
                        </SelectContent>
                    </Select> */}
                    <ButtonGroup>
                        <Button
                            disabled={selectedHistoryIndex === null || history.length - 1 === selectedHistoryIndex}
                            variant="outline"
                            className="pl-2!"
                            onClick={goOlder}
                        >
                            <ChevronLeft />
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline">
                                    History <ChevronDown />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[520px] p-0" align="start">
                                <div className="max-h-80 overflow-auto">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-muted">
                                            <TableRow>
                                                <TableHead>Method</TableHead>
                                                <TableHead>Host</TableHead>
                                                <TableHead>Path</TableHead>
                                                <TableHead>Time</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {history.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                                                        No requests yet
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                            {history.map((item, index) => {
                                                const req = parseRequest(item.requestRaw)
                                                return (
                                                    <TableRow
                                                        key={index}
                                                        onClick={() => handleSelectedHisotry(index.toString())}
                                                        className={`cursor-pointer ${selectedHistoryIndex === index ? 'bg-muted' : ''
                                                            }`}
                                                    >
                                                        <TableCell className="font-mono">{req.method}</TableCell>
                                                        <TableCell>{"item.host"}</TableCell>
                                                        <TableCell className="truncate max-w-[160px]">{req.path}</TableCell>
                                                        <TableCell className="whitespace-nowrap">
                                                            {new Date(item.requestTime).toLocaleTimeString()}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Button

                            disabled={selectedHistoryIndex === null || selectedHistoryIndex === 0}
                            variant="outline"
                            className="pl-2!"
                            onClick={goNewer}
                        >
                            <ChevronRight />
                        </Button>
                    </ButtonGroup>
                </div>
                <ReactSplit
                    gutterClassName="custom-gutter-horizontal"
                    draggerClassName="custom-dragger-horizontal"
                    direction={SplitDirection.Horizontal}>
                    <div className="bg-muted/50 min-w-0 rounded-lg p-1 w-full h-full">
                        <RequestCodeEditor />
                    </div>
                    <div className="bg-muted/50 min-w-0 rounded-lg p-1 w-full h-full">
                        {responseLoading ? "Response is loading..." : <ResponseCodeEditor />}

                    </div>
                </ReactSplit>
            </div>

        </ReactSplit >
    )
}


export default Replayer