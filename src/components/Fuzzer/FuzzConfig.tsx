import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { PayloadCodeEditor } from "./PayloadCodeEditor";
import { loadValuesParam, setDelayMs, setNumThreads, setSelectedParameter, selectFuzzerState, persistFuzzerSession, setPipelineScope, addPipelineRule, updatePipelineRule, removePipelineRule, reorderPipelineRules } from "@/store/slices/fuzzerSlice";
import { FuzzingAttackType, PreprocessingRule } from "@/types/fuzzer.type";
import { IconUpload } from "@tabler/icons-react";
import { EmptyState } from "../ui/empty-state";
import { ArrowRight, MousePointerClick } from "lucide-react";
import { PipelineProcessorTable } from "./PipelineProcessorTable";
import { cn } from "@/lib/utils";

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
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
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
            dispatch(persistFuzzerSession(projectId, activeSessionIndex));
        };

        reader.onerror = () => {
            console.error("Error reading file");
        };

        reader.readAsText(file);
        event.target.value = '';
    };

    if (selectedParam === null) {
        const noParams = parameters.length === 0;
        return <EmptyState
            icon={MousePointerClick}
            title={noParams ? "No parameters defined" : "No parameter selected"}
            description={noParams
                ? "Please add a parameter first by selecting text in the request editor (or clicking '+' to insert a space parameter) to mark it for fuzzing."
                : "Select a parameter to configure its payload values here."}
            action={
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted/60 border border-border text-muted-foreground text-[10px] font-mono shadow-xs">
                    <span>Select text or place cursor</span>
                    <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                    <span>Add to fuzzer (+)</span>
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
                                {(isOnePayload ? [parameters[0]] : parameters).map((param, index) => {
                                    const text = param.highlightRange.originalText;
                                    const displayName = text.trim() === '' ? '§ [space]' : `§ ${text}`;
                                    return (
                                        <SelectItem key={index} value={param.highlightRange.id}>
                                            {`${displayName} (§${index + 1})`}
                                        </SelectItem>
                                    );
                                })}
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

            <TabsContent value="pipline-processing" className="space-y-4 mt-4 h-full">
                {/* Scope Selection Controls */}
                <div className="flex flex-col gap-2 p-3 bg-muted/20 border rounded-lg">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Processing Scope
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted/60 rounded-md border text-xs">
                        <button
                            type="button"
                            onClick={() => {
                                if (projectId) {
                                    dispatch(setPipelineScope({ scope: 'all', projectId }));
                                    dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                                }
                            }}
                            className={cn(
                                "flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all font-medium text-xs cursor-pointer",
                                (session.fuzzConfig.pipelineScope ?? 'all') === 'all'
                                    ? "bg-background text-foreground shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <span>All Parameters</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (projectId) {
                                    dispatch(setPipelineScope({ scope: 'per_parameter', projectId }));
                                    dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                                }
                            }}
                            className={cn(
                                "flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all font-medium text-xs cursor-pointer",
                                session.fuzzConfig.pipelineScope === 'per_parameter'
                                    ? "bg-background text-foreground shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <span>Per Parameter</span>
                        </button>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                        {session.fuzzConfig.pipelineScope === 'per_parameter'
                            ? "Configure independent preprocessing rules for each individual payload parameter."
                            : "A single global pipeline is applied to every payload parameter before sending."}
                    </p>

                    {/* Parameter selector if in Per-Parameter mode */}
                    {session.fuzzConfig.pipelineScope === 'per_parameter' && (
                        <div className="pt-2 border-t mt-1 flex items-center justify-between gap-2">
                            <Label className="text-xs text-muted-foreground shrink-0">Configure for Parameter:</Label>
                            <Select
                                value={selectedParam.highlightRange.id}
                                onValueChange={(value) => {
                                    if (projectId) dispatch(setSelectedParameter({ parameterId: value, projectId }));
                                }}
                            >
                                <SelectTrigger className="w-[180px] h-8 text-xs font-mono">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {parameters.map((param, index) => {
                                        const text = param.highlightRange.originalText;
                                        const displayName = text.trim() === '' ? '§ [space]' : `§ ${text}`;
                                        return (
                                            <SelectItem key={index} value={param.highlightRange.id} className="text-xs font-mono">
                                                {`${displayName} (§${index + 1})`}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                {/* Pipeline Rules Table */}
                <PipelineProcessorTable
                    rules={
                        session.fuzzConfig.pipelineScope === 'per_parameter'
                            ? selectedParam.pipelineRules ?? []
                            : session.fuzzConfig.pipelineRules ?? []
                    }
                    onAddRule={(rule: PreprocessingRule) => {
                        if (!projectId) return;
                        const paramId = session.fuzzConfig.pipelineScope === 'per_parameter' ? selectedParam.highlightRange.id : undefined;
                        dispatch(addPipelineRule({ rule, projectId, paramId }));
                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                    }}
                    onUpdateRule={(rule: PreprocessingRule) => {
                        if (!projectId) return;
                        const paramId = session.fuzzConfig.pipelineScope === 'per_parameter' ? selectedParam.highlightRange.id : undefined;
                        dispatch(updatePipelineRule({ rule, projectId, paramId }));
                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                    }}
                    onRemoveRule={(ruleId: string) => {
                        if (!projectId) return;
                        const paramId = session.fuzzConfig.pipelineScope === 'per_parameter' ? selectedParam.highlightRange.id : undefined;
                        dispatch(removePipelineRule({ ruleId, projectId, paramId }));
                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                    }}
                    onReorderRules={(fromIndex: number, toIndex: number) => {
                        if (!projectId) return;
                        const paramId = session.fuzzConfig.pipelineScope === 'per_parameter' ? selectedParam.highlightRange.id : undefined;
                        dispatch(reorderPipelineRules({ fromIndex, toIndex, projectId, paramId }));
                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                    }}
                    sampleDefaultValue={selectedParam.values?.[0] || 'admin_test123'}
                />
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
                        const val = parseInt(event.target.value);
                        if (projectId && !isNaN(val)) {
                            dispatch(setNumThreads({ numThreads: val, projectId }));
                            dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                        }
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
                        const val = parseInt(event.target.value);
                        if (projectId && !isNaN(val)) {
                            dispatch(setDelayMs({ delayMs: val, projectId }));
                            dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                        }
                    }}
                />
            </TabsContent>
        </Tabs>
    );
}