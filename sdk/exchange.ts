//@ts-ignore TODO: remove once types are added
import getFormattedSwapData from '@kwenta/synthswap';
import { CurrencyKey, NetworkId } from '@synthetixio/contracts-interface';
import { DeprecatedSynthBalance, TokenBalances } from '@synthetixio/queries';
import Wei, { wei } from '@synthetixio/wei';
import axios from 'axios';
import { Provider as EthCallProvider, Contract as EthCallContract } from 'ethcall';
import { ethers, Signer } from 'ethers';
import { get, keyBy } from 'lodash';

import { KWENTA_REFERRAL_ADDRESS, SYNTH_SWAP_OPTIMISM_ADDRESS } from 'constants/address';
import {
	ATOMIC_EXCHANGES_L1,
	CRYPTO_CURRENCY_MAP,
	ETH_ADDRESS,
	ETH_COINGECKO_ADDRESS,
} from 'constants/currency';
import {
	OneInchApproveSpenderResponse,
	OneInchQuoteResponse,
	OneInchSwapResponse,
} from 'containers/Convert/Convert';
import erc20Abi from 'lib/abis/ERC20.json';
import synthSwapAbi from 'lib/abis/SynthSwap.json';
import { CG_BASE_API_URL } from 'queries/coingecko/constants';
import { PriceResponse } from 'queries/coingecko/types';
import { KWENTA_TRACKING_CODE } from 'queries/futures/constants';
import { Rates } from 'queries/rates/types';
import { getProxySynthSymbol } from 'queries/synths/utils';
import { OneInchTokenListResponse, Token } from 'queries/tokenLists/types';
import {
	getExchangeRatesForCurrencies,
	newGetCoinGeckoPricesForCurrencies,
	newGetExchangeRatesForCurrencies,
	newGetExchangeRatesTupleForCurrencies,
} from 'utils/currencies';
import { zeroBN } from 'utils/formatters/number';
import { FuturesMarketKey, MarketAssetByKey } from 'utils/futures';

import { getSynthBalances } from './common/balances';
import type { ContractMap } from './contracts';
import SynthRedeemerABI from './contracts/abis/SynthRedeemer.json';
import { getSynthsForNetwork, SynthsMap, SynthSymbol } from './data/synths';

type CurrencyRate = ethers.BigNumberish;
type SynthRatesTuple = [string[], CurrencyRate[]];

const PROTOCOLS =
	'OPTIMISM_UNISWAP_V3,OPTIMISM_SYNTHETIX,OPTIMISM_SYNTHETIX_WRAPPER,OPTIMISM_ONE_INCH_LIMIT_ORDER,OPTIMISM_ONE_INCH_LIMIT_ORDER_V2,OPTIMISM_CURVE,OPTIMISM_BALANCER_V2,OPTIMISM_VELODROME,OPTIMISM_KYBERSWAP_ELASTIC';

const FILTERED_TOKENS = ['0x4922a015c4407f87432b179bb209e125432e4a2a'];

export default class ExchangeService {
	private networkId: NetworkId;
	private provider: ethers.providers.Provider;
	private signer: Signer;
	private contracts: ContractMap;
	private multicallProvider: EthCallProvider;
	private isL2: boolean;
	private synthsMap: SynthsMap = {};
	private tokensMap: any = {};
	private tokenList: Token[] = [];
	private allTokensMap: any;

	constructor(
		networkId: NetworkId,
		provider: ethers.providers.Provider,
		signer: Signer,
		contracts: ContractMap,
		multicallProvider: EthCallProvider
	) {
		this.networkId = networkId;
		this.signer = signer;
		this.provider = provider;
		this.isL2 = [10, 420].includes(networkId);
		this.contracts = contracts;
		this.multicallProvider = multicallProvider;
		this.getAllTokensMap();
	}

	private isCurrencyETH(currencyKey: string) {
		return currencyKey === CRYPTO_CURRENCY_MAP.ETH;
	}

	private getTokenAddress(currencyKey: string) {
		if (currencyKey != null) {
			if (this.isCurrencyETH(currencyKey)) {
				return ETH_ADDRESS;
			} else {
				return get(this.allTokensMap, [currencyKey, 'address'], null);
			}
		} else {
			return null;
		}
	}

