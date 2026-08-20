import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { PayloadCodeEditor } from "./PayloadCodeEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { loadValuesParam, setDelayMs, setNumThreads, setSelectedParameter, selectFuzzerState, persistFuzzerSession, setPipelineScope, addPipelineRule, updatePipelineRule, removePipelineRule, reorderPipelineRules, setPayloadSource, setNumbersConfig, setNullPayloadConfig, setConnectionKeepAlive, setUpdateContentLength } from "@/store/slices/fuzzerSlice";
import { FuzzingAttackType, PreprocessingRule, PayloadSource, NumbersPayloadConfig, NullPayloadConfig } from "@/types/fuzzer.type";
import { IconUpload } from "@tabler/icons-react";
import { EmptyState } from "../ui/empty-state";
import { ArrowRight, MousePointerClick, Hash, CircleOff, FileText } from "lucide-react";
import { PipelineProcessorTable } from "./PipelineProcessorTable";
import { generateNumberPayloads } from "@/lib/fuzzerPreprocessing";
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

    const generatedNumbersPreview = useMemo(() => {
        if (!selectedParam) return [];
        const cfg = selectedParam.numbersConfig || { start: 1, end: 100, step: 1, minIntegerDigits: 1 };
        return generateNumberPayloads(cfg);
    }, [selectedParam?.numbersConfig]);

    const getParamEffectiveCount = (param: (typeof parameters)[0] | undefined): number => {
        if (!param) return 0;
        if (param.payloadSource === 'numbers') {
            const cfg = param.numbersConfig || { start: 1, end: 100, step: 1, minIntegerDigits: 1 };
            return generateNumberPayloads(cfg).length;
        }
        if (param.payloadSource === 'null_payload') {
            return param.nullPayloadConfig?.count ?? 10;
        }
        return param.values.length;
    };

    const handleValuesChange = (val: string) => {
        if (paramIndex === -1 || !projectId) return;
        dispatch(loadValuesParam({ paramIndex, values: val, projectId }));
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
    };

    const handlePayloadSourceChange = (newSource: PayloadSource) => {
        if (paramIndex === -1 || !projectId || !selectedParam) return;
        dispatch(setPayloadSource({ paramIndex, payloadSource: newSource, projectId }));

        if (newSource === 'numbers' && !selectedParam.numbersConfig) {
            const cfg: NumbersPayloadConfig = { start: 1, end: 100, step: 1, minIntegerDigits: 1 };
            dispatch(setNumbersConfig({ paramIndex, config: cfg, projectId }));
        } else if (newSource === 'null_payload' && !selectedParam.nullPayloadConfig) {
            const cfg: NullPayloadConfig = { count: 10 };
            dispatch(setNullPayloadConfig({ paramIndex, config: cfg, projectId }));
        }
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
    };

    const handleNumbersConfigChange = (partial: Partial<NumbersPayloadConfig>) => {
        if (paramIndex === -1 || !projectId || !selectedParam) return;
        const currentCfg = selectedParam.numbersConfig || { start: 1, end: 100, step: 1, minIntegerDigits: 1 };
        const updated = { ...currentCfg, ...partial };

        if (updated.minIntegerDigits !== undefined) {
            updated.minIntegerDigits = Math.max(1, updated.minIntegerDigits);
        }

        if (updated.maxIntegerDigits !== undefined && updated.maxIntegerDigits !== null) {
            const minDigits = updated.minIntegerDigits ?? 1;
            if (updated.maxIntegerDigits < minDigits) {
                updated.maxIntegerDigits = minDigits;
            }
        }

        dispatch(setNumbersConfig({ paramIndex, config: updated, projectId }));
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
    };

    const handleNullPayloadConfigChange = (count: number) => {
        if (paramIndex === -1 || !projectId) return;
        const updated: NullPayloadConfig = { count: Math.max(1, count) };
        dispatch(setNullPayloadConfig({ paramIndex, config: updated, projectId }));
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

                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payload Type</Label>
                    <Select
                        value={selectedParam.payloadSource || 'manual'}
                        onValueChange={(val) => handlePayloadSourceChange(val as PayloadSource)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="manual" className="text-xs">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span>Manual / File (Wordlist)</span>
                                </div>
                            </SelectItem>
                            <SelectItem value="numbers" className="text-xs">
                                <div className="flex items-center gap-2">
                                    <Hash className="w-3.5 h-3.5 text-primary" />
                                    <span>Numbers (Sequence Generator)</span>
                                </div>
                            </SelectItem>
                            <SelectItem value="null_payload" className="text-xs">
                                <div className="flex items-center gap-2">
                                    <CircleOff className="w-3.5 h-3.5 text-amber-500" />
                                    <span>Null Payload (Repeater)</span>
                                </div>
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Conditional UI based on selectedParam.payloadSource */}
                {selectedParam.payloadSource === 'numbers' ? (
                    <div className="space-y-3 p-3 bg-muted/20 border rounded-lg">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                <Hash className="w-3.5 h-3.5 text-primary" />
                                Numbers Configuration
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                                {generatedNumbersPreview.length} generated
                            </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <Label htmlFor="numStart" className="text-[10px] text-muted-foreground uppercase font-mono">From (Start)</Label>
                                <Input
                                    id="numStart"
                                    type="number"
                                    value={selectedParam.numbersConfig?.start ?? 1}
                                    onChange={(e) => handleNumbersConfigChange({ start: parseInt(e.target.value) || 0 })}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="numEnd" className="text-[10px] text-muted-foreground uppercase font-mono">To (End)</Label>
                                <Input
                                    id="numEnd"
                                    type="number"
                                    value={selectedParam.numbersConfig?.end ?? 100}
                                    onChange={(e) => handleNumbersConfigChange({ end: parseInt(e.target.value) || 0 })}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="numStep" className="text-[10px] text-muted-foreground uppercase font-mono">Step</Label>
                                <Input
                                    id="numStep"
                                    type="number"
                                    min={1}
                                    value={selectedParam.numbersConfig?.step ?? 1}
                                    onChange={(e) => handleNumbersConfigChange({ step: Math.max(1, parseInt(e.target.value) || 1) })}
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                            <div className="space-y-1">
                                <Label htmlFor="numMinDigits" className="text-[10px] text-muted-foreground uppercase font-mono">Min Integer Digits</Label>
                                <Input
                                    id="numMinDigits"
                                    type="number"
                                    min={1}
                                    max={20}
                                    value={selectedParam.numbersConfig?.minIntegerDigits ?? 1}
                                    onChange={(e) => {
                                        const newMin = Math.max(1, parseInt(e.target.value) || 1);
                                        const currentMax = selectedParam.numbersConfig?.maxIntegerDigits;
                                        const updatedMax = currentMax !== undefined && currentMax < newMin ? newMin : currentMax;
                                        handleNumbersConfigChange({ minIntegerDigits: newMin, maxIntegerDigits: updatedMax });
                                    }}
                                    placeholder="1 (no zero padding)"
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="numMaxDigits" className="text-[10px] text-muted-foreground uppercase font-mono">Max Integer Digits</Label>
                                <Input
                                    id="numMaxDigits"
                                    type="number"
                                    min={selectedParam.numbersConfig?.minIntegerDigits ?? 1}
                                    max={20}
                                    value={selectedParam.numbersConfig?.maxIntegerDigits ?? ''}
                                    onChange={(e) => {
                                        const minDigits = selectedParam.numbersConfig?.minIntegerDigits ?? 1;
                                        const parsed = e.target.value ? parseInt(e.target.value) : undefined;
                                        const val = parsed !== undefined && !isNaN(parsed) ? Math.max(minDigits, parsed) : undefined;
                                        handleNumbersConfigChange({ maxIntegerDigits: val });
                                    }}
                                    placeholder="Unlimited"
                                    className="h-8 font-mono text-xs"
                                />
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="pt-2 border-t space-y-1">
                            <Label className="text-[10px] text-muted-foreground uppercase font-mono">Sample Preview</Label>
                            <div className="min-h-[28px] px-2.5 py-1 rounded bg-background/80 border font-mono text-[11px] text-muted-foreground truncate select-all">
                                {generatedNumbersPreview.slice(0, 8).join(', ')}
                                {generatedNumbersPreview.length > 8 ? ` ... (${generatedNumbersPreview.length} total)` : ''}
                            </div>
                        </div>
                    </div>
                ) : selectedParam.payloadSource === 'null_payload' ? (
                    <div className="space-y-3 p-3 bg-muted/20 border rounded-lg">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                                <CircleOff className="w-3.5 h-3.5 text-amber-500" />
                                Null Payload Configuration
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                                {selectedParam.nullPayloadConfig?.count ?? 10} requests
                            </span>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="nullPayloadCount" className="text-xs">Number of Payloads (Requests)</Label>
                            <Input
                                id="nullPayloadCount"
                                type="number"
                                min={1}
                                max={100000}
                                value={selectedParam.nullPayloadConfig?.count ?? 10}
                                onChange={(e) => handleNullPayloadConfigChange(parseInt(e.target.value) || 1)}
                                className="h-8 font-mono text-xs"
                            />
                        </div>

                        <p className="text-[11px] text-muted-foreground bg-muted/40 p-2 rounded border">
                            Generates empty (null) payloads. Ideal for blind timing attacks, load generation, or repeatedly replaying requests.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selected Payload List</Label>
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
                )}

                <div>
                    Number of requests: {
                        isOnePayload
                            ? getParamEffectiveCount(parameters[0])
                            : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.ZIPPED
                                ? parameters.reduce((acc, param) => Math.min(acc, getParamEffectiveCount(param)), Infinity)
                                : session.fuzzConfig.fuzzingAttackType === FuzzingAttackType.COMBINATORIAL
                                    ? parameters.reduce((acc, param) => acc * getParamEffectiveCount(param), 1)
                                    : getParamEffectiveCount(parameters[0])
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
                    sampleDefaultValue={
                        selectedParam.payloadSource === 'numbers'
                            ? (generatedNumbersPreview[0] || '1')
                            : selectedParam.payloadSource === 'null_payload'
                            ? ''
                            : (selectedParam.values?.[0] || 'admin_test123')
                    }
                />
            </TabsContent>

            <TabsContent value="settings" className="space-y-4 pt-2">
                <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engine & Concurrency</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="numThreads" className="text-xs">Number of Threads</Label>
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
                            className="h-8 font-mono text-xs"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="delais" className="text-xs">Delay between Requests (ms)</Label>
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
                            className="h-8 font-mono text-xs"
                        />
                    </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                    Delays are applied between requests within each worker thread. For strict rate limiting (e.g. 1 req/sec), use 1 thread and 1,000ms delay.
                </p>

                <div className="pt-3 border-t space-y-3">
                    <div className="space-y-1">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">HTTP Headers & Connection</h3>
                    </div>

                    <div className="space-y-2 pt-1">
                        <div className="flex items-start space-x-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/30 transition-colors">
                            <Checkbox
                                id="setConnectionKeepAlive"
                                checked={session.fuzzConfig.setConnectionKeepAlive ?? true}
                                onCheckedChange={(checked) => {
                                    if (projectId) {
                                        dispatch(setConnectionKeepAlive({ keepAlive: Boolean(checked), projectId }));
                                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                                    }
                                }}
                                className="mt-0.5"
                            />
                            <div className="grid gap-1 leading-none">
                                <Label
                                    htmlFor="setConnectionKeepAlive"
                                    className="text-xs font-medium cursor-pointer"
                                >
                                    set Connection to keep-alive
                                </Label>
                                <p className="text-[11px] text-muted-foreground">
                                    Ensures <code>Connection: keep-alive</code> is present in all outgoing requests so workers reuse persistent TCP / TLS connections.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/30 transition-colors">
                            <Checkbox
                                id="updateContentLength"
                                checked={session.fuzzConfig.updateContentLength ?? true}
                                onCheckedChange={(checked) => {
                                    if (projectId) {
                                        dispatch(setUpdateContentLength({ updateContentLength: Boolean(checked), projectId }));
                                        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
                                    }
                                }}
                                className="mt-0.5"
                            />
                            <div className="grid gap-1 leading-none">
                                <Label
                                    htmlFor="updateContentLength"
                                    className="text-xs font-medium cursor-pointer"
                                >
                                    update Content-Length
                                </Label>
                                <p className="text-[11px] text-muted-foreground">
                                    Automatically recalculates and updates the <code>Content-Length</code> header to match the actual byte length of the body after payload substitution.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </TabsContent>
        </Tabs>
    );
}