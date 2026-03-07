import hardhatToolbox from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import hardhatContractSizer from '@solidstate/hardhat-contract-sizer';

/** @type {import('hardhat/config').HardhatUserConfig} */
const config = {
	plugins: [hardhatToolbox, hardhatContractSizer],
	contractSizer: {
		alphaSort: true,
		runOnCompile: true,
		disambiguatePaths: false,
	},
	solidity: {
		version: '0.8.24',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
		},
	},
	paths: {
		sources: './contracts',
		tests: './test',
		cache: './cache',
		artifacts: './artifacts',
	},
	test: {
		mocha: {
			timeout: 100000000,
			slow: 100000,
		},
	},
};

export default config;