	private async getCoingeckoPrices(tokenAddresses: string[]) {
		const platform = this.isL2 ? 'optimistic-ethereum' : 'ethereum';
		const response = await axios.get<PriceResponse>(
			`${CG_BASE_API_URL}/simple/token_price/${platform}?contract_addresses=${tokenAddresses
				.join(',')
				.replace(ETH_ADDRESS, ETH_COINGECKO_ADDRESS)}&vs_currencies=usd`
		);
		return response.data;
	}

	private async getSynthUsdRate(quoteCurrencyKey: string, baseCurrencyKey: string) {
		if (!quoteCurrencyKey || !baseCurrencyKey) return null;

		const exchangeRates = await this.getExchangeRates();
		const synth = this.tokensMap[quoteCurrencyKey] || this.tokensMap[baseCurrencyKey];

		if (synth) {
			return getExchangeRatesForCurrencies(exchangeRates, 'sUSD', synth.symbol);
		}

		return null;
	}

	private async getOneInchQuote(baseCurrencyKey: string, quoteCurrencyKey: string, amount: string) {
		const sUSD = this.tokensMap['sUSD'];
		const decimals = this.getTokenDecimals(quoteCurrencyKey);

		const quoteTokenAddress = this.getTokenAddress(quoteCurrencyKey);
		const baseTokenAddress = this.getTokenAddress(baseCurrencyKey);
		const txProvider = this.getTxProvider(baseCurrencyKey, quoteCurrencyKey);

		const synth = this.tokensMap[quoteCurrencyKey] || this.tokensMap[baseCurrencyKey];

		const synthUsdRate = synth ? await this.getPairRates(synth, 'sUSD') : null;

		if (!quoteCurrencyKey || !baseCurrencyKey || !sUSD || !amount.length || wei(amount).eq(0)) {
			return '';
		}

		if (txProvider === '1inch') {
			const estimatedAmount = await this.quoteOneInch(
				quoteTokenAddress,
				baseTokenAddress,
				amount,
				decimals
			);
			return estimatedAmount;
		}

		if (this.tokensMap[quoteCurrencyKey as SynthSymbol]) {
			const usdAmount = wei(amount).div(synthUsdRate);

			const estimatedAmount = await this.quoteOneInch(
				sUSD.address,
				baseTokenAddress,
				usdAmount.toString(),
				decimals
			);

			return estimatedAmount;
		} else {
			const estimatedAmount = await this.quoteOneInch(
				quoteTokenAddress,
				sUSD.address,
				amount,
				decimals
			);

			return wei(estimatedAmount).mul(synthUsdRate).toString();
		}
	}

	private getTxProvider(baseCurrencyKey: string, quoteCurrencyKey: string) {
		if (!baseCurrencyKey || !quoteCurrencyKey) return null;
		if (
			this.synthsMap?.[baseCurrencyKey as SynthSymbol] &&
			this.synthsMap?.[quoteCurrencyKey as SynthSymbol]
		)
			return 'synthetix';
		if (this.tokensMap[baseCurrencyKey] && this.tokensMap[quoteCurrencyKey]) return '1inch';

		return 'synthswap';
	}

	private getOneInchSlippage(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const txProvider = this.getTxProvider(baseCurrencyKey, quoteCurrencyKey);

		if (txProvider === '1inch' && (baseCurrencyKey === 'ETH' || quoteCurrencyKey === 'ETH')) {
			return 3;
		}

		return 1;
	}

	private getSelectedTokens(baseCurrencyKey: string, quoteCurrencyKey: string) {
		return this.tokenList.filter(
			(t) => t.symbol === baseCurrencyKey || t.symbol === quoteCurrencyKey
		);
	}

	private getExchangeParams(
		sourceCurrencyKey: string,
		destinationCurrencyKey: string,
		sourceAmount: Wei,
		minAmount: Wei,
		walletAddress: string
	) {
		const sourceAmountBN = sourceAmount.toBN();
		const minAmountBN = minAmount.toBN();
		const isAtomic = this.checkIsAtomic(sourceCurrencyKey, destinationCurrencyKey);

		if (isAtomic) {
			return [
				sourceCurrencyKey,
				sourceAmount,
				destinationCurrencyKey,
				KWENTA_TRACKING_CODE,
				minAmountBN,
			];
		} else {
			return [
				sourceCurrencyKey,
				sourceAmountBN,
				destinationCurrencyKey,
				walletAddress,
				KWENTA_TRACKING_CODE,
			];
		}
	}

