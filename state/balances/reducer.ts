import { createSlice } from '@reduxjs/toolkit';

import { fetchSynthBalances } from './actions';

enum FetchStatus {
	Idle,
	Loading,
	Success,
	Error,
}

type BalancesState = {
	status: FetchStatus;
	error: string | undefined;
	balances: any[];
	totalUSDBalance?: string;
};

const initialState: BalancesState = {
	status: FetchStatus.Idle,
	balances: [],
	totalUSDBalance: undefined,
	error: undefined,
};

const balancesSlice = createSlice({
	name: 'balances',
	initialState,
	reducers: {
		setBalances: (state, action) => {
			state.balances = action.payload.balances;
			state.totalUSDBalance = action.payload.totalUSDBalance;
		},
	},
	extraReducers: (builder) => {
		builder.addCase(fetchSynthBalances.fulfilled, (state, action) => {
			state.balances = action.payload.balances;
			state.totalUSDBalance = action.payload.totalUSDBalance;
		});
	},
});

export const { setBalances } = balancesSlice.actions;

export default balancesSlice.reducer;
