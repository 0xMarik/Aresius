"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
// import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { Textarea } from "@/components/ui/textarea"
import { loadValuesParam, setDelaisTime, setNumThreads, setSelectedParameter } from "@/store/slices/fuzzerSlice";
import { FuzzerParameter, FuzzingAttackType } from "@/types/fuzzer.type";
import { IconUpload } from "@tabler/icons-react";

export default function PayloadConfigurator() {
    // const [selectedType, setSelectedType] = useState("hosted-file");

    const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate)

    if (activeSessionIndex === null) {
        return <h1>No session selected</h1>
    }


    const session = fuzzerSessions[activeSessionIndex]

    // In your selector or as a useMemo
    const isOnePayload = useMemo(() =>
        session.payload.fuzzingAttackType === FuzzingAttackType.ROTATOR ||
        session.payload.fuzzingAttackType === FuzzingAttackType.ECHO,
        [session.payload.fuzzingAttackType]
    );
    if (session === undefined) return <h1>session not found</h1>

    const { parameters } = session.payload

    // const { parameters } = session.payload

    // if (parameters.length == 0) return;

    // paramters it has always at least on value cause if not this component will not be redred at first
    const [selectedParam, setSelectedParam] = useState<FuzzerParameter | null>(null)
    const dispatch = useAppDispatch()

    const IdToParameter = (id: string | null) => {
        if (id === null) return null;
        return isOnePayload ? parameters[0] : parameters.find(param => param.highlightRange.id === id) || null;
    }

    useEffect(() => {
        setSelectedParam(IdToParameter(session.selectedHighlightId));

    }, [session.selectedHighlightId, session.payload.fuzzingAttackType])


    // const changeParam = (value: string) => {
    //     console.log("change param", value)
    //     setSelectedParam(IdToParameter(value))
    // }

    const handleValues = (event: any) => {

        dispatch(loadValuesParam({
            paramIndex: isOnePayload ? 0 : parameters.findIndex(param => param.highlightRange.id === selectedParam?.highlightRange.id),
            values: event.target.value
        }))
    }

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            let fileContent = e.target?.result as string;

            // Remove \r characters (Windows line endings)
            fileContent = fileContent.replace(/\r/g, '');

            // Get existing values
            const existingValues = isOnePayload
                ? parameters[0]?.values.join("\n") || ""
                : parameters.find(param => param.highlightRange.id === selectedParam?.highlightRange.id)?.values.join("\n") || "";

            // Append file content to existing values
            const updatedValues = existingValues
                ? `${existingValues}\n${fileContent}`
                : fileContent;

            // Dispatch the Redux action with appended content
            dispatch(loadValuesParam({
                paramIndex: isOnePayload ? 0 : parameters.findIndex(param => param.highlightRange.id === selectedParam?.highlightRange.id),
                values: updatedValues
            }));
        };

        reader.onerror = () => {
            console.error("Error reading file");
        };

        reader.readAsText(file);

        // Reset file input so same file can be loaded again
        event.target.value = '';
    };

    return (
        selectedParam === null ? "Select a param" : <>


            <Tabs defaultValue="payload" className="w-full max-w-lg p-4 h-full">
                <TabsList>
                    <TabsTrigger value="payload">Payload</TabsTrigger>
                    <TabsTrigger value="pipline-processing">Pipline Processing</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="payload" className="space-y-4 mt-4 h-full">

                    <div>
                        <div>
                            <Label htmlFor="payloadNumber">Payload #</Label>
                            <Select

                                disabled={isOnePayload}
                                value={isOnePayload ? parameters[0].highlightRange.id : selectedParam.highlightRange.id}
                                onValueChange={(value) => {
                                    dispatch(setSelectedParameter({ parameterId: value }))
                                }}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent >
                                    {
                                        (isOnePayload ? [parameters[0]] : parameters).map((param, index) => (
                                            <SelectItem key={index} value={param.highlightRange.id}>
                                                {param.highlightRange.originalText}
                                            </SelectItem>
                                        ))
                                    }
                                </SelectContent>
                            </Select>
                        </div>

                        {/* <Label htmlFor="placeholder">Placeholder</Label>
                        <Input id="placeholder" disabled placeholder="(empty)" value={isOnePayload  ? "This apply to all highlighted parameters" : selectedParam.highlightRange.originalText} /> */}

                    </div >

                    <div>
                        <Label>Type</Label>
                        <Select defaultValue={selectedParam.payloadSource}
                        // onValueChange={setSelectedType}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {/* <SelectItem value="library">Library</SelectItem>
                            <SelectItem value="file">File</SelectItem>
                            <SelectItem value="generator">Generator</SelectItem> */}
                                <SelectItem value="manual">Manual</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>


                    <Label>Selected File</Label>
                    <div className="space-y-2">


                        {/* Textarea */}
                        <Textarea
                            className="h-48"
                            value={
                                isOnePayload
                                    ? parameters[0]?.values.join("\n") || ""
                                    : parameters.find(param => param.highlightRange.id === selectedParam?.highlightRange.id)?.values.join("\n") || ""
                            }
                            onChange={handleValues}>
                        </Textarea>

                        {/* File input with custom button */}
                        <div className="flex gap-2 w-full">
                            <label htmlFor="file-upload" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer w-full">

                                <IconUpload className="mr-2 " />
                                Load from File
                            </label>
                            <input
                                id="file-upload"
                                type="file"
                                accept=".txt,.csv"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </div>
                    </div>
                    <div>
                        Number of requests : {
                            isOnePayload ? session.payload.parameters[0].values.length : (session.payload.fuzzingAttackType === FuzzingAttackType.ZIPPED ? session.payload.parameters.reduce((acc, param) => param.values.length < acc ? param.values.length : acc, Infinity) :
                                session.payload.fuzzingAttackType === FuzzingAttackType.COMBINATORIAL ? session.payload.parameters.reduce((acc, param) => acc * param.values.length, 1) :
                                    session.payload.parameters[0].values.length)
                        }
                    </div>
                    {/* <Select disabled={!selectedType.includes("file")} value={selectedFile} onValueChange={setSelectedFile}>
                        <SelectTrigger>
                            <SelectValue placeholder="Choose file" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="wordlist1.txt">wordlist1.txt</SelectItem>
                            <SelectItem value="users.txt">users.txt</SelectItem>
                        </SelectContent>
                    </Select> */}

                    {/* {!selectedFile && (
                        <Alert className="mt-2 text-sm text-muted-foreground border-l-4 border-yellow-400 bg-yellow-50 p-2">
                            <AlertDescription>
                                You don’t have any files yet. Visit the <span className="underline">Files</span> page and upload a wordlist to get started.
                            </AlertDescription>
                        </Alert>
                    )} */}


                </TabsContent >

                <TabsContent value="pipline-processing">
                    <p>Defining a traitement on payload before they are sent</p>
                </TabsContent>

                <TabsContent value="settings">
                    <p>Settings configuration</p>
                    <br />
                    <Label htmlFor="numThreads">Number of Threads</Label>
                    <Input
                        id="numThreads"
                        type="number"
                        min={1}
                        max={20}
                        value={session.payload.numThreads}
                        onChange={(event) => {
                            dispatch(setNumThreads({ numThreads: parseInt(event.target.value) }))
                            // console.log()
                        }}
                    />
                    <br />
                    <Label htmlFor="delais">Delais between Requests (ms)</Label>
                    <p className="text-xs">This delais are between request in the same threads, so if you have restriction to send just one request every 1s use 1 thread and 10,000ms</p>
                    <Input
                        id="numThreads"
                        type="number"
                        min={0}
                        value={session.payload.delaisTime}
                        onChange={(event) => {
                            dispatch(setDelaisTime({ delaisTime: parseInt(event.target.value) }))
                        }}
                    />
                </TabsContent>
            </Tabs >
        </>
    );
}