	private async getQuotePriceRate(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const txProvider = this.getTxProvider(baseCurrencyKey, quoteCurrencyKey);
		const isQuoteCurrencyETH = this.isCurrencyETH(quoteCurrencyKey);

		const quoteCurrencyTokenAddress = (isQuoteCurrencyETH
			? ETH_COINGECKO_ADDRESS
			: this.getTokenAddress(quoteCurrencyKey)
		).toLowerCase();

		const baseCurrencyTokenAddress = this.getTokenAddress(baseCurrencyKey).toLowerCase();

		const coinGeckoPrices = await this.getCoingeckoPrices([
			quoteCurrencyTokenAddress,
			baseCurrencyTokenAddress,
		]);

		const exchangeRates = await this.getExchangeRates();

		if (txProvider !== 'synthetix' && !quoteCurrencyKey) {
			const selectPriceCurrencyRate = exchangeRates['sUSD'];

			if (
				coinGeckoPrices &&
				selectPriceCurrencyRate &&
				coinGeckoPrices[quoteCurrencyTokenAddress]
			) {
				const quotePrice = coinGeckoPrices[quoteCurrencyTokenAddress];

				return quotePrice ? quotePrice.usd / selectPriceCurrencyRate.toNumber() : wei(0);
			} else {
				return wei(0);
			}
		} else {
			return newGetExchangeRatesForCurrencies(exchangeRates, quoteCurrencyKey, 'sUSD');
		}
	}

	private async getBasePriceRate(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const txProvider = this.getTxProvider(baseCurrencyKey, quoteCurrencyKey);
		const isBaseCurrencyETH = this.isCurrencyETH(quoteCurrencyKey);

		const baseCurrencyTokenAddress = (isBaseCurrencyETH
			? ETH_COINGECKO_ADDRESS
			: this.getTokenAddress(baseCurrencyKey)
		).toLowerCase();

		const quoteCurrencyTokenAddress = this.getTokenAddress(baseCurrencyKey).toLowerCase();

		const coinGeckoPrices = await this.getCoingeckoPrices([
			quoteCurrencyTokenAddress,
			baseCurrencyTokenAddress,
		]);

		const exchangeRates = await this.getExchangeRates();

		if (txProvider !== 'synthetix' && !baseCurrencyKey) {
			const selectPriceCurrencyRate = exchangeRates['sUSD'];

			if (coinGeckoPrices && selectPriceCurrencyRate && coinGeckoPrices[baseCurrencyTokenAddress]) {
				const basePrice = coinGeckoPrices[baseCurrencyTokenAddress];
				return basePrice ? basePrice.usd / selectPriceCurrencyRate.toNumber() : wei(0);
			} else {
				return wei(0);
			}
		} else {
			return newGetExchangeRatesForCurrencies(exchangeRates, quoteCurrencyKey, 'sUSD');
		}
	}

	private async getAllTokensMap() {
		this.synthsMap = getSynthsForNetwork(this.networkId);
		const { tokensMap, tokens } = await this.getOneInchTokenList();

		this.tokensMap = tokensMap;
		this.tokenList = tokens;
		this.allTokensMap = { ...this.synthsMap, tokensMap };
	}

	private checkIsAtomic(baseCurrencyKey: string, quoteCurrencyKey: string) {
		if (this.isL2 || !baseCurrencyKey || !quoteCurrencyKey) {
			return false;
		}

		return [baseCurrencyKey, quoteCurrencyKey].every((currency) =>
			ATOMIC_EXCHANGES_L1.includes(currency)
		);
	}

	private checkNeedsApproval(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const txProvider = this.getTxProvider(baseCurrencyKey, quoteCurrencyKey);
		const isQuoteCurrencyETH = this.isCurrencyETH(quoteCurrencyKey);

		return (txProvider === '1inch' || txProvider === 'synthswap') && !isQuoteCurrencyETH;
	}

