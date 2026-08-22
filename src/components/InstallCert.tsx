import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
    ShieldCheck,
    Shield,
    Monitor,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Download,
    Copy,
    Check,
    ExternalLink,
    RefreshCw,
    Trash2,
} from "lucide-react"
import { IconBrandFirefox } from "@tabler/icons-react"

type InstallStatus = "loading" | "idle" | "installed" | "error"
type ActionLoading = "installing" | "uninstalling" | null

interface InstallCertificateDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

const InstallCertificateDialog = ({
    open,
    onOpenChange,
}: InstallCertificateDialogProps) => {
    const [status, setStatus] = useState<InstallStatus>("loading")
    const [actionLoading, setActionLoading] = useState<ActionLoading>(null)
    const [errorMsg, setErrorMsg] = useState<string>("")
    const [caPath, setCaPath] = useState<string>("")
    const [copiedPath, setCopiedPath] = useState<boolean>(false)
    const [copiedPref, setCopiedPref] = useState<boolean>(false)

    const checkStatus = async () => {
        setStatus("loading")
        setErrorMsg("")
        try {
            const installed = (await invoke("check_cert_installed")) as boolean
            setStatus(installed ? "installed" : "idle")
        } catch (err) {
            setStatus("error")
            setErrorMsg(String(err))
        }

        try {
            const path = (await invoke("get_ca_cert_path")) as string
            setCaPath(path)
        } catch {
            // Ignore path loading error if any
        }
    }

    useEffect(() => {
        if (open) {
            checkStatus()
        }
    }, [open])

    const handleInstall = async () => {
        setActionLoading("installing")
        setErrorMsg("")
        try {
            await invoke("install_cert")
            const isInstalled = (await invoke("check_cert_installed")) as boolean
            setStatus(isInstalled ? "installed" : "idle")
            if (isInstalled) {
                toast.success("CA Certificate installed and trusted in OS store")
            }
        } catch (err) {
            setStatus("error")
            setErrorMsg(String(err))
            toast.error(typeof err === "string" ? err : "Failed to install CA certificate")
        } finally {
            setActionLoading(null)
        }
    }

    const handleUninstall = async () => {
        setActionLoading("uninstalling")
        setErrorMsg("")
        try {
            await invoke("uninstall_cert")
            const isInstalled = (await invoke("check_cert_installed")) as boolean
            setStatus(isInstalled ? "installed" : "idle")
            toast.success("CA Certificate removed from OS trust store")
        } catch (err) {
            setStatus("error")
            setErrorMsg(String(err))
            toast.error(typeof err === "string" ? err : "Failed to uninstall CA certificate")
        } finally {
            setActionLoading(null)
        }
    }

    const handleOpenCertManager = async () => {
        try {
            await invoke("open_cert_manager")
        } catch (err) {
            toast.error("Failed to open Certificate Manager")
        }
    }

    const handleExportCaCert = async () => {
        try {
            const pem = (await invoke("get_ca_cert_pem")) as string
            const blob = new Blob([pem], { type: "application/x-pem-file" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = "aresius-ca-cert.pem"
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            toast.success("Downloaded aresius-ca-cert.pem")
        } catch (err) {
            toast.error("Failed to export CA certificate")
        }
    }

    const handleCopyCaPath = async () => {
        try {
            const path = caPath || ((await invoke("get_ca_cert_path")) as string)
            await navigator.clipboard.writeText(path)
            setCopiedPath(true)
            toast.success("Certificate path copied")
            setTimeout(() => setCopiedPath(false), 2000)
        } catch (err) {
            toast.error("Failed to copy path")
        }
    }

    const handleCopyPref = async () => {
        try {
            await navigator.clipboard.writeText("about:preferences#privacy")
            setCopiedPref(true)
            toast.success("Settings URL copied")
            setTimeout(() => setCopiedPref(false), 2000)
        } catch {
            // ignore
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden border-border/80 shadow-2xl bg-card">
                {/* Header */}
                <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                                <Shield className="w-4 h-4" />
                            </div>
                            <DialogTitle className="text-sm font-semibold">
                                CA Certificate Setup
                            </DialogTitle>
                        </div>



                    </div>
                    <DialogDescription className="text-xs text-muted-foreground mt-1">
                        Install or export the Aresius Root CA certificate to inspect HTTPS traffic.
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <Tabs defaultValue="os" className="flex flex-col">
                    <div className="px-5 pt-3 pb-2 border-b border-border/40 bg-muted/10">
                        <TabsList className="grid grid-cols-2 w-full h-8 p-0.5 bg-muted/60">
                            <TabsTrigger
                                value="os"
                                className="text-xs font-medium gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                            >
                                <Monitor className="w-3.5 h-3.5 text-primary" />
                                <span>Add certificate to OS</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="firefox"
                                className="text-xs font-medium gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                            >
                                <IconBrandFirefox className="w-3.5 h-3.5 text-orange-500" />
                                <span>Mozilla Firefox</span>
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* Tab 1: Add Certificate to OS */}
                    <TabsContent value="os" className="p-5 space-y-3.5 m-0">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Trusting the certificate in your operating system enables automatic HTTPS decryption for Chrome, Edge, Brave, and native system applications.
                        </p>

                        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 flex flex-col items-center text-center gap-3">
                            {status === "loading" && (
                                <div className="py-3 flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                    <span>Checking OS certificate store...</span>
                                </div>
                            )}

                            {status === "installed" && (
                                <>
                                    <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                                        <CheckCircle2 className="w-4 h-4" />
                                        <span>Aresius CA certificate is installed and trusted</span>
                                    </div>
                                    <div className="flex items-center gap-2 pt-1">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleOpenCertManager}
                                            disabled={actionLoading !== null}
                                            className="h-7 text-xs gap-1.5 border-border/60 bg-background"
                                        >
                                            <ExternalLink className="w-3 h-3 text-primary" />
                                            Manage Certificates
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleUninstall}
                                            disabled={actionLoading !== null}
                                            className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        >
                                            {actionLoading === "uninstalling" ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-3 h-3" />
                                            )}
                                            Uninstall
                                        </Button>
                                    </div>
                                </>
                            )}

                            {status === "idle" && (
                                <>
                                    <p className="text-xs text-muted-foreground max-w-sm">
                                        Click below to install the CA certificate into your user root trust store.
                                    </p>
                                    <div className="flex items-center gap-2 pt-1">
                                        <Button
                                            size="sm"
                                            onClick={handleInstall}
                                            disabled={actionLoading !== null}
                                            className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                                        >
                                            {actionLoading === "installing" ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <ShieldCheck className="w-3.5 h-3.5" />
                                            )}
                                            {actionLoading === "installing" ? "Installing..." : "Install & Trust Certificate"}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleOpenCertManager}
                                            disabled={actionLoading !== null}
                                            className="h-7 text-xs gap-1 border-border/60"
                                        >
                                            <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                            Manage
                                        </Button>
                                    </div>
                                </>
                            )}

                            {status === "error" && (
                                <div className="w-full flex flex-col items-center gap-2 text-xs text-destructive">
                                    <div className="flex items-center gap-1.5 font-medium">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        <span>Installation error</span>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground text-center break-words max-w-xs">{errorMsg}</span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleInstall}
                                        className="h-6 text-xs gap-1 mt-1"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Retry
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* Tab 2: Mozilla Firefox */}
                    <TabsContent value="firefox" className="p-5 space-y-3 m-0">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Firefox uses its own certificate store. Follow these steps to import the certificate:
                        </p>

                        <div className="space-y-2 text-xs">
                            {/* Step 1 */}
                            <div className="p-2.5 rounded-md border border-border/50 bg-muted/20 flex items-start gap-2.5">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[11px] border border-primary/20">
                                    1
                                </span>
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                    <span className="text-foreground font-medium">Export CA Certificate</span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleExportCaCert}
                                            className="h-6 text-[11px] gap-1 px-2 border-border/60 bg-background"
                                        >
                                            <Download className="w-3 h-3 text-primary" />
                                            Download .pem
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleCopyCaPath}
                                            className="h-6 text-[11px] gap-1 px-2 text-muted-foreground hover:text-foreground"
                                        >
                                            {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                            {copiedPath ? "Copied" : "Copy Path"}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Step 2 */}
                            <div className="p-2.5 rounded-md border border-border/50 bg-muted/20 flex items-start gap-2.5">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[11px] border border-primary/20">
                                    2
                                </span>
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                    <span className="text-foreground font-medium">Open Firefox Certificate Manager</span>
                                    <p className="text-[11px] text-muted-foreground">
                                        Go to <strong>Settings</strong> &rarr; <strong>Privacy & Security</strong> &rarr; <strong>View Certificates...</strong>
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                        <code className="text-[10.5px] font-mono bg-muted/60 px-1.5 py-0.5 rounded text-primary border border-border/40 select-all">
                                            about:preferences#privacy
                                        </code>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleCopyPref}
                                            className="h-5 px-1.5 text-[10.5px] gap-1 text-muted-foreground hover:text-foreground"
                                        >
                                            {copiedPref ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                                            {copiedPref ? "Copied" : "Copy"}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Step 3 */}
                            <div className="p-2.5 rounded-md border border-border/50 bg-muted/20 flex items-start gap-2.5">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[11px] border border-primary/20">
                                    3
                                </span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-foreground font-medium">Import into Authorities</span>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Under the <strong>Authorities</strong> tab, click <strong>Import...</strong>
                                    </p>
                                </div>
                            </div>

                            {/* Step 4 */}
                            <div className="p-2.5 rounded-md border border-border/50 bg-muted/20 flex items-start gap-2.5">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[11px] border border-primary/20">
                                    4
                                </span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-foreground font-medium">Trust for Websites</span>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Select the file, check <strong>&quot;Trust this CA to identify websites&quot;</strong>, and click <strong>OK</strong>.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                {/* Footer */}
                <DialogFooter className="px-5 py-3 border-t border-border/40 bg-muted/10 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-1.5">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleExportCaCert}
                            className="h-7 text-xs gap-1 border-border/60"
                        >
                            <Download className="w-3 h-3 text-muted-foreground" />
                            <span>Export .pem</span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopyCaPath}
                            className="h-7 text-xs gap-1 border-border/60"
                        >
                            <Copy className="w-3 h-3 text-muted-foreground" />
                            <span>Copy Path</span>
                        </Button>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        className="h-7 text-xs"
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default InstallCertificateDialog