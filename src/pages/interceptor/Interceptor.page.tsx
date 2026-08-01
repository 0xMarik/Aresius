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

    // useEffect(() => {
    //     interceptor.map(async (itm) => {
    //         await invoke('resolve_intercept', {
    //             decision: {
    //                 id: itm.id,
    //                 action: 'forward',
    //                 modified_request: null
    //             }
    //         });
    //         dispatch(removeInterceptedRequest({ id: itm.id }))
    //     })
    // }, [interceptor])

    return (
        <div>
            {
                interceptor.map((itm, idx) => (
                    <div key={"intercept-" + idx}>
                        <p>{itm.host}</p>
                        <button onClick={() => handleClick(itm.id)}>Button</button>
                    </div>

                ))
            }
        </div>
    )
}

export default Interceptor
