require('@nomicfoundation/hardhat-toolbox');
require('hardhat-contract-sizer');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	solidity: {
		version: '0.8.18',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
		},
	},
	contractSizer: {
		alphaSort: true,
		runOnCompile: true,
		disambiguatePaths: false,
		strict: true,
	},
	mocha: {
		timeout: 100000000,
		slow: 100000,
	},
};