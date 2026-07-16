import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Monitor, CheckCircle2, HelpCircle, Loader2, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"

type InstallStatus = "idle" | "installing" | "installed" | "error" | "loading"

const InstallCertificateDialog = ({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) => {
    // const [open, setOpen] = useState<boolean>(false)
    const [status, setStatus] = useState<InstallStatus>("installed")
    const [errorMsg, setErrorMsg] = useState<string>("")

    useEffect(() => {
        invoke("check_cert_installed")
            .then((result) => {
                const installed = result as boolean
                setStatus(installed ? "installed" : "idle");
            })
            .catch((err) => {
                setStatus("error")
                setErrorMsg(String(err))
            })
    }, [])


    const handleInstall = async () => {
        setStatus("installing")
        setErrorMsg("")
        try {
            await invoke("install_cert")
            setStatus("installed")
        } catch (err) {
            setStatus("error")
            setErrorMsg(String(err))
        }
    }

    const handleOpenCertManager = () => {
        // certmgr.msc opens the current-user cert store on Windows
        invoke("open_cert_manager").catch((err) => console.error(err))
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader className="flex-row items-center gap-2 space-y-0 pb-3 border-b">
                    <Monitor className="size-6" />
                    <DialogTitle className="text-xl">Windows Setup Guide</DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="automatic">
                    <TabsList className="grid grid-cols-2 w-fit mx-auto">
                        <TabsTrigger value="automatic">Automatic</TabsTrigger>
                        <TabsTrigger value="manual">Manual</TabsTrigger>
                    </TabsList>

                    <TabsContent value="automatic">
                        <div className="rounded-lg bg-muted/50 p-6 flex flex-col items-center gap-4 text-center">
                            <h3 className="font-semibold">
                                Install and Trust Aresius CA Certificate in Windows Trust Store
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-sm">
                                By installing and trusting the Aresius CA Certificate,
                                Aresius can decrypt encrypted traffic on the fly and let
                                you see raw HTTPS requests and responses.
                            </p>
                            {status === "loading" && (
                                <Button disabled>
                                    <Loader2 className="animate-spin" /> Checking certificate...
                                </Button>
                            )}

                            {status === "idle" && (
                                <Button onClick={handleInstall}>
                                    Install & Trust Certificate
                                </Button>
                            )}

                            {status === "installing" && (
                                <Button disabled>
                                    <Loader2 className="animate-spin" /> Installing...
                                </Button>
                            )}

                            {status === "installed" && (
                                <Button variant="outline" className="pointer-events-none">
                                    <CheckCircle2 className="text-green-600" /> Installed & Trusted
                                </Button>
                            )}

                            {status === "installed" && (
                                <p className="text-xs text-muted-foreground">
                                    AresProxy CA certificate is installed & trusted
                                </p>
                            )}

                            {status === "error" && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                    <XCircle className="size-4 shrink-0" />
                                    <span>{errorMsg}</span>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="manual">
                        <div className="rounded-lg bg-muted/50 p-6 flex flex-col gap-3 text-sm">
                            <p>
                                Open <span className="font-mono">certmgr.msc</span>, then
                                import the certificate manually into{" "}
                                <span className="font-medium">
                                    Trusted Root Certification Authorities → Certificates
                                </span>.
                            </p>
                            <Button variant="outline" onClick={handleOpenCertManager} className="w-fit">
                                Open Certificate Manager
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter className="flex-row items-center justify-between border-t pt-3 sm:justify-between">
                    <Button variant="outline" onClick={handleOpenCertManager}>
                        Manage Certificates
                    </Button>

                    <div className="flex items-center gap-3">
                        {status === "installed" && (
                            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                                <CheckCircle2 className="size-4" /> Certificate is ready!
                            </span>
                        )}
                        <HelpCircle className="size-4 text-muted-foreground" />
                        <DialogClose asChild>
                            <Button variant="ghost" size="icon">✕</Button>
                        </DialogClose>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default InstallCertificateDialog