import { wei } from '@synthetixio/wei';
import { ethers } from 'ethers';
import _ from 'lodash';
import moment from 'moment';
import { useMemo, useState } from 'react';
import { erc20ABI, useContractRead, useContractReads, usePrepareContractWrite } from 'wagmi';

import {
	KWENTA_TOKEN_ADDRESS,
	REWARD_ESCROW,
	STAKING_REWARDS,
	SUPPLY_SCHEDULE,
	TRADING_REWARDS,
	VKWENTA_REDEEMER,
	VKWENTA_TOKEN_ADDRESS,
	VEKWENTA_REDEEMER,
	VEKWENTA_TOKEN_ADDRESS,
} from 'constants/address';
import Connector from 'containers/Connector';
import multipleMerkleDistributorABI from 'lib/abis/MultipleMerkleDistributor.json';
import rewardEscrowABI from 'lib/abis/RewardEscrow.json';
import stakingRewardsABI from 'lib/abis/StakingRewards.json';
import supplyScheduleABI from 'lib/abis/SupplySchedule.json';
import veKwentaRedeemerABI from 'lib/abis/veKwentaRedeemer.json';
import vKwentaRedeemerABI from 'lib/abis/vKwentaRedeemer.json';
import { formatTruncatedDuration } from 'utils/formatters/date';
import { zeroBN } from 'utils/formatters/number';
import logError from 'utils/logError';

export type EscrowRow = {
	id: number;
	date: string;
	time: string;
	vestable: number;
	amount: number;
	fee: number;
	status: 'VESTED' | 'VESTING';
};

type VestingEntry = {
	endTime: number;
	escrowAmount: number;
	entryID: number;
};

let data: EscrowRow[] = [];

