import Head from 'next/head';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import DashboardLayout from 'sections/dashboard/DashboardLayout';
import StakingPortfolio from 'sections/dashboard/Stake/StakingPortfolio';
import StakingTabs from 'sections/dashboard/Stake/StakingTabs';
import { useAppDispatch, useAppSelector } from 'state/hooks';
import { fetchEscrowData, fetchStakingData } from 'state/staking/actions';

type StakingComponent = React.FC & { getLayout: (page: HTMLElement) => JSX.Element };

const StakingPage: StakingComponent = () => {
	const { t } = useTranslation();
	const dispatch = useAppDispatch();
	const walletAddress = useAppSelector(({ wallet }) => wallet.walletAddress);

	useEffect(() => {
		if (!!walletAddress) {
			dispatch(fetchStakingData());
			dispatch(fetchEscrowData());
		}
	}, [dispatch, walletAddress]);

	return (
		<>
			<Head>
				<title>{t('dashboard-stake.page-title')}</title>
			</Head>
			<StakingPortfolio />
			<StakingTabs />
		</>
	);
};

StakingPage.getLayout = (page) => <DashboardLayout>{page}</DashboardLayout>;

export default StakingPage;
