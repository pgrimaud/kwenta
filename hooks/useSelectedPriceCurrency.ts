import useSynthetixQueries from '@synthetixio/queries';
import Wei from '@synthetixio/wei';
import { useRecoilValue } from 'recoil';

import { priceCurrencyState } from 'store/app';

const useSelectedPriceCurrency = () => {
	const { useExchangeRatesQuery } = useSynthetixQueries();

	const selectedPriceCurrency = useRecoilValue(priceCurrencyState);
	const exchangeRatesQuery = useExchangeRatesQuery();
	const exchangeRates = exchangeRatesQuery.data ?? null;
	const selectPriceCurrencyRate = exchangeRates?.[selectedPriceCurrency.name];

	const getPriceAtCurrentRate = (price: Wei) => price.div(selectPriceCurrencyRate ?? 1);

	return {
		selectPriceCurrencyRate,
		selectedPriceCurrency,
		getPriceAtCurrentRate,
	};
};

export default useSelectedPriceCurrency;