	private async getRedeemableDeprecatedSynths(walletAddress: string) {
		if (!this.contracts?.SynthRedeemer) {
			throw new Error('The SynthRedeemer contract does not exist on this network.');
		}

		const synthDeprecatedFilter = this.contracts.SynthRedeemer.filters.SynthDeprecated();
		const deprecatedSynthsEvents = await this.contracts.SynthRedeemer.queryFilter(
			synthDeprecatedFilter
		);
		const deprecatedProxySynthsAddresses: string[] =
			deprecatedSynthsEvents.map((e) => e.args?.synth).filter(Boolean) ?? [];

		const Redeemer = new EthCallContract(this.contracts.SynthRedeemer.address, SynthRedeemerABI);

		const symbolCalls = [];
		const balanceCalls = [];

		for (const addr of deprecatedProxySynthsAddresses) {
			symbolCalls.push(getProxySynthSymbol(addr));
			balanceCalls.push(Redeemer.balanceOf(addr, walletAddress));
		}

		const deprecatedSynths = (await this.multicallProvider.all(symbolCalls)) as CurrencyKey[];
		const balanceData = (await this.multicallProvider.all(balanceCalls)) as ethers.BigNumber[];
		const balances = balanceData.map((balance) => wei(balance));

		let totalUSDBalance = wei(0);
		const cryptoBalances: DeprecatedSynthBalance[] = [];

		for (let i = 0; i < balances.length; i++) {
			const usdBalance = balances[i];
			if (usdBalance.gt(0)) {
				const currencyKey = deprecatedSynths[i];
				totalUSDBalance = totalUSDBalance.add(usdBalance);
				cryptoBalances.push({
					currencyKey,
					proxyAddress: deprecatedProxySynthsAddresses[i],
					balance: wei(0),
					usdBalance,
				});
			}
		}

		return { balances: cryptoBalances, totalUSDBalance };
	}

	private getTokenDecimals(currencyKey: string) {
		return get(this.allTokensMap, [currencyKey, 'decimals'], undefined);
	}

	private async getQuoteCurrencyContract(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const needsApproval = this.checkNeedsApproval(baseCurrencyKey, quoteCurrencyKey);

		if (quoteCurrencyKey && this.allTokensMap[quoteCurrencyKey] && needsApproval) {
			const quoteTknAddress = this.allTokensMap[quoteCurrencyKey].address;
			return createERC20Contract(quoteTknAddress, this.signer);
		}
		return null;
	}

	private get oneInchApiUrl() {
		return `https://api.1inch.io/v4.0/${this.isL2 ? 10 : 1}`;
	}

	private getOneInchQuoteSwapParams(
		quoteTokenAddress: string,
		baseTokenAddress: string,
		amount: string,
		decimals: number
	) {
		return {
			fromTokenAddress: quoteTokenAddress,
			toTokenAddress: baseTokenAddress,
			amount: wei(amount, decimals).toString(0, true),
		};
	}

	private async getOneInchSwapParams(
		quoteCurrencyKey: string,
		baseCurrencyKey: string,
		amount: string,
		walletAddress: string
	) {
		const quoteTokenAddress = this.getTokenAddress(quoteCurrencyKey);
		const baseTokenAddress = this.getTokenAddress(baseCurrencyKey);
		const slippage = this.getOneInchSlippage(baseCurrencyKey, quoteCurrencyKey);
		const decimals = this.getTokenDecimals(quoteCurrencyKey);

		const params = this.getOneInchQuoteSwapParams(
			quoteTokenAddress,
			baseTokenAddress,
			amount,
			decimals
		);

		const res = await axios.get<OneInchSwapResponse>(this.oneInchApiUrl + 'swap', {
			params: {
				fromTokenAddress: params.fromTokenAddress,
				toTokenAddress: params.toTokenAddress,
				amount: params.amount,
				fromAddress: walletAddress,
				slippage,
				PROTOCOLS,
				referrerAddress: KWENTA_REFERRAL_ADDRESS,
				disableEstimate: true,
			},
		});

		return res.data;
	}

