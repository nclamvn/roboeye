import { readFileSync, writeFileSync } from 'node:fs';
import { assembleSingleJourneyEvidencePlane, type DriveCandidateExport, type SingleJourneyEvidencePlan } from '../src/drive/evidence-plane';

const args = process.argv.slice(2), outputFlag = args.indexOf('--out');
if (outputFlag < 0 || outputFlag !== args.length - 2 || outputFlag < 3) {
  console.error('Cách dùng: npm run assemble:drive-evidence-plane -- <plan.json> <candidate-report-or-export.json> <challenger...json> --out <evidence-plane.json>');
  process.exitCode = 2;
} else {
  try {
    const [planPath, ...candidatePaths] = args.slice(0, outputFlag), outputPath = args[outputFlag + 1];
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as SingleJourneyEvidencePlan;
    const candidates = candidatePaths.map(path => {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as DriveCandidateExport & { evidencePlaneCandidate?: DriveCandidateExport };
      return raw.evidencePlaneCandidate ?? raw;
    });
    const plane = assembleSingleJourneyEvidencePlane(plan, candidates);
    writeFileSync(outputPath, `${JSON.stringify(plane, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ outputPath, benchmarkId: plane.benchmarkId, corpusId: plane.corpus.corpusId,
      journeyId: plane.corpus.journeys[0].journeyId, candidates: plane.candidates.map(candidate => candidate.manifest.candidateId),
      framesPerCandidate: plane.corpus.journeys[0].truthFrames.length }, null, 2));
  } catch (error) {
    console.error(`Không lắp được evidence plane: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
