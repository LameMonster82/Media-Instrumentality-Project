import type { ParsedOutput } from '$lib/types/parsed-output';

function parseExifOutput(text: string): ParsedOutput {
	return text
		.split('\n')
		.filter((line) => line.includes(':'))
		.map((line) => {
			const [label, ...valueParts] = line.split(':');
			return {
				label: label.trim(),
				value: valueParts.join(':').trim()
			};
		});
}

export { parseExifOutput };
