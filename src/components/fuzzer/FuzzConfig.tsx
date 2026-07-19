import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { Textarea } from "@/components/ui/textarea";
import { loadValuesParam, setDelayMs, setNumThreads, setSelectedParameter } from "@/store/slices/fuzzerSlice";
import { FuzzingAttackType } from "@/types/fuzzer.type";
import { IconUpload } from "@tabler/icons-react";

export default function PayloadConfigurator() {
    const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate);
    const dispatch = useAppDispatch();

    if (activeSessionIndex === null) {
        return <h1>No session selected</h1>;
    }

    const session = fuzzerSessions[activeSessionIndex];
    if (session === undefined) return <h1>session not found</h1>;

    const { parameters } = session.fuzzConfig;

    const isOnePayload = useMemo(
        () =>
            session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ROTATOR ||
            session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ECHO,
        [session.fuzzConfig.fuzzingAttackType]
    );

    // Derive selectedParam fresh on every render instead of caching it in
    // state — this guarantees it's always in sync with `parameters`, and
    // it's always either a real FuzzerParameter or null, never undefined.
    const selectedParam = useMemo(() => {
        if (parameters.length === 0) return null;
        if (isOnePayload) return parameters[0] ?? null;

        const { selectedHighlightId } = session;
        if (selectedHighlightId === null) return null;

        return parameters.find(param => param.highlightRange.id === selectedHighlightId) ?? null;
    }, [parameters, isOnePayload, session.selectedHighlightId]);

    const paramIndex = useMemo(() => {
        if (selectedParam === null) return -1;
        return isOnePayload
            ? 0
            : parameters.findIndex(param => param.highlightRange.id === selectedParam.highlightRange.id);
    }, [selectedParam, isOnePayload, parameters]);

    const handleValues = (event: any) => {
        if (paramIndex === -1) return;
        dispatch(loadValuesParam({ paramIndex, values: event.target.value }));
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || paramIndex === -1) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            let fileContent = e.target?.result as string;
            fileContent = fileContent.replace(/\r/g, '');

            const existingValues = selectedParam?.values.join("\n") || "";
            const updatedValues = existingValues ? `${existingValues}\n${fileContent}` : fileContent;

            dispatch(loadValuesParam({ paramIndex, values: updatedValues }));
        };

        reader.onerror = () => {
            console.error("Error reading file");
        };

        reader.readAsText(file);
        event.target.value = '';
    };

    if (selectedParam === null) {
        return <p>Select a param</p>;
    }

    return (
        <Tabs defaultValue="payload" className="w-full max-w-lg p-4 h-full">
            <TabsList>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="pipline-processing">Pipline Processing</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="payload" className="space-y-4 mt-4 h-full">
                <div>
                    <Label htmlFor="payloadNumber">Payload #</Label>
                    <Select
                        disabled={isOnePayload}
                        value={selectedParam.highlightRange.id}
                        onValueChange={(value) => {
                            dispatch(setSelectedParameter({ parameterId: value }));
                        }}
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(isOnePayload ? [parameters[0]] : parameters).map((param, index) => (
                                <SelectItem key={index} value={param.highlightRange.id}>
                                    {param.highlightRange.originalText}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div>
                    <Label>Type</Label>
                    <Select defaultValue={selectedParam.payloadSource}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="manual">Manual</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <Label>Selected File</Label>
                <div className="space-y-2">
                    <Textarea
                        className="h-48"
                        value={selectedParam.values.join("\n") || ""}
                        onChange={handleValues}
                    />

                    <div className="flex gap-2 w-full">
                        <label
                            htmlFor="file-upload"
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer w-full"
                        >
                            <IconUpload className="mr-2" />
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
                    Number of requests: {
                        isOnePayload
                            ? parameters[0].values.length
                            : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ZIPPED
                                ? parameters.reduce((acc, param) => param.values.length < acc ? param.values.length : acc, Infinity)
                                : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.COMBINATORIAL
                                    ? parameters.reduce((acc, param) => acc * param.values.length, 1)
                                    : parameters[0].values.length
                    }
                </div>
            </TabsContent>

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
                    value={session.fuzzConfig.numThreads}
                    onChange={(event) => {
                        dispatch(setNumThreads({ numThreads: parseInt(event.target.value) }));
                    }}
                />
                <br />
                <Label htmlFor="delais">Delais between Requests (ms)</Label>
                <p className="text-xs">
                    This delais are between request in the same threads, so if you have restriction to send just
                    one request every 1s use 1 thread and 10,000ms
                </p>
                <Input
                    id="delais"
                    type="number"
                    min={0}
                    value={session.fuzzConfig.delayMs}
                    onChange={(event) => {
                        dispatch(setDelayMs({ delayMs: parseInt(event.target.value) }));
                    }}
                />
            </TabsContent>
        </Tabs>
    );
}