import { readFileSync } from 'node:fs';
import { evaluateValidationCorpus, parseValidationCorpus } from '../src/drive/validation';

if (process.argv.length !== 3) {
  console.error('Cách dùng: npm run benchmark:drive-corpus -- <local-corpus.json>');
  process.exitCode = 2;
} else {
  try {
    const corpus = parseValidationCorpus(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(`${JSON.stringify(evaluateValidationCorpus(corpus), null, 2)}\n`);
  } catch (error) {
    console.error(`Drive corpus không hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
