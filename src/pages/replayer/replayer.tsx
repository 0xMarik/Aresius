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
import { ChevronDownIcon, Plus, Repeat, Play, Loader2 } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EmptyState } from '@/components/ui/empty-state';
import { ValidateUrlInput } from "@/components/ValidateUrlInput";
import HistoryRequests from "@/components/Replayer/HistoryRequests";
import CoreContextMenu from "@/components/ContextMenu/CoreContextMenu";
import RequestCodeEditor from "@/components/Replayer/RequestCodeEditor";

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
        <div ref={editorRef} className="h-full w-full border rounded-lg ">
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
            <ResizablePanel defaultSize={15} minSize={13} maxSize={50}>
                <div className='h-full'>
                    <ButtonGroup>
                        <Button className='mb-2 w-full' onClick={
                            () => dispatch(addSessionToCollection({ collectionIndex: Number((selectedIds[0] ?? "0-0").split('-')[0]) }))}><Plus /> New Session</Button>
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
                    <div className="rounded-lg p-1 w-full h-full ">
                        <Input value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search..."
                        />
                        <RsTree
                            searchTerm={searchTerm}
                            className="!h-full bg-transparent border-none"
                            data={data}
                            treeLineClassName="!border-border/40"
                            treeNodeClassName="
    !bg-transparent
    !text-muted-foreground
    hover:!bg-accent/50 hover:!text-foreground
    aria-selected:!bg-accent aria-selected:!text-accent-foreground
    rounded-sm text-[13px] font-mono transition-colors
  "
                            selectedIds={selectedIds}
                            onSelect={handleSelection}
                            showIcons={true}
                            virtualizeEnabled={true}
                        />
                    </div>
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={85} minSize={20}>
                {noSessionSelected ? (
                    <EmptyState
                        icon={Repeat}
                        title="No Replayer Session Selected"
                        description="Select an existing session from the collection tree or click 'New Session' to start replaying HTTP requests."
                    />
                ) : (
                    <div className='h-full flex flex-col gap-2 p-1'>
                        <div className='flex items-center h-12 bg-card/40 border border-border/60 rounded-lg p-2 gap-3 shrink-0'>
                            {/* <Input placeholder='Enter URL to replay...' className='flex-1 font-mono text-xs h-8 bg-background'
                                value={url}
                                onChange={(event) => dispatch(setReaplayerURL({ url: event.target.value }))}
                            /> */}
                            <ValidateUrlInput url={session?.url || ""} onChange={(url, urlIsValid) => dispatch(setReaplayerURL({ url, urlIsValid }))} />
                            <Button
                                onClick={triggerRequest}
                                size="sm"
                                disabled={responseLoading || session?.urlIsValid === false}
                                className="h-8 px-4 font-semibold gap-1.5 shrink-0"

                            >
                                {responseLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                                SEND
                            </Button>

                            <HistoryRequests history={history} selectedHistoryIndex={selectedHistoryIndex} />
                        </div>
                        <ResizablePanelGroup direction='horizontal' autoSaveId="repeater-req-res" className="flex-1 min-h-0">
                            <ResizablePanel>
                                <RequestCodeEditor />
                            </ResizablePanel>
                            <ResizableHandle withHandle />
                            <ResizablePanel>
                                <div className="bg-background border border-border/60 min-w-0 rounded-lg p-1 w-full h-full">
                                    {responseLoading ? (
                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2">
                                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                            <span>Replaying HTTP Request...</span>
                                        </div>
                                    ) : (
                                        <ResponseCodeEditor />
                                    )}
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