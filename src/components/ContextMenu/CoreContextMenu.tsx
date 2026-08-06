import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu"

const CoreContextMenu = ({ children, renderContextMenu, triggerClassName }: { children: React.ReactNode, renderContextMenu: () => React.ReactNode, triggerClassName?: string }) => {
    return (
        <ContextMenu >
            <ContextMenuTrigger className={triggerClassName} >{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {renderContextMenu()}
            </ContextMenuContent>
        </ContextMenu>
    )
}

export default CoreContextMenu
