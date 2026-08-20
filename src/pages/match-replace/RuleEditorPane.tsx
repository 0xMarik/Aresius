import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    SlidersHorizontal,
    FileText,
    ArrowRightLeft,
    Info,
    Regex,
    CaseSensitive,
    Crosshair,
} from 'lucide-react';
import { MatchReplaceRule, MatchReplaceType } from './types';

interface RuleEditorPaneProps {
    rule: MatchReplaceRule | null;
    collectionName?: string;
    onUpdateRule: (updated: Partial<MatchReplaceRule>) => void;
}

export const RuleEditorPane: React.FC<RuleEditorPaneProps> = ({
    rule,
    collectionName,
    onUpdateRule,
}) => {
    if (!rule) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-card/40 text-muted-foreground p-6 text-center">
                <SlidersHorizontal className="w-10 h-10 mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No Rule Selected</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Select a rule from the left panel to configure its match and replace patterns, or create a new one.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-card/60 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/20 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Rule Configuration
                        </span>
                        {collectionName && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border/60 text-muted-foreground/80 font-mono font-normal">
                                {collectionName}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                            {rule.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <Switch
                            checked={rule.enabled}
                            onCheckedChange={(checked) => onUpdateRule({ enabled: checked })}
                            aria-label="Toggle rule active state"
                        />
                    </div>
                </div>
            </div>

            {/* Form Fields */}
            <div className="p-4 space-y-4">
                {/* Rule Name & Comment Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Rule Name */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rule-name" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                            Rule Name
                        </Label>
                        <Input
                            id="rule-name"
                            value={rule.name}
                            onChange={(e) => onUpdateRule({ name: e.target.value })}
                            placeholder="e.g. Strip Accept-Encoding"
                            className="h-8 text-xs font-mono bg-background/80"
                        />
                    </div>

                    {/* Type Selection */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rule-type" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                            <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                            Type
                        </Label>
                        <Select
                            value={rule.type}
                            onValueChange={(val: MatchReplaceType) => onUpdateRule({ type: val })}
                        >
                            <SelectTrigger id="rule-type" className="h-8 text-xs font-mono bg-background/80">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent className="text-xs font-mono">
                                <SelectGroup>
                                    <SelectLabel className="text-[10px] text-muted-foreground tracking-wider uppercase">
                                        Request
                                    </SelectLabel>
                                    <SelectItem value="request_header">Request header</SelectItem>
                                    <SelectItem value="request_body">Request body</SelectItem>
                                    <SelectItem value="request_param_name">Request param name</SelectItem>
                                    <SelectItem value="request_param_value">Request param value</SelectItem>
                                    <SelectItem value="request_first_line">Request first line</SelectItem>
                                </SelectGroup>
                                <SelectGroup>
                                    <SelectLabel className="text-[10px] text-muted-foreground tracking-wider uppercase pt-2">
                                        Response
                                    </SelectLabel>
                                    <SelectItem value="response_header">Response header</SelectItem>
                                    <SelectItem value="response_body">Response body</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Comment Field */}
                <div className="space-y-1.5">
                    <Label htmlFor="rule-comment" className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        Comment
                    </Label>
                    <Input
                        id="rule-comment"
                        value={rule.comment}
                        onChange={(e) => onUpdateRule({ comment: e.target.value })}
                        placeholder="Describe what this matcher does (e.g. Prevent compressed responses for easier inspection)..."
                        className="h-8 text-xs font-mono bg-background/80"
                    />
                </div>

                {/* Scope Settings */}
                <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="rule-in-scope"
                            checked={rule.onlyInScope ?? true}
                            onCheckedChange={(checked) => onUpdateRule({ onlyInScope: checked === true })}
                            className="h-4 w-4 rounded"
                        />
                        <Label
                            htmlFor="rule-in-scope"
                            className="flex items-center gap-1.5 text-xs font-mono font-medium text-foreground cursor-pointer select-none"
                        >
                            <Crosshair className="w-3.5 h-3.5 text-primary" />
                            Only apply to in-scope items
                        </Label>
                    </div>
                </div>

                {/* Match & Replace Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 border-t border-border/20">
                    {/* Match Column */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="rule-match" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                Match Pattern
                            </Label>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                    <Checkbox
                                        id="rule-regex"
                                        checked={rule.isRegex ?? false}
                                        onCheckedChange={(checked) => onUpdateRule({ isRegex: checked === true })}
                                        className="h-3.5 w-3.5 rounded"
                                    />
                                    <Label
                                        htmlFor="rule-regex"
                                        className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground cursor-pointer hover:text-foreground select-none"
                                    >
                                        <Regex className="w-3 h-3" /> Regex
                                    </Label>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Checkbox
                                        id="rule-case"
                                        checked={rule.isCaseSensitive ?? false}
                                        onCheckedChange={(checked) => onUpdateRule({ isCaseSensitive: checked === true })}
                                        className="h-3.5 w-3.5 rounded"
                                    />
                                    <Label
                                        htmlFor="rule-case"
                                        className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground cursor-pointer hover:text-foreground select-none"
                                    >
                                        <CaseSensitive className="w-3.5 h-3.5" /> Match Case
                                    </Label>
                                </div>
                            </div>
                        </div>
                        <Input
                            id="rule-match"
                            value={rule.match}
                            onChange={(e) => onUpdateRule({ match: e.target.value })}
                            placeholder="Word or regex pattern to match..."
                            className="h-8 text-xs font-mono bg-background/80 border-primary/30 focus-visible:border-primary"
                        />
                        <p className="text-[10px] text-muted-foreground">
                            {rule.isRegex ? 'Enter a regular expression to match against the target section.' : 'Enter literal text to match.'}
                        </p>
                    </div>

                    {/* Replace Column */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="rule-replace" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                Replace With
                            </Label>
                        </div>
                        <Input
                            id="rule-replace"
                            value={rule.replace}
                            onChange={(e) => onUpdateRule({ replace: e.target.value })}
                            placeholder="Replacement string (leave empty to remove)..."
                            className="h-8 text-xs font-mono bg-background/80"
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Matching string or pattern will be replaced with this value.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
