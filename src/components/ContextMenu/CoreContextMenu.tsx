import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu"

const CoreContextMenu = ({ children, renderContextMenu }: { children: React.ReactNode, renderContextMenu: () => React.ReactNode }) => {
    return (
        <ContextMenu >
            <ContextMenuTrigger >{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {renderContextMenu()}
            </ContextMenuContent>
        </ContextMenu>
    )
}

export default CoreContextMenu
