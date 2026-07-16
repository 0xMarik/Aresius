import { useAppSelector } from "@/hooks/redux"
import { removeInterceptedRequest } from "@/store/slices/interceptorSlice";
import { invoke } from "@tauri-apps/api/core";
import { useDispatch } from "react-redux";

const Interceptor = () => {

    const { interceptor } = useAppSelector(state => state.interceptor)
    const dispatch = useDispatch();

    const handleClick = async (id: string) => {
        await invoke('resolve_intercept', {
            decision: {
                id: id,
                action: 'forward',
                modified_request: null
            }
        });
        dispatch(removeInterceptedRequest({ id }))
    }

    return (
        <div>
            {
                interceptor.map((itm) => (
                    <div>
                        <p>{itm.host}</p>
                        <button onClick={() => handleClick(itm.id)}>Button</button>
                    </div>

                ))
            }
        </div>
    )
}

export default Interceptor
