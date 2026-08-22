import React, { useState, useRef } from "react"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
    FileKey,
    Upload,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Eye,
    EyeOff,
    Check,
} from "lucide-react"

interface CustomCertInfo {
    subject: string
    issuer: string
    notBefore: string
    notAfter: string
    serial: string
    isCa: boolean
    keyAlgorithm: string
}

interface AddCustomCertDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
}

type CertFormat = "pem" | "p12"
type PemInputMode = "file" | "paste"

export const AddCustomCertDialog: React.FC<AddCustomCertDialogProps> = ({
    open,
    onOpenChange,
    onSuccess,
}) => {
    const [format, setFormat] = useState<CertFormat>("pem")
    const [pemMode, setPemMode] = useState<PemInputMode>("file")

    // PEM state
    const [certPem, setCertPem] = useState<string>("")
    const [certFileName, setCertFileName] = useState<string>("")
    const [keyPem, setKeyPem] = useState<string>("")
    const [keyFileName, setKeyFileName] = useState<string>("")

    // P12 state
    const [p12Base64, setP12Base64] = useState<string>("")
    const [p12FileName, setP12FileName] = useState<string>("")
    const [p12Password, setP12Password] = useState<string>("")
    const [showPassword, setShowPassword] = useState<boolean>(false)

    // Form status
    const [loading, setLoading] = useState<boolean>(false)
    const [errorMsg, setErrorMsg] = useState<string>("")
    const [successInfo, setSuccessInfo] = useState<CustomCertInfo | null>(null)

    // File input refs
    const certFileInputRef = useRef<HTMLInputElement>(null)
    const keyFileInputRef = useRef<HTMLInputElement>(null)
    const p12FileInputRef = useRef<HTMLInputElement>(null)

    const resetForm = () => {
        setCertPem("")
        setCertFileName("")
        setKeyPem("")
        setKeyFileName("")
        setP12Base64("")
        setP12FileName("")
        setP12Password("")
        setErrorMsg("")
        setSuccessInfo(null)
        setLoading(false)
    }

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            resetForm()
        }
        onOpenChange(isOpen)
    }

    // PEM Certificate File Loader
    const handleCertFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setCertFileName(file.name)
        const reader = new FileReader()
        reader.onload = () => {
            setCertPem((reader.result as string) || "")
            setErrorMsg("")
        }
        reader.readAsText(file)
    }

    // PEM Key File Loader
    const handleKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setKeyFileName(file.name)
        const reader = new FileReader()
        reader.onload = () => {
            setKeyPem((reader.result as string) || "")
            setErrorMsg("")
        }
        reader.readAsText(file)
    }

    // P12 / PFX File Loader
    const handleP12FileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setP12FileName(file.name)
        const reader = new FileReader()
        reader.onload = () => {
            const buffer = reader.result as ArrayBuffer
            let binary = ""
            const bytes = new Uint8Array(buffer)
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i])
            }
            setP12Base64(window.btoa(binary))
            setErrorMsg("")
        }
        reader.readAsArrayBuffer(file)
    }

    const handleValidateAndImport = async () => {
        setErrorMsg("")
        setSuccessInfo(null)
        setLoading(true)

        try {
            let result: CustomCertInfo
            if (format === "pem") {
                if (!certPem.trim()) {
                    throw new Error("Please select or paste the Certificate (.pem / .crt) file.")
                }
                if (!keyPem.trim()) {
                    throw new Error("Please select or paste the Private Key (.key / .pem) file.")
                }
                result = await invoke<CustomCertInfo>("import_custom_cert_pem", {
                    certPem: certPem.trim(),
                    keyPem: keyPem.trim(),
                })
            } else {
                if (!p12Base64) {
                    throw new Error("Please select a PKCS#12 (.p12 / .pfx) archive file.")
                }
                result = await invoke<CustomCertInfo>("import_custom_cert_p12", {
                    p12Base64,
                    password: p12Password,
                })
            }

            setSuccessInfo(result)
            toast.success("Custom Certificate successfully validated and activated as Root CA")
            onSuccess?.()
        } catch (err: unknown) {
            const message = typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to import custom certificate"
            setErrorMsg(message)
            toast.error(message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden border-border/80 shadow-2xl bg-card">
                {/* Header */}
                <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/20">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                            <FileKey className="w-4 h-4" />
                        </div>
                        <DialogTitle className="text-sm font-semibold">
                            Add a Custom Certificate
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground mt-1">
                        Import your own custom Root CA certificate and private key to intercept HTTPS traffic.
                    </DialogDescription>
                </DialogHeader>

                {/* Content */}
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Success Banner */}
                    {successInfo ? (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
                            <div className="flex items-start gap-2.5">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                <div className="text-xs">
                                    <span className="font-semibold text-emerald-400">
                                        Certificate Verified & Active
                                    </span>
                                    <p className="text-muted-foreground text-[11.5px] mt-0.5">
                                        The custom Root CA has been verified for Basic Constraints (<code className="text-emerald-400 font-mono">is_ca = true</code>), key pair compatibility, and applied to the proxy engine.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded border border-border/60 bg-background/70 p-3 space-y-1.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground font-medium">Subject:</span>
                                    <span className="text-foreground font-mono text-[11px] truncate max-w-[280px]" title={successInfo.subject}>
                                        {successInfo.subject}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground font-medium">Issuer:</span>
                                    <span className="text-foreground font-mono text-[11px] truncate max-w-[280px]" title={successInfo.issuer}>
                                        {successInfo.issuer}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground font-medium">Valid Until:</span>
                                    <span className="text-foreground text-[11px]">
                                        {successInfo.notAfter}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground font-medium">Serial:</span>
                                    <span className="text-foreground font-mono text-[10.5px]">
                                        {successInfo.serial || "N/A"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Format Selector Dropdown */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">
                                    Certificate Format
                                </label>
                                <Select
                                    value={format}
                                    onValueChange={(val: CertFormat) => {
                                        setFormat(val)
                                        setErrorMsg("")
                                    }}
                                >
                                    <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue placeholder="Select certificate format" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pem" className="text-xs">
                                            PEM Format (.pem, .crt, .key)
                                        </SelectItem>
                                        <SelectItem value="p12" className="text-xs">
                                            PKCS#12 / PFX Format (.p12, .pfx)
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Format 1: PEM Format */}
                            {format === "pem" && (
                                <div className="space-y-3.5">
                                    {/* Mode switcher (File Upload vs Paste) */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">Input method:</span>
                                        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded border border-border/40">
                                            <button
                                                type="button"
                                                onClick={() => setPemMode("file")}
                                                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                                    pemMode === "file"
                                                        ? "bg-background text-foreground shadow-xs font-medium"
                                                        : "text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                Upload Files
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPemMode("paste")}
                                                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                                    pemMode === "paste"
                                                        ? "bg-background text-foreground shadow-xs font-medium"
                                                        : "text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                Paste Text
                                            </button>
                                        </div>
                                    </div>

                                    {pemMode === "file" ? (
                                        <div className="space-y-3">
                                            {/* Certificate File Picker */}
                                            <div className="p-3 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-xs font-medium text-foreground block">
                                                        CA Certificate (.pem / .crt)
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                                                        {certFileName || "No file selected"}
                                                    </span>
                                                </div>
                                                <input
                                                    type="file"
                                                    ref={certFileInputRef}
                                                    onChange={handleCertFileSelect}
                                                    accept=".pem,.crt,.cer,.txt"
                                                    className="hidden"
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => certFileInputRef.current?.click()}
                                                    className="h-7 text-xs gap-1.5 border-border/60 bg-background"
                                                >
                                                    <Upload className="w-3 h-3 text-primary" />
                                                    {certFileName ? "Change" : "Choose File"}
                                                </Button>
                                            </div>

                                            {/* Key File Picker */}
                                            <div className="p-3 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-xs font-medium text-foreground block">
                                                        Private Key (.key / .pem)
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                                                        {keyFileName || "No file selected"}
                                                    </span>
                                                </div>
                                                <input
                                                    type="file"
                                                    ref={keyFileInputRef}
                                                    onChange={handleKeyFileSelect}
                                                    accept=".key,.pem,.txt"
                                                    className="hidden"
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => keyFileInputRef.current?.click()}
                                                    className="h-7 text-xs gap-1.5 border-border/60 bg-background"
                                                >
                                                    <Upload className="w-3 h-3 text-primary" />
                                                    {keyFileName ? "Change" : "Choose File"}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-foreground">
                                                    Certificate (PEM)
                                                </label>
                                                <Textarea
                                                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                                                    value={certPem}
                                                    onChange={(e) => setCertPem(e.target.value)}
                                                    rows={4}
                                                    className="text-[11px] font-mono resize-none bg-background"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <label className="text-xs font-medium text-foreground">
                                                    Private Key (PEM)
                                                </label>
                                                <Textarea
                                                    placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                                                    value={keyPem}
                                                    onChange={(e) => setKeyPem(e.target.value)}
                                                    rows={4}
                                                    className="text-[11px] font-mono resize-none bg-background"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Format 2: PKCS#12 Format */}
                            {format === "p12" && (
                                <div className="space-y-3.5">
                                    <div className="p-3 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs font-medium text-foreground block">
                                                PKCS#12 / PFX File (.p12 / .pfx)
                                            </span>
                                            <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                                                {p12FileName || "No archive file selected"}
                                            </span>
                                        </div>
                                        <input
                                            type="file"
                                            ref={p12FileInputRef}
                                            onChange={handleP12FileSelect}
                                            accept=".p12,.pfx"
                                            className="hidden"
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => p12FileInputRef.current?.click()}
                                            className="h-7 text-xs gap-1.5 border-border/60 bg-background"
                                        >
                                            <Upload className="w-3 h-3 text-primary" />
                                            {p12FileName ? "Change" : "Choose File"}
                                        </Button>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-foreground">
                                            Password / Passphrase
                                        </label>
                                        <div className="relative">
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                placeholder="Enter password (leave blank if unencrypted)"
                                                value={p12Password}
                                                onChange={(e) => setP12Password(e.target.value)}
                                                className="h-8 text-xs pr-8 bg-background"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="w-3.5 h-3.5" />
                                                ) : (
                                                    <Eye className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Error Alert */}
                            {errorMsg && (
                                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 flex items-start gap-2.5 text-xs text-destructive">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <div className="flex-1 break-words">
                                        <span className="font-semibold block">Validation Error</span>
                                        <span className="text-[11px] text-muted-foreground mt-0.5 block">
                                            {errorMsg}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Notice Info */}
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                <strong>Note:</strong> The custom certificate will be verified for CA flags and key pair matching. Once applied, previous CA certificates are discarded and proxy TLS caches are refreshed.
                            </p>
                        </>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="px-5 py-3 border-t border-border/40 bg-muted/10 flex items-center justify-between shrink-0">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenChange(false)}
                        disabled={loading}
                        className="h-7 text-xs"
                    >
                        {successInfo ? "Close" : "Cancel"}
                    </Button>

                    {!successInfo ? (
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleValidateAndImport}
                            disabled={loading}
                            className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                        >
                            {loading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Check className="w-3.5 h-3.5" />
                            )}
                            {loading ? "Verifying..." : "Validate & Apply"}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            variant="default"
                            onClick={() => handleOpenChange(false)}
                            className="h-7 text-xs"
                        >
                            Done
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default AddCustomCertDialog
