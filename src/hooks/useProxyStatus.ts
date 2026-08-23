import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { ProxyStatus } from "@/types/proxySettings.type"

export function useProxyStatus() {
    const [status, setStatus] = useState<ProxyStatus>({
        isRunning: false,
        boundAddress: null,
        requestedAddress: "127.0.0.1:8080",
        fallbackApplied: false,
        lastError: null,
    })
    const [isLoading, setIsLoading] = useState<boolean>(true)

    useEffect(() => {
        let isMounted = true

        invoke<ProxyStatus>("get_proxy_status")
            .then((liveStatus) => {
                if (isMounted && liveStatus) {
                    setStatus(liveStatus)
                }
            })
            .catch((err) => {
                console.error("Failed to load proxy status:", err)
            })
            .finally(() => {
                if (isMounted) setIsLoading(false)
            })

        const unlistenPromise = listen<ProxyStatus>("proxy-status-changed", (event) => {
            if (isMounted && event.payload) {
                setStatus(event.payload)
            }
        })

        return () => {
            isMounted = false
            unlistenPromise.then((unlisten) => unlisten())
        }
    }, [])

    return { status, isLoading, setStatus }
}
