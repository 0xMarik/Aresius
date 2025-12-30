"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { Textarea } from "@/components/ui/textarea"
import { loadValuesParam, setSelectedParameter } from "@/store/slices/fuzzerSlice";
import { FuzzerParameter, FuzzingAttackType } from "@/types/fuzzer.type";

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

    return (
        selectedParam === null ? "Select a param" : <>


            <Tabs defaultValue="payload" className="w-full max-w-lg p-4 h-full">
                <TabsList>
                    <TabsTrigger value="payload">Payload</TabsTrigger>
                    <TabsTrigger value="preprocessors">Preprocessors</TabsTrigger>
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
                    <Textarea
                        className="h-48"
                        value={
                            isOnePayload
                                ? parameters[0]?.values.join("\n") || ""
                                : parameters.find(param => param.highlightRange.id === selectedParam?.highlightRange.id)?.values.join("\n") || ""
                        }
                        onChange={handleValues}>
                    </Textarea>
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

                <TabsContent value="preprocessors">
                    <p>Preprocessor config goes here</p>
                </TabsContent>

                <TabsContent value="settings">
                    <p>Settings config goes here</p>
                </TabsContent>
            </Tabs >
        </>
    );
}
