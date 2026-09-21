import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateEvidencePlane, parseEvidencePlane } from '../src/drive/evidence-plane';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || process.argv.length > 4) {
  console.error('Cách dùng: npm run benchmark:drive-evidence-plane -- <evidence-plane.json> [report.json]');
  process.exitCode = 2;
} else {
  try {
    const plane = parseEvidencePlane(JSON.parse(readFileSync(inputPath, 'utf8')));
    const output = `${JSON.stringify(evaluateEvidencePlane(plane), null, 2)}\n`;
    if (outputPath) writeFileSync(outputPath, output, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(output);
  } catch (error) {
    console.error(`Evidence plane không hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
