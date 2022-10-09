import { FC, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from 'state/store';

import { useExchangeContext } from 'contexts/ExchangeContext';

import MobileCurrencyCard from '../TradeCard/CurrencyCard/MobileCurrencyCard';

const MobileBaseCurrencyCard: FC = memo(() => {
	const { t } = useTranslation();

	const { setOpenModal, onBaseCurrencyAmountChange, onBaseBalanceClick } = useExchangeContext();

	const { baseCurrencyKey, baseAmount, baseBalance, basePriceRate, txProvider } = useAppSelector(
		({ exchange }) => ({
			baseCurrencyKey: exchange.baseCurrencyKey,
			baseAmount: exchange.baseAmount,
			baseBalance: exchange.baseBalance,
			basePriceRate: exchange.basePriceRate,
			txProvider: exchange.txProvider,
		})
	);

	const openBaseModal = useCallback(() => setOpenModal('base-select'), [setOpenModal]);

	return (
		<MobileCurrencyCard
			currencyKey={baseCurrencyKey}
			disabled={txProvider !== 'synthetix'}
			amount={baseAmount}
			onAmountChange={onBaseCurrencyAmountChange}
			walletBalance={baseBalance}
			onBalanceClick={onBaseBalanceClick}
			onCurrencySelect={openBaseModal}
			priceRate={basePriceRate}
			label={t('exchange.common.into')}
		/>
	);
});

export default MobileBaseCurrencyCard;