	private async quoteOneInch(
		quoteTokenAddress: string,
		baseTokenAddress: string,
		amount: string,
		decimals: number
	) {
		const params = this.getOneInchQuoteSwapParams(
			quoteTokenAddress,
			baseTokenAddress,
			amount,
			decimals
		);

		const response = await axios.get<OneInchQuoteResponse>(this.oneInchApiUrl + 'quote', {
			params: {
				fromTokenAddress: params.fromTokenAddress,
				toTokenAddress: params.toTokenAddress,
				amount: params.amount,
				disableEstimate: true,
				PROTOCOLS,
			},
		});

		return ethers.utils
			.formatUnits(response.data.toTokenAmount, response.data.toToken.decimals)
			.toString();
	}

	private async swapSynthSwapGasEstimate(fromToken: Token, toToken: Token, fromAmount: string) {
		return this.swapSynthSwap(fromToken, toToken, fromAmount, 'estimate_gas');
	}

	private async getPairRates(quoteCurrencyKey: string, baseCurrencyKey: string) {
		const exchangeRates = await this.getExchangeRates();

		const pairRates = newGetExchangeRatesTupleForCurrencies(
			exchangeRates,
			quoteCurrencyKey,
			baseCurrencyKey
		);

		return pairRates;
	}

	private async getTokensBalances(tokens: Token[], walletAddress: string) {
		const filteredTokens = tokens.filter((t) => !FILTERED_TOKENS.includes(t.address.toLowerCase()));
		const symbols = filteredTokens.map((token) => token.symbol);
		const filteredTokensMap = keyBy(filteredTokens, 'symbol');

		const calls = [];
		for (const { address, symbol } of filteredTokens) {
			if (symbol === CRYPTO_CURRENCY_MAP.ETH) {
				calls.push(this.multicallProvider.getEthBalance(walletAddress!));
			} else {
				const tokenContract = new EthCallContract(address, erc20Abi);
				calls.push(tokenContract.balanceOf(walletAddress));
			}
		}

		const data = (await this.multicallProvider.all(calls)) as ethers.BigNumber[];

		const tokenBalances: TokenBalances = {};
		data.forEach((value, index) => {
			if (value.lte(0)) return;
			const token = filteredTokensMap[symbols[index]];

			tokenBalances[symbols[index]] = {
				balance: wei(value, token.decimals ?? 18),
				token,
			};
		});
		return tokenBalances;
	}

	private async getETHBalance(walletAddress: string) {
		const balance = await this.provider.getBalance(walletAddress);
		return wei(balance);
	}

	public async getBaseFeeRate(sourceCurrencyKey: string, destinationCurrencyKey: string) {
		if (!this.contracts.SystemSettings) {
			throw new Error('SystemSettings does not exist on the currently selected network.');
		}

		const [sourceCurrencyFeeRate, destinationCurrencyFeeRate] = await Promise.all([
			this.contracts.SystemSettings.exchangeFeeRate(
				ethers.utils.formatBytes32String(sourceCurrencyKey)
			),
			this.contracts.SystemSettings.exchangeFeeRate(
				ethers.utils.formatBytes32String(destinationCurrencyKey)
			),
		]);

		return sourceCurrencyFeeRate && destinationCurrencyFeeRate
			? sourceCurrencyFeeRate.add(destinationCurrencyFeeRate)
			: null;
	}

	public async getExchangeFeeRate(sourceCurrencyKey: string, destinationCurrencyKey: string) {
		if (!this.contracts.Exchanger) {
			throw new Error('Exchanger does not exist on the currently selected network.');
		}

		return await this.contracts.Exchanger.feeRateForExchange(
			ethers.utils.formatBytes32String(sourceCurrencyKey),
			ethers.utils.formatBytes32String(destinationCurrencyKey)
		);
	}

	public async getRate(baseCurrencyKey: string, quoteCurrencyKey: string) {
		const [quoteRate, baseRate] = await this.getPairRates(quoteCurrencyKey, baseCurrencyKey);
		const baseCurrencyTokenAddress = this.getTokenAddress(baseCurrencyKey);
		const quoteCurrencyTokenAddress = this.getTokenAddress(quoteCurrencyKey);

		const coinGeckoPrices = await this.getCoingeckoPrices([
			quoteCurrencyTokenAddress,
			baseCurrencyTokenAddress,
		]);

		const base = baseRate.lte(0)
			? newGetCoinGeckoPricesForCurrencies(coinGeckoPrices, baseCurrencyTokenAddress)
			: baseRate;

		const quote = quoteRate.lte(0)
			? newGetCoinGeckoPricesForCurrencies(coinGeckoPrices, quoteCurrencyTokenAddress)
			: quoteRate;

		return base.gt(0) && quote.gt(0) ? quote.div(base) : wei(0);
	}

