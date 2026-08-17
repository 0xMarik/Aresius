import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import { open } from "@tauri-apps/plugin-shell"
import { Github, Globe, MessageSquare, Shield, Twitter, Linkedin } from "lucide-react"
import { IconBrandReddit } from "@tabler/icons-react"

interface AboutDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export default function AboutDialog({ open: isOpen, onOpenChange }: AboutDialogProps) {
    const handleOpenLink = (url: string) => {
        open(url).catch((err) => console.error("Failed to open external link:", err))
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] p-6 gap-5">
                <DialogHeader className="flex flex-col items-center text-center gap-3">
                    <Avatar className="h-16 w-16 rounded-xl shadow-md border border-border">
                        <AvatarImage src="/icon.png" alt="Aresius" />
                        <AvatarFallback className="rounded-xl bg-primary text-primary-foreground text-xl font-bold">
                            AR
                        </AvatarFallback>
                    </Avatar>
                    <div>
                        <DialogTitle className="text-xl font-bold tracking-tight">Aresius</DialogTitle>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">Version 0.1.0 • Beta</p>
                    </div>
                </DialogHeader>

                <div className="text-center text-xs text-muted-foreground leading-relaxed px-2">
                    The lightweight, native interception proxy for security testing. Fast, cross-platform, and open-source — built on <span className="font-semibold text-foreground">Tauri & Rust</span>.
                </div>

                <div className="flex flex-col gap-2 bg-muted/40 rounded-lg p-3 border border-border/50 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-2">
                            <Shield className="h-3.5 w-3.5 text-primary" />
                            License
                        </span>
                        <span className="font-medium text-foreground">GNU AGPL v3.0</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5 text-primary" />
                            Backend Engine
                        </span>
                        <span className="font-medium text-foreground">Rust (Native TLS/Proxy)</span>
                    </div>
                </div>

                {/* Social Media & Links */}
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Social & Community
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://github.com/0xMarik/Aresius")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <Github className="h-4 w-4 shrink-0" />
                            <span>GitHub</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://www.linkedin.com/company/aresius")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <Linkedin className="h-4 w-4 shrink-0 text-blue-500" />
                            <span>LinkedIn</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://www.reddit.com/r/aresius")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <IconBrandReddit className="h-4 w-4 shrink-0 text-orange-500" />
                            <span>Reddit</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://x.com/0xMarik")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <Twitter className="h-4 w-4 shrink-0 text-sky-500" />
                            <span>X / Twitter</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://github.com/0xMarik/Aresius/discussions")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <MessageSquare className="h-4 w-4 shrink-0 text-emerald-500" />
                            <span>Discussions</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleOpenLink("https://github.com/0xMarik/Aresius/issues")}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
                        >
                            <Shield className="h-4 w-4 shrink-0 text-amber-500" />
                            <span>Report Issue</span>
                        </button>
                    </div>
                </div>

                <div className="text-center text-[10px] text-muted-foreground/70">
                    © 2026 Aresius Team. All rights reserved.
                </div>
            </DialogContent>
        </Dialog>
    )
}
