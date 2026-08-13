import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { PayloadCodeEditor } from "./PayloadCodeEditor";
import { loadValuesParam, setDelayMs, setNumThreads, setSelectedParameter, selectFuzzerState } from "@/store/slices/fuzzerSlice";
import { FuzzingAttackType } from "@/types/fuzzer.type";
import { IconUpload } from "@tabler/icons-react";
import { EmptyState } from "../ui/empty-state";
import { ArrowRight, MousePointerClick } from "lucide-react";

export default function PayloadConfigurator() {
    const projectId = useProjectId();
    const { activeSessionIndex, fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
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

    const handleValuesChange = (val: string) => {
        if (paramIndex === -1 || !projectId) return;
        dispatch(loadValuesParam({ paramIndex, values: val, projectId }));
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || paramIndex === -1 || !projectId) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            let fileContent = e.target?.result as string;
            fileContent = fileContent.replace(/\r/g, '');

            const existingValues = selectedParam?.values.join("\n") || "";
            const updatedValues = existingValues ? `${existingValues}\n${fileContent}` : fileContent;

            dispatch(loadValuesParam({ paramIndex, values: updatedValues, projectId }));
        };

        reader.onerror = () => {
            console.error("Error reading file");
        };

        reader.readAsText(file);
        event.target.value = '';
    };

    if (selectedParam === null) {
        return <EmptyState
            icon={MousePointerClick}
            title="No parameter selected"
            description="Highlight a value in the request, then mark it for fuzzing to configure its payload here."
            action={
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted/60 border border-border text-muted-foreground text-[10px] font-mono shadow-xs">
                    <span>Select text</span>
                    <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                    <span>Add to fuzzer</span>
                </div>
            }
        />;
    }

    return (
        <Tabs defaultValue="payload" className="w-full max-w-lg p-4 h-full">
            <TabsList>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="pipline-processing">Pipline Processing</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="payload" className="space-y-4 mt-4 h-full">
                {
                    (session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ZIPPED || session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.COMBINATORIAL) &&
                    <div>
                        <Label htmlFor="payloadNumber">Payload #</Label>
                        <Select
                            disabled={isOnePayload}
                            value={selectedParam.highlightRange.id}
                            onValueChange={(value) => {
                                if (projectId) dispatch(setSelectedParameter({ parameterId: value, projectId }));
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

                }

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
                    <PayloadCodeEditor
                        value={selectedParam.values.join("\n") || ""}
                        onChange={handleValuesChange}
                        height="200px"
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
                            ? parameters[0]?.values.length ?? 0
                            : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ZIPPED
                                ? parameters.reduce((acc, param) => param.values.length < acc ? param.values.length : acc, Infinity)
                                : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.COMBINATORIAL
                                    ? parameters.reduce((acc, param) => acc * param.values.length, 1)
                                    : parameters[0]?.values.length ?? 0
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
                    max={100}
                    value={session.fuzzConfig.numThreads}
                    onChange={(event) => {
                        if (projectId) dispatch(setNumThreads({ numThreads: parseInt(event.target.value), projectId }));
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
                        if (projectId) dispatch(setDelayMs({ delayMs: parseInt(event.target.value), projectId }));
                    }}
                />
            </TabsContent>
        </Tabs>
    );
}