	public async getOneInchTokenList() {
		const oneInchApiUrl = `https://api.1inch.io/v4.0/${this.isL2 ? 10 : 1}`;
		const response = await axios.get<OneInchTokenListResponse>(oneInchApiUrl + 'tokens');

		const tokensMap = response.data.tokens || {};
		const chainId: NetworkId = this.isL2 ? 10 : 1;
		const tokens = Object.values(tokensMap).map((t) => ({ ...t, chainId, tags: [] }));

		return {
			tokens,
			tokensMap: keyBy(tokens, 'symbol'),
			symbols: tokens.map((token) => token.symbol),
		};
	}

	public async getFeeReclaimPeriod(currencyKey: string, walletAddress: string) {
		if (!this.contracts.Exchanger) {
			throw new Error('The Exchanger contract does not exist on the currently selected network.');
		}

		const maxSecsLeftInWaitingPeriod = (await this.contracts.Exchanger.maxSecsLeftInWaitingPeriod(
			walletAddress,
			ethers.utils.formatBytes32String(currencyKey)
		)) as ethers.BigNumberish;

		return Number(maxSecsLeftInWaitingPeriod);
	}

	public async getBalance(currencyKey: string, walletAddress: string) {
		const isETH = this.isCurrencyETH(currencyKey);
		const synthsWalletBalance = await getSynthBalances(walletAddress, this.contracts);
		const token = this.tokenList.find((t) => t.symbol === currencyKey);
		const tokenBalances = token ? await this.getTokensBalances([token], walletAddress) : undefined;

		if (currencyKey != null) {
			if (isETH) {
				const ETHBalance = await this.getETHBalance(walletAddress);
				return ETHBalance;
			} else if (this.synthsMap[currencyKey as SynthSymbol]) {
				return synthsWalletBalance != null
					? (get(synthsWalletBalance, ['balancesMap', currencyKey, 'balance'], zeroBN) as Wei)
					: null;
			} else {
				return tokenBalances?.[currencyKey]?.balance ?? zeroBN;
			}
		}

		return null;
	}

	public async swapSynthSwap(
		fromToken: Token,
		toToken: Token,
		fromAmount: string,
		walletAddress: string,
		metaOnly?: 'meta_tx' | 'estimate_gas'
	) {
		if (!this.signer) throw new Error('Wallet not connected');
		if (this.networkId !== 10) throw new Error('Unsupported network');

		const sUSD = this.tokensMap['sUSD'];

		const oneInchFrom = this.tokensMap[fromToken.symbol] ? sUSD.address : fromToken.address;
		const oneInchTo = this.tokensMap[toToken.symbol] ? sUSD.address : toToken.address;

		const fromSymbolBytes = ethers.utils.formatBytes32String(fromToken.symbol);
		const sUSDBytes = ethers.utils.formatBytes32String('sUSD');

		let synthAmountEth = fromAmount;
		if (this.tokensMap[fromToken.symbol]) {
			const fromAmountWei = wei(fromAmount).toString(0, true);
			const amounts = await this.contracts.Exchanger?.getAmountsForExchange(
				fromAmountWei,
				fromSymbolBytes,
				sUSDBytes
			);

			const usdValue = amounts.amountReceived.sub(amounts.fee);
			synthAmountEth = ethers.utils.formatEther(usdValue);
		}

		const params = await this.getOneInchSwapParams(
			oneInchFrom,
			oneInchTo,
			synthAmountEth,
			walletAddress
		);

		const formattedData = getFormattedSwapData(params, SYNTH_SWAP_OPTIMISM_ADDRESS);

		const synthSwapContract = new ethers.Contract(
			SYNTH_SWAP_OPTIMISM_ADDRESS,
			synthSwapAbi,
			this.signer
		);

		const contractFunc =
			metaOnly === 'meta_tx'
				? synthSwapContract.populateTransaction
				: metaOnly === 'estimate_gas'
				? synthSwapContract.estimateGas
				: synthSwapContract;

		if (this.tokensMap[toToken.symbol]) {
			const symbolBytes = ethers.utils.formatBytes32String(toToken.symbol);
			if (formattedData.functionSelector === 'swap') {
				return contractFunc.swapInto(symbolBytes, formattedData.data);
			} else {
				return contractFunc.uniswapSwapInto(
					symbolBytes,
					fromToken.address,
					params.fromTokenAmount,
					formattedData.data
				);
			}
		} else {
			if (formattedData.functionSelector === 'swap') {
				return contractFunc.swapOutOf(
					fromSymbolBytes,
					wei(fromAmount).toString(0, true),
					formattedData.data
				);
			} else {
				const usdValue = ethers.utils.parseEther(synthAmountEth).toString();
				return contractFunc.uniswapSwapOutOf(
					fromSymbolBytes,
					toToken.address,
					wei(fromAmount).toString(0, true),
					usdValue,
					formattedData.data
				);
			}
		}
	}

