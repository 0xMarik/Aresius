import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    ChevronDown,
    ChevronUp,
    Pencil,
    Plus,
    Trash2,
    Sparkles,
    Layers,
} from 'lucide-react';
import {
    PreprocessingRule,
    PreprocessingType,
    CaseOption,
    EncodingOption,
    DecodingOption,
} from '@/types/fuzzer.type';
import { applyPipeline } from '@/lib/fuzzerPreprocessing';

interface PipelineProcessorTableProps {
    rules: PreprocessingRule[];
    onAddRule: (rule: PreprocessingRule) => void;
    onUpdateRule: (rule: PreprocessingRule) => void;
    onRemoveRule: (ruleId: string) => void;
    onReorderRules: (fromIndex: number, toIndex: number) => void;
    sampleDefaultValue?: string;
}

export const PipelineProcessorTable: React.FC<PipelineProcessorTableProps> = ({
    rules,
    onAddRule,
    onUpdateRule,
    onRemoveRule,
    onReorderRules,
    sampleDefaultValue = 'Admin 123 & test',
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

    // Form state
    const [ruleType, setRuleType] = useState<PreprocessingType>('modify_case');
    const [caseOption, setCaseOption] = useState<CaseOption>('lowercase');
    const [encodeOption, setEncodeOption] = useState<EncodingOption>('url_key');
    const [decodeOption, setDecodeOption] = useState<DecodingOption>('url');
    const [textValue, setTextValue] = useState('');
    const [pattern, setPattern] = useState('');
    const [replacement, setReplacement] = useState('');

    // Live preview input state
    const [previewInput, setPreviewInput] = useState(sampleDefaultValue);

    const openAddDialog = () => {
        setEditingRuleId(null);
        setRuleType('modify_case');
        setCaseOption('lowercase');
        setEncodeOption('url_key');
        setDecodeOption('url');
        setTextValue('');
        setPattern('');
        setReplacement('');
        setIsDialogOpen(true);
    };

    const openEditDialog = (rule: PreprocessingRule) => {
        setEditingRuleId(rule.id);
        setRuleType(rule.type);
        setCaseOption(rule.caseOption || 'lowercase');
        setEncodeOption(rule.encodeOption || 'url_key');
        setDecodeOption(rule.decodeOption || 'url');
        setTextValue(rule.value || '');
        setPattern(rule.pattern || '');
        setReplacement(rule.replacement || '');
        setIsDialogOpen(true);
    };

    const handleSaveRule = () => {
        const rule: PreprocessingRule = {
            id: editingRuleId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule_${Date.now()}`),
            type: ruleType,
            caseOption: ruleType === 'modify_case' ? caseOption : undefined,
            encodeOption: ruleType === 'encode' ? encodeOption : undefined,
            decodeOption: ruleType === 'decode' ? decodeOption : undefined,
            value: ruleType === 'prefix' || ruleType === 'suffix' ? textValue : undefined,
            pattern: ruleType === 'match_replace' ? pattern : undefined,
            replacement: ruleType === 'match_replace' ? replacement : undefined,
            isRegex: ruleType === 'match_replace' ? true : undefined,
        };

        if (editingRuleId) {
            onUpdateRule(rule);
        } else {
            onAddRule(rule);
        }

        setIsDialogOpen(false);
    };

    // Human readable badge info for table display
    const getRuleDetails = (rule: PreprocessingRule) => {
        switch (rule.type) {
            case 'modify_case':
                return {
                    label: 'Modify Case',
                    badgeVariant: 'secondary',
                    summary: rule.caseOption === 'uppercase' ? 'Uppercase (ABC)' : 'Lowercase (abc)',
                };
            case 'encode':
                return {
                    label: 'Encoding',
                    badgeVariant: 'default',
                    summary:
                        rule.encodeOption === 'url_all'
                            ? 'URL Encode (All Characters)'
                            : rule.encodeOption === 'base64'
                            ? 'Base64 Encode'
                            : 'URL Encode (Key Characters)',
                };
            case 'decode':
                return {
                    label: 'Decoding',
                    badgeVariant: 'outline',
                    summary: rule.decodeOption === 'base64' ? 'Base64 Decode' : 'URL Decode',
                };
            case 'prefix':
                return {
                    label: 'Prefix',
                    badgeVariant: 'secondary',
                    summary: `Prepend: "${rule.value || ''}"`,
                };
            case 'suffix':
                return {
                    label: 'Suffix',
                    badgeVariant: 'secondary',
                    summary: `Append: "${rule.value || ''}"`,
                };
            case 'match_replace':
                return {
                    label: 'Match / Replace',
                    badgeVariant: 'default',
                    summary: `/${rule.pattern || ''}/ → "${rule.replacement || ''}"`,
                };
            default:
                return { label: rule.type, badgeVariant: 'outline', summary: '' };
        }
    };

    // Calculate live output for preview
    const previewOutput = useMemo(() => {
        return applyPipeline(previewInput, rules);
    }, [previewInput, rules]);

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Header & Add Button */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Pipeline Steps ({rules.length})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        Executed sequentially from top to bottom before attaching payload to request.
                    </p>
                </div>
                <Button size="sm" onClick={openAddDialog} className="h-8 gap-1.5 text-xs">
                    <Plus className="w-3.5 h-3.5" />
                    Add Step
                </Button>
            </div>

            {/* Tiny Table with Fixed Height */}
            <div className="h-[200px] border rounded-md overflow-hidden bg-card/40 flex flex-col">
                {rules.length === 0 ? (
                    <div className="h-full flex-1 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                        <Layers className="w-6 h-6 text-muted-foreground/50 stroke-1" />
                        <span>No processing steps configured yet.</span>
                        <Button variant="outline" size="sm" onClick={openAddDialog} className="h-7 text-xs mt-1">
                            <Plus className="w-3 h-3 mr-1" />
                            Add first step
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-y-auto flex-1 h-full">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur-xs z-10">
                                <TableRow className="hover:bg-transparent bg-muted/40">
                                    <TableHead className="w-10 text-center font-mono text-[11px] h-8 py-1">#</TableHead>
                                    <TableHead className="w-36 text-[11px] h-8 py-1">Type</TableHead>
                                    <TableHead className="text-[11px] h-8 py-1">Configuration</TableHead>
                                    <TableHead className="w-28 text-right text-[11px] h-8 py-1 pr-3">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                            {rules.map((rule, idx) => {
                                const details = getRuleDetails(rule);
                                return (
                                    <TableRow key={rule.id} className="text-xs group hover:bg-muted/30">
                                        <TableCell className="text-center font-mono text-muted-foreground text-[11px] py-1.5">
                                            {idx + 1}
                                        </TableCell>
                                        <TableCell className="py-1.5 font-medium">
                                            <Badge variant={details.badgeVariant as any} className="text-[10px] py-0 px-1.5 font-normal">
                                                {details.label}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="py-1.5 font-mono text-[11px] truncate max-w-[200px]" title={details.summary}>
                                            {details.summary}
                                        </TableCell>
                                        <TableCell className="text-right py-1.5 pr-2">
                                            <div className="flex items-center justify-end gap-0.5">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                                    disabled={idx === 0}
                                                    onClick={() => onReorderRules(idx, idx - 1)}
                                                    title="Move Up"
                                                >
                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                                    disabled={idx === rules.length - 1}
                                                    onClick={() => onReorderRules(idx, idx + 1)}
                                                    title="Move Down"
                                                >
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                    onClick={() => openEditDialog(rule)}
                                                    title="Edit"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                                    onClick={() => onRemoveRule(rule.id)}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                    </div>
                )}
            </div>

            {/* Live Interactive Preview Box */}
            <div className="border rounded-md p-3 bg-muted/20 space-y-2.5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        Live Pipeline Test
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                        {rules.length} transformation{rules.length === 1 ? '' : 's'}
                    </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                    <div>
                        <Label htmlFor="livePreviewInput" className="text-[10px] text-muted-foreground uppercase font-mono">
                            Input Payload
                        </Label>
                        <Input
                            id="livePreviewInput"
                            value={previewInput}
                            onChange={(e) => setPreviewInput(e.target.value)}
                            placeholder="Type test payload..."
                            className="h-8 font-mono text-xs mt-1"
                        />
                    </div>
                    <div>
                        <Label className="text-[10px] text-muted-foreground uppercase font-mono">
                            Transformed Result
                        </Label>
                        <div className="min-h-[32px] px-3 py-1.5 mt-1 rounded-md border bg-background/80 font-mono text-xs text-foreground break-all select-all flex items-center">
                            {previewOutput}
                        </div>
                    </div>
                </div>
            </div>

            {/* Add / Edit Modal Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingRuleId ? 'Edit Preprocessing Step' : 'Add Preprocessing Step'}</DialogTitle>
                        <DialogDescription>
                            Configure the transformation rule to apply to payload values.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Step Type Selection */}
                        <div className="space-y-1.5">
                            <Label htmlFor="ruleTypeSelect" className="text-xs">Processing Type</Label>
                            <Select value={ruleType} onValueChange={(val) => setRuleType(val as PreprocessingType)}>
                                <SelectTrigger id="ruleTypeSelect" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="modify_case">Modify Case</SelectItem>
                                    <SelectItem value="encode">Encoding</SelectItem>
                                    <SelectItem value="decode">Decoding</SelectItem>
                                    <SelectItem value="prefix">Prefix</SelectItem>
                                    <SelectItem value="suffix">Suffix</SelectItem>
                                    <SelectItem value="match_replace">Match / Replace</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Modify Case Options */}
                        {ruleType === 'modify_case' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="caseOptionSelect" className="text-xs">Case Option</Label>
                                <Select value={caseOption} onValueChange={(val) => setCaseOption(val as CaseOption)}>
                                    <SelectTrigger id="caseOptionSelect">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="lowercase">To Lowercase (abc)</SelectItem>
                                        <SelectItem value="uppercase">To Uppercase (ABC)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Encoding Options */}
                        {ruleType === 'encode' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="encodeOptionSelect" className="text-xs">Encoding Method</Label>
                                <Select value={encodeOption} onValueChange={(val) => setEncodeOption(val as EncodingOption)}>
                                    <SelectTrigger id="encodeOptionSelect">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="url_key">URL-encode Key Characters (e.g. spaces, delimiters)</SelectItem>
                                        <SelectItem value="url_all">URL-encode All Characters (%XX for every char)</SelectItem>
                                        <SelectItem value="base64">Base64 Encode</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Decoding Options */}
                        {ruleType === 'decode' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="decodeOptionSelect" className="text-xs">Decoding Method</Label>
                                <Select value={decodeOption} onValueChange={(val) => setDecodeOption(val as DecodingOption)}>
                                    <SelectTrigger id="decodeOptionSelect">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="url">URL Decode (%XX to characters)</SelectItem>
                                        <SelectItem value="base64">Base64 Decode</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Prefix String */}
                        {ruleType === 'prefix' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="prefixValue" className="text-xs">Prefix String to Prepend</Label>
                                <Input
                                    id="prefixValue"
                                    value={textValue}
                                    onChange={(e) => setTextValue(e.target.value)}
                                    placeholder="e.g. admin_ or /api/"
                                    className="font-mono text-xs"
                                    autoFocus
                                />
                            </div>
                        )}

                        {/* Suffix String */}
                        {ruleType === 'suffix' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="suffixValue" className="text-xs">Suffix String to Append</Label>
                                <Input
                                    id="suffixValue"
                                    value={textValue}
                                    onChange={(e) => setTextValue(e.target.value)}
                                    placeholder="e.g. .json or _test"
                                    className="font-mono text-xs"
                                    autoFocus
                                />
                            </div>
                        )}

                        {/* Match & Replace */}
                        {ruleType === 'match_replace' && (
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="matchPattern" className="text-xs">Match Regex Pattern</Label>
                                    <Input
                                        id="matchPattern"
                                        value={pattern}
                                        onChange={(e) => setPattern(e.target.value)}
                                        placeholder="e.g. \d+ or [a-z]+"
                                        className="font-mono text-xs"
                                        autoFocus
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="replaceValue" className="text-xs">Replacement Value</Label>
                                    <Input
                                        id="replaceValue"
                                        value={replacement}
                                        onChange={(e) => setReplacement(e.target.value)}
                                        placeholder="e.g. replacement_text"
                                        className="font-mono text-xs"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveRule}>
                            {editingRuleId ? 'Save Changes' : 'Add Step'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