const useStakingData = () => {
	const { network } = Connector.useContainer();
	const kwentaTokenContract = {
		addressOrName: KWENTA_TOKEN_ADDRESS[network?.id],
		contractInterface: erc20ABI,
	};

	const stakingRewardsContract = {
		addressOrName: STAKING_REWARDS[network?.id],
		contractInterface: stakingRewardsABI,
	};

	const rewardEscrowContract = {
		addressOrName: REWARD_ESCROW[network?.id],
		contractInterface: rewardEscrowABI,
	};

	const supplyScheduleContract = {
		addressOrName: SUPPLY_SCHEDULE[network?.id],
		contractInterface: supplyScheduleABI,
	};

	const vKwentaTokenContract = {
		addressOrName: VKWENTA_TOKEN_ADDRESS[network?.id],
		contractInterface: erc20ABI,
	};

	const vKwentaRedeemerContract = {
		addressOrName: VKWENTA_REDEEMER[network?.id],
		contractInterface: vKwentaRedeemerABI,
	};

	const veKwentaTokenContract = {
		addressOrName: VEKWENTA_TOKEN_ADDRESS[network?.id],
		contractInterface: erc20ABI,
	};

	const veKwentaRedeemerContract = {
		addressOrName: VEKWENTA_REDEEMER[network?.id],
		contractInterface: veKwentaRedeemerABI,
	};

	const multipleMerkleDistributorContract = {
		addressOrName: TRADING_REWARDS[network?.id],
		contractInterface: multipleMerkleDistributorABI,
	};

	const [epochPeriod, setEpochPeriod] = useState(0);
	const { walletAddress } = Connector.useContainer();
	const [kwentaBalance, setKwentaBalance] = useState(zeroBN);
	const [escrowedBalance, setEscrowedBalance] = useState(zeroBN);
	const [stakedNonEscrowedBalance, setStakedNonEscrowedBalance] = useState(zeroBN);
	const [stakedEscrowedBalance, setStakedEscrowedBalance] = useState(zeroBN);
	const [totalStakedBalance, setTotalStakedBalance] = useState(zeroBN);
	const [claimableBalance, setClaimableBalance] = useState(zeroBN);
	const [apy, setApy] = useState(zeroBN);
	const [vKwentaBalance, setVKwentaBalance] = useState(zeroBN);
	const [vKwentaAllowance, setVKwentaAllowance] = useState(zeroBN);
	const [kwentaAllowance, setKwentaAllowance] = useState(zeroBN);
	const [veKwentaBalance, setVEKwentaBalance] = useState(zeroBN);
	const [veKwentaAllowance, setVEKwentaAllowance] = useState(zeroBN);

	useContractReads({
		contracts: [
			{
				...rewardEscrowContract,
				functionName: 'balanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...stakingRewardsContract,
				functionName: 'nonEscrowedBalanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...stakingRewardsContract,
				functionName: 'escrowedBalanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...stakingRewardsContract,
				functionName: 'earned',
				args: [walletAddress ?? undefined],
			},
			{
				...kwentaTokenContract,
				functionName: 'balanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...supplyScheduleContract,
				functionName: 'DECAY_RATE',
			},
			{
				...supplyScheduleContract,
				functionName: 'INITIAL_WEEKLY_SUPPLY',
			},
			{
				...supplyScheduleContract,
				functionName: 'weekCounter',
			},
			{
				...stakingRewardsContract,
				functionName: 'totalSupply',
			},
			{
				...vKwentaTokenContract,
				functionName: 'balanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...vKwentaTokenContract,
				functionName: 'allowance',
				args: [walletAddress ?? undefined, vKwentaRedeemerContract.addressOrName],
			},
			{
				...kwentaTokenContract,
				functionName: 'allowance',
				args: [walletAddress ?? undefined, stakingRewardsContract.addressOrName],
			},
			{
				...multipleMerkleDistributorContract,
				functionName: 'distributionEpoch',
			},
			{
				...veKwentaTokenContract,
				functionName: 'balanceOf',
				args: [walletAddress ?? undefined],
			},
			{
				...veKwentaTokenContract,
				functionName: 'allowance',
				args: [walletAddress ?? undefined, veKwentaRedeemerContract.addressOrName],
			},
		],
		watch: true,
		allowFailure: true,
		onSettled(data, error) {
			if (error) logError(error);
			if (data) {
				setEscrowedBalance(wei(data[0] ?? zeroBN));
				setStakedNonEscrowedBalance(wei(data[1] ?? zeroBN));
				setStakedEscrowedBalance(wei(data[2] ?? zeroBN));
				setClaimableBalance(wei(data[3] ?? zeroBN));
				setKwentaBalance(wei(data[4] ?? zeroBN));
				setTotalStakedBalance(wei(data[8] ?? zeroBN));
				const supplyRate = wei(1).sub(wei(data[5] ?? zeroBN));
				const initialWeeklySupply = wei(data[6] ?? zeroBN);
				const weekCounter = Number(data[7] ?? zeroBN);
				const startWeeklySupply = initialWeeklySupply.mul(supplyRate.pow(weekCounter));
				const yearlyRewards =
					totalStakedBalance.gt(zeroBN) && supplyRate.gt(zeroBN)
						? startWeeklySupply.mul(wei(1).sub(supplyRate.pow(52))).div(wei(1).sub(supplyRate))
						: zeroBN;
				setApy(
					totalStakedBalance.gt(zeroBN) ? yearlyRewards.div(totalStakedBalance).div(100) : zeroBN
				);
				setVKwentaBalance(wei(data[9] ?? zeroBN));
				setVKwentaAllowance(wei(data[10] ?? zeroBN));
				setKwentaAllowance(wei(data[11] ?? zeroBN));
				setEpochPeriod(Number(data[12] ?? 0) ?? 0);
				setVEKwentaBalance(wei(data[13] ?? zeroBN));
				setVEKwentaAllowance(wei(data[14] ?? zeroBN));
			}
		},
	});

	const periods = useMemo(() => {
		let periods: number[] = [];
		for (let i = 1; i <= epochPeriod + 1; i++) {
			periods.push(i);
		}
		return periods;
	}, [epochPeriod]);

	data = [];

	const { data: vestingSchedules } = useContractRead({
		...rewardEscrowContract,
		functionName: 'getVestingSchedules',
		args: [walletAddress ?? undefined, 0, 1000],
		watch: true,
		enabled: !!walletAddress,
		select: (data) => data.filter((d) => d.escrowAmount.gt(0)),
		onError(error) {
			if (error) logError(error);
		},
	});

	vestingSchedules &&
		vestingSchedules.length > 0 &&
		vestingSchedules.forEach((d: VestingEntry) => {
			data.push({
				id: Number(d.entryID),
				date: moment(Number(d.endTime) * 1000).format('MM/DD/YY'),
				time: formatTruncatedDuration(d.endTime - new Date().getTime() / 1000),
				vestable: d.endTime * 1000 > Date.now() ? 0 : Number(d.escrowAmount / 1e18),
				amount: Number(d.escrowAmount / 1e18),
				fee: d.endTime * 1000 > Date.now() ? Number(d.escrowAmount / 1e18) : 0,
				status: d.endTime * 1000 > Date.now() ? 'VESTING' : 'VESTED',
			});
		});

	const contracts = data.map((d) => {
		return {
			...rewardEscrowContract,
			functionName: 'getVestingEntryClaimable',
			args: [walletAddress ?? undefined, d.id],
		};
	});

	const {
		data: vestingEntryClaimable,
		isSuccess: vestingEntryClaimableIsSuccess,
	} = useContractReads({
		contracts,
		watch: true,
		enabled: !!walletAddress && contracts.length > 0,
	});

	vestingEntryClaimableIsSuccess &&
		vestingEntryClaimable !== undefined &&
		vestingEntryClaimable.forEach((d, index) => {
			data[index].vestable = Number(d.quantity / 1e18);
			data[index].fee = Number(d.fee / 1e18);
		});

	const totalVestable = data.reduce(
		(acc, current, index) => wei(acc).add(wei(data[index]?.vestable)) ?? zeroBN,
		zeroBN
	);

	const kwentaTokenApproval = useMemo(() => kwentaBalance.gt(kwentaAllowance), [
		kwentaBalance,
		kwentaAllowance,
	]);

	const vKwentaTokenApproval = useMemo(() => vKwentaBalance.gt(vKwentaAllowance), [
		vKwentaBalance,
		vKwentaAllowance,
	]);

	const veKwentaTokenApproval = useMemo(() => veKwentaBalance.gt(veKwentaAllowance), [
		veKwentaBalance,
		veKwentaAllowance,
	]);

	const { config: getRewardConfig } = usePrepareContractWrite({
		...stakingRewardsContract,
		functionName: 'getReward',
		enabled: claimableBalance.gt(0),
	});

	const { config: kwentaApproveConfig } = usePrepareContractWrite({
		...kwentaTokenContract,
		functionName: 'approve',
		args: [stakingRewardsContract.addressOrName, ethers.constants.MaxUint256],
		enabled: kwentaTokenApproval,
	});

	const { config: vKwentaApproveConfig } = usePrepareContractWrite({
		...vKwentaTokenContract,
		functionName: 'approve',
		args: [vKwentaRedeemerContract.addressOrName, ethers.constants.MaxUint256],
		enabled: vKwentaTokenApproval,
	});

	const { config: veKwentaApproveConfig } = usePrepareContractWrite({
		...veKwentaTokenContract,
		functionName: 'approve',
		args: [veKwentaRedeemerContract.addressOrName, ethers.constants.MaxUint256],
		enabled: veKwentaTokenApproval,
		onError(error) {
			// eslint-disable-next-line no-console
			console.log(`vKwentaApprove`, error);
		},
	});

	const { config: vKwentaRedeemConfig } = usePrepareContractWrite({
		...vKwentaRedeemerContract,
		functionName: 'redeem',
		enabled: wei(vKwentaBalance).gt(0),
		onError(error) {
			// eslint-disable-next-line no-console
			console.log(`vKwentaRedeem`, error);
		},
	});

	const { config: veKwentaRedeemConfig } = usePrepareContractWrite({
		...veKwentaRedeemerContract,
		functionName: 'redeem',
		args: [walletAddress],
		enabled: wei(veKwentaBalance).gt(0),
		onError(error) {
			// eslint-disable-next-line no-console
			console.log(`veKwentaRedeem`, error);
		},
	});

	return {
		periods,
		epochPeriod,
		data,
		escrowedBalance,
		totalVestable,
		stakedNonEscrowedBalance,
		stakedEscrowedBalance,
		claimableBalance,
		kwentaBalance,
		apy,
		vKwentaBalance,
		veKwentaBalance,
		vKwentaAllowance,
		veKwentaAllowance,
		kwentaAllowance,
		getRewardConfig,
		kwentaApproveConfig,
		vKwentaApproveConfig,
		veKwentaApproveConfig,
		vKwentaRedeemConfig,
		veKwentaRedeemConfig,
		kwentaTokenApproval,
		vKwentaTokenApproval,
		veKwentaTokenApproval,
		stakingRewardsContract,
		rewardEscrowContract,
		vKwentaRedeemerContract,
		veKwentaRedeemerContract,
		multipleMerkleDistributorContract,
	};
};

export default useStakingData;
