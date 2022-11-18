import { createSelector } from '@reduxjs/toolkit';
import { wei } from '@synthetixio/wei';

import { FuturesPosition } from 'queries/futures/types';
import { PositionSide } from 'sections/futures/types';
import { selectExchangeRates } from 'state/exchange/selectors';
import { accountType, deserializeWeiObject } from 'state/helpers';
import { RootState } from 'state/store';
import { newGetExchangeRatesForCurrencies } from 'utils/currencies';
import { zeroBN } from 'utils/formatters/number';
import { MarketKeyByAsset, unserializeFundingRates, unserializeMarkets } from 'utils/futures';

import { FundingRate } from './types';

export const selectMarketKey = createSelector(
	(state: RootState) => state.futures[accountType(state.futures.selectedType)].marketAsset,
	(marketAsset) => MarketKeyByAsset[marketAsset]
);

export const selectMarketAsset = (state: RootState) => {
	return state.futures.selectedType === 'cross_margin'
		? state.futures.crossMargin.marketAsset
		: state.futures.isolatedMargin.marketAsset;
};

export const selectMarketRate = createSelector(
	selectMarketKey,
	selectExchangeRates,
	(marketKey, exchangeRates) => newGetExchangeRatesForCurrencies(exchangeRates, marketKey, 'sUSD')
);

export const selectMarkets = (state: RootState) => unserializeMarkets(state.futures.markets);

export const selectMarketsQueryStatus = (state: RootState) => state.futures.marketsQueryStatus;

export const selectMarketKeys = (state: RootState) =>
	state.futures.markets.map(({ asset }) => {
		return MarketKeyByAsset[asset];
	});

export const selectMarketAssets = (state: RootState) =>
	state.futures.markets.map(({ asset }) => asset);

export const selectAverageFundingRates = (state: RootState) =>
	unserializeFundingRates(state.futures.fundingRates);

export const selectFundingRate = createSelector(
	selectMarketKey,
	selectAverageFundingRates,
	(marketKey, fundingRates) => {
		return fundingRates.find((fundingRate: FundingRate) => fundingRate.asset === marketKey);
	}
);

export const selectMarketInfo = createSelector(
	selectMarkets,
	selectMarketAsset,
	(markets, selectedMarket) => {
		return markets.find((market) => market.asset === selectedMarket);
	}
);
export const selectMarketAssetRate = createSelector(
	(state: RootState) => state.futures[accountType(state.futures.selectedType)].marketAsset,
	selectExchangeRates,
	(marketAsset, exchangeRates) => {
		return newGetExchangeRatesForCurrencies(exchangeRates, marketAsset, 'sUSD');
	}
);

const positionKeys = new Set([
	'remainingMargin',
	'accessibleMargin',
	'order.fee',
	'order.leverage',
	'position.notionalValue',
	'position.accruedFunding',
	'position.initialMargin',
	'position.profitLoss',
	'position.lastPrice',
	'position.size',
	'position.liquidationPrice',
	'position.initialLeverage',
	'position.leverage',
	'position.pnl',
	'position.pnlPct',
	'position.marginRatio',
]);

export const selectIsMarketCapReached = createSelector(
	(state: RootState) => state.futures[accountType(state.futures.selectedType)].leverageSide,
	selectMarketInfo,
	selectMarketAssetRate,
	(leverageSide, marketInfo, marketAssetRate) => {
		const maxMarketValueUSD = marketInfo?.marketLimit ?? wei(0);
		const marketSize = marketInfo?.marketSize ?? wei(0);
		const marketSkew = marketInfo?.marketSkew ?? wei(0);

		return leverageSide === PositionSide.LONG
			? marketSize.add(marketSkew).div('2').abs().mul(marketAssetRate).gte(maxMarketValueUSD)
			: marketSize.sub(marketSkew).div('2').abs().mul(marketAssetRate).gte(maxMarketValueUSD);
	}
);

export const selectPosition = createSelector(
	(state: RootState) => state.futures[accountType(state.futures.selectedType)].position,
	(position) => {
		return position ? (deserializeWeiObject(position, positionKeys) as FuturesPosition) : undefined;
	}
);

export const selectPlaceOrderTranslationKey = createSelector(
	selectPosition,
	(state: RootState) => state.futures[accountType(state.futures.selectedType)].orderType,
	(state: RootState) => state.futures.selectedType,
	(state: RootState) => state.futures.crossMargin.accountOverview,
	selectIsMarketCapReached,
	(position, orderType, selectedType, { freeMargin }, isMarketCapReached) => {
		let remainingMargin;
		if (selectedType === 'isolated_margin') {
			remainingMargin = position?.remainingMargin || zeroBN;
		} else {
			const positionMargin = position?.remainingMargin || zeroBN;
			remainingMargin = positionMargin.add(freeMargin);
		}

		if (orderType === 'next price') return 'futures.market.trade.button.place-next-price-order';
		if (orderType === 'limit') return 'futures.market.trade.button.place-limit-order';
		if (orderType === 'stop market') return 'futures.market.trade.button.place-stop-order';
		if (!!position?.position) return 'futures.market.trade.button.modify-position';
		return remainingMargin.lt('50')
			? 'futures.market.trade.button.deposit-margin-minimum'
			: isMarketCapReached
			? 'futures.market.trade.button.oi-caps-reached'
			: 'futures.market.trade.button.open-position';
	}
);
