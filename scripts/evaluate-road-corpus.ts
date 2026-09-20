import { readFileSync } from 'node:fs';
import { evaluateRoadBenchmarkCorpus, parseRoadBenchmarkCorpus } from '../src/drive/road-benchmark';

if (process.argv.length !== 3) {
  console.error('Cách dùng: npm run benchmark:road -- <local-road-corpus.json>');
  process.exitCode = 2;
} else {
  try {
    const corpus = parseRoadBenchmarkCorpus(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(`${JSON.stringify(evaluateRoadBenchmarkCorpus(corpus), null, 2)}\n`);
  } catch (error) {
    console.error(`Road corpus không hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

