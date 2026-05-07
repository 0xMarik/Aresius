import { createSlice, PayloadAction,} from "@reduxjs/toolkit"

interface Interceptor {
    id: string;
    host: string;
    request: string;
    timestamp: number;
    is_https: boolean;
}

const initialState : {interceptor : Interceptor[]} = {
    interceptor : []
}

const interceptorSlice = createSlice({
  name: 'interceptor',
  initialState,
  reducers: {
    addInterceptedRequest : (state, action: PayloadAction<{interceptedRequest: Interceptor}>) => {
        const {interceptedRequest} = action.payload;
        state.interceptor = [...state.interceptor, interceptedRequest];
    },
    removeInterceptedRequest : (state, action: PayloadAction<{ id : string}>) => {
      const {id} = action.payload;
      state.interceptor = state.interceptor.filter((item) => item.id !== id);
    }
  }
});

export const {addInterceptedRequest, removeInterceptedRequest} = interceptorSlice.actions;

export default interceptorSlice.reducer;
