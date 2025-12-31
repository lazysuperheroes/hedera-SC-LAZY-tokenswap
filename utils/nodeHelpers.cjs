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

function hex_to_ascii(hex) {
	const r = [];
	for (let i = 0; i < hex.length - 1; i += 2) {
		const v = parseInt(hex.charAt(i) + hex.charAt(i + 1), 16);
		if (v) r.push(String.fromCharCode(v));
	}
	return r.join('');
}

module.exports = { getArgFlag, getArg, sleep, hex_to_ascii };