	public async swapOneInch(
		quoteTokenAddress: string,
		baseTokenAddress: string,
		amount: string,
		walletAddress: string,
		metaOnly = false
	) {
		const params = await this.getOneInchSwapParams(
			quoteTokenAddress,
			baseTokenAddress,
			amount,
			walletAddress
		);

		const { from, to, data, value } = params.tx;

		const tx = metaOnly
			? await this.signer.populateTransaction({
					from,
					to,
					data,
					value: ethers.BigNumber.from(value),
			  })
			: await this.signer.sendTransaction({
					from,
					to,
					data,
					value: ethers.BigNumber.from(value),
			  });
		return tx;
	}

	public async swapOneInchGasEstimate(
		quoteTokenAddress: string,
		baseTokenAddress: string,
		amount: string,
		walletAddress: string
	) {
		const params = await this.getOneInchSwapParams(
			quoteTokenAddress,
			baseTokenAddress,
			amount,
			walletAddress
		);

		return params.tx.gas;
	}

	private async getOneInchApproveAddress() {
		const response = await axios.get<OneInchApproveSpenderResponse>(
			this.oneInchApiUrl + 'approve/spender'
		);

		return response.data.address;
	}

	public async getNumEntries(walletAddress: string, currencyKey: string) {
		if (!this.contracts.Exchanger) {
			throw new Error('Something something wrong?');
		}

		const { numEntries } = await this.contracts.Exchanger.settlementOwing(
			walletAddress,
			ethers.utils.formatBytes32String(currencyKey)
		);

		return numEntries ?? null;
	}

	public async getExchangeRates() {
		if (!this.contracts.SynthUtil || !this.contracts.ExchangeRates) {
			throw new Error('Wrong network');
		}

		const exchangeRates: Rates = {};

		// Additional commonly used currencies to fetch, besides the one returned by the SynthUtil.synthsRates
		const additionalCurrencies = [
			'SNX',
			'XAU',
			'XAG',
			'DYDX',
			'APE',
			'BNB',
			'DOGE',
			'DebtRatio',
			'XMR',
			'OP',
		].map(ethers.utils.formatBytes32String);

		const [synthsRates, ratesForCurrencies] = (await Promise.all([
			this.contracts.SynthUtil?.synthsRates(),
			this.contracts.ExchangeRates?.ratesForCurrencies(additionalCurrencies),
		])) as [SynthRatesTuple, CurrencyRate[]];

		const synths = [...synthsRates[0], ...additionalCurrencies] as CurrencyKey[];
		const rates = [...synthsRates[1], ...ratesForCurrencies] as CurrencyRate[];

		synths.forEach((currencyKeyBytes32: CurrencyKey, idx: number) => {
			const currencyKey = ethers.utils.parseBytes32String(currencyKeyBytes32) as CurrencyKey;
			const marketAsset = MarketAssetByKey[currencyKey as FuturesMarketKey];

			const rate = Number(ethers.utils.formatEther(rates[idx]));

			exchangeRates[currencyKey] = wei(rate);
			if (marketAsset) exchangeRates[marketAsset] = wei(rate);
		});

		return exchangeRates;
	}

	// public handleApprove(currencyKey: string) {}

	// public handleSettle() {}

	// public handleExchange() {}
}

const createERC20Contract = (tokenAddress: string, signer: Signer) =>
	new ethers.Contract(tokenAddress, erc20Abi, signer);