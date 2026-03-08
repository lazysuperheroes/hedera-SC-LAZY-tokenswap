function getArgFlag(arg) {
	// Support both -arg and --arg formats
	const singleDashIndex = process.argv.indexOf(`-${arg}`);
	const doubleDashIndex = process.argv.indexOf(`--${arg}`);

	return singleDashIndex > -1 || doubleDashIndex > -1;
}

function getArg(arg) {
	// Support both -arg and --arg formats
	let customidx = process.argv.indexOf(`-${arg}`);
	if (customidx === -1) {
		customidx = process.argv.indexOf(`--${arg}`);
	}

	let customValue;
	if (customidx > -1) {
		// Retrieve the value after the argument
		customValue = process.argv[customidx + 1];
	}

	return customValue;
}

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { getArgFlag, getArg, sleep };