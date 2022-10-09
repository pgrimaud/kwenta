import { FC, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from 'state/store';

import { useExchangeContext } from 'contexts/ExchangeContext';

import MobileCurrencyCard from '../TradeCard/CurrencyCard/MobileCurrencyCard';

const MobileQuoteCurrencyCard: FC = memo(() => {
	const { t } = useTranslation();

	const { setOpenModal, onQuoteCurrencyAmountChange, onQuoteBalanceClick } = useExchangeContext();

	const { quoteCurrencyKey, quoteAmount, quoteBalance, quotePriceRate } = useAppSelector(
		({ exchange }) => ({
			quoteCurrencyKey: exchange.quoteCurrencyKey,
			quoteAmount: exchange.quoteAmount,
			quoteBalance: exchange.quoteBalance,
			quotePriceRate: exchange.quotePriceRate,
		})
	);

	const openQuoteModal = useCallback(() => setOpenModal('quote-select'), [setOpenModal]);

	return (
		<MobileCurrencyCard
			currencyKey={quoteCurrencyKey}
			amount={quoteAmount}
			onAmountChange={onQuoteCurrencyAmountChange}
			walletBalance={quoteBalance}
			onBalanceClick={onQuoteBalanceClick}
			onCurrencySelect={openQuoteModal}
			priceRate={quotePriceRate}
			label={t('exchange.common.from')}
		/>
	);
});

export default MobileQuoteCurrencyCard;
