import React from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useReplayerEditor } from '@/context/ReplayerContext';

export const ReplayerSettingsPopover: React.FC = () => {
    const {
        activeDraft,
        updateContentLength,
        setUpdateContentLength,
        forceCloseConnection,
        setForceCloseConnection,
        autoScroll,
        setAutoScroll,
    } = useReplayerEditor();

    const isWs = activeDraft?.sessionType === 'ws';

    return (
        <Popover>
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground border-border/60"
                                aria-label="Replayer Options"
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                        {isWs ? "WebSocket options" : "Replayer options"}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <PopoverContent
                align="start"
                side="bottom"
                sideOffset={6}
                className="w-64 p-3 bg-popover text-popover-foreground border border-border shadow-lg space-y-3 z-50"
            >
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase pb-1 border-b border-border/40 select-none">
                    {isWs ? "WebSocket Options" : "Replayer Options"}
                </div>

                {isWs ? (
                    <div className="space-y-2.5">
                        <div className="flex items-start space-x-2.5">
                            <Checkbox
                                id="ws-autoscroll"
                                checked={autoScroll}
                                onCheckedChange={(checked) => setAutoScroll(checked === true)}
                                className="mt-0.5"
                            />
                            <div className="grid gap-0.5 leading-none select-none">
                                <Label
                                    htmlFor="ws-autoscroll"
                                    className="text-xs font-medium cursor-pointer"
                                >
                                    Auto-scroll messages
                                </Label>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        <div className="flex items-start space-x-2.5">
                            <Checkbox
                                id="replayer-update-content-length"
                                checked={updateContentLength}
                                onCheckedChange={(checked) => setUpdateContentLength(checked === true)}
                                className="mt-0.5"
                            />
                            <div className="grid gap-0.5 leading-none select-none">
                                <Label
                                    htmlFor="replayer-update-content-length"
                                    className="text-xs font-medium cursor-pointer"
                                >
                                    Update Content-Length
                                </Label>
                            </div>
                        </div>

                        <div className="flex items-start space-x-2.5">
                            <Checkbox
                                id="replayer-force-close-connection"
                                checked={forceCloseConnection}
                                onCheckedChange={(checked) => setForceCloseConnection(checked === true)}
                                className="mt-0.5"
                            />
                            <div className="grid gap-0.5 leading-none select-none">
                                <Label
                                    htmlFor="replayer-force-close-connection"
                                    className="text-xs font-medium cursor-pointer"
                                >
                                    Force Close Connection
                                </Label>
                            </div>
                        </div>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default ReplayerSettingsPopover;
