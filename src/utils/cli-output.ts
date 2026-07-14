/**
 * Machine-readable commands must be the only process output. This stays
 * intentionally narrow so interactive startup notices still reach users.
 */
export function isMachineReadableOutput(argv: string[]): boolean {
	const providerCommandIndex = argv.indexOf("providers");
	if (providerCommandIndex === -1) return false;

	for (let index = providerCommandIndex + 1; index < argv.length; index += 1) {
		if (
			(argv[index] === "--format" || argv[index] === "--output") &&
			argv[index + 1] === "json"
		) {
			return true;
		}
		if (argv[index] === "--format=json") return true;
	}

	return false;
}
