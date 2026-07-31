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
import { RsTree, TreeNode } from 'rstree-ui';
import { ChevronDown, ChevronDownIcon, ChevronLeft, ChevronRight, Plus, } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseRequest } from '@/components/utils';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

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
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { selectedSessionIndex } = collections[selectedCollectionIndex];
    const session = selectedSessionIndex !== null
        ? collections[selectedCollectionIndex].sessions[selectedSessionIndex]
        : null;
    const requestTmp = session?.requestTmp ?? "";
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (!editorRef.current) return;
        if (selectedSessionIndex === null) return; // nothing to edit yet

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                dispatch(setReaplayerContent({ rawRequest: code }));
            }
        });

        const state = EditorState.create({
            doc: requestTmp,
            extensions: [
                EditorState.lineSeparator.of("\r\n"),
                basicSetup,
                http(),
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
    const { collections, selectedCollectionIndex, } = useAppSelector(state => state.replayerstate);
    const { selectedSessionIndex } = collections[selectedCollectionIndex];
    const session = selectedSessionIndex !== null
        ? collections[selectedCollectionIndex].sessions[selectedSessionIndex]
        : null;
    const history = session?.history ?? [];
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;

    useEffect(() => {
        if (!editorRef.current) return;
        if (selectedSessionIndex === null) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const state = EditorState.create({
            doc: selectedHistoryIndex !== null && history[selectedHistoryIndex]
                ? history[selectedHistoryIndex].responseRaw
                : "",
            extensions: [
                EditorState.lineSeparator.of("\r\n"),
                basicSetup,
                http(),
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

    return (
        <div ref={editorRef} className="h-full w-full border rounded-lg">
        </div>
    )
}

function Replayer() {
    const { collections, selectedCollectionIndex } = useAppSelector(state => state.replayerstate);
    const { selectedSessionIndex } = collections[selectedCollectionIndex];
    const session = selectedSessionIndex !== null
        ? collections[selectedCollectionIndex].sessions[selectedSessionIndex]
        : null;

    const url = session?.url ?? "";
    const requestTmp = session?.requestTmp ?? "";
    const history = session?.history ?? [];
    const selectedHistoryIndex = session?.selectedHistoryIndex ?? null;

    const [responseLoading, setResponseLoading] = React.useState<boolean>(false);
    const dispatch = useAppDispatch();
    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

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
        if (selectedSessionIndex === null) return; // no active session, nothing to run
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
        }))
    }))

    const noSessionSelected = selectedSessionIndex === null;

    return (
        <ResizablePanelGroup direction='horizontal' autoSaveId="aresius-repeater-layout" >
            <ResizablePanel defaultSize={13} minSize={13} maxSize={20}>
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
                        />
                    </div>
                </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={70} minSize={20}>
                {noSessionSelected ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                        Select or create a session to get started
                    </div>
                ) : (
                    <div className='h-full flex flex-col gap-1'>
                        <div className=' flex  items-center h-10 bg-muted/50 aspect-video rounded-lg p-1 gap-5'>
                            <Input placeholder='Enter URL to replay...' className='w-64 bg-transparent border-0 focus:ring-0'
                                value={url}
                                onChange={(event) => dispatch(setReaplayerURL({ url: event.target.value }))}
                            />
                            <Button
                                onClick={triggerRequest}
                                className="p-4  text-white rounded disabled:bg-gray-400"
                            >
                                RUN
                            </Button>

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
                        <ResizablePanelGroup direction='horizontal' autoSaveId="repeater-req-res">
                            <ResizablePanel >
                                <div className="bg-muted/50 min-w-0 rounded-lg p-1 w-full h-full">
                                    <RequestCodeEditor />
                                </div>
                            </ResizablePanel>
                            <ResizableHandle />
                            <ResizablePanel>
                                <div className="bg-muted/50 min-w-0 rounded-lg p-1 w-full h-full">
                                    {responseLoading ? "Response is loading..." : <ResponseCodeEditor />}
                                </div>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </div>
                )}
            </ResizablePanel>
        </ResizablePanelGroup>
    )
}

export default Replayer