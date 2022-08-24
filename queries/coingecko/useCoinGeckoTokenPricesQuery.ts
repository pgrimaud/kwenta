import axios from 'axios';
import { UseQueryOptions, useQuery } from 'react-query';
import { chain, useNetwork } from 'wagmi';

import QUERY_KEYS from 'constants/queryKeys';

import { CG_BASE_API_URL } from './constants';
import { PriceResponse } from './types';

const useCoinGeckoTokenPricesQuery = (
	tokenAddresses: string[],
	options?: UseQueryOptions<PriceResponse>
) => {
	const { chain: network } = useNetwork();
	const isL2 =
		network !== undefined
			? [chain.optimism.id, chain.optimismGoerli.id].includes(network?.id)
			: true;

	const platform = isL2 ? 'optimistic-ethereum' : 'ethereum';
	return useQuery<PriceResponse>(
		QUERY_KEYS.CoinGecko.TokenPrices(tokenAddresses, platform),
		async () => {
			const response = await axios.get<PriceResponse>(
				`${CG_BASE_API_URL}/simple/token_price/${platform}?contract_addresses=${tokenAddresses.join(
					','
				)}&vs_currencies=usd`
			);
			return response.data;
		},
		{
			enabled: tokenAddresses.length > 0,
			...options,
		}
	);
};

export default useCoinGeckoTokenPricesQuery;
