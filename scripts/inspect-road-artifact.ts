import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { assessRoadArtifact, parseRoadArtifactManifest, parseRoadRuntimeProof } from '../src/drive/road-artifact-contract';

const [, , manifestArg, artifactArg, runtimeProofArg, operatorInventoryArg] = process.argv;
if (!manifestArg || !artifactArg) {
  throw new Error('Cách dùng: npm run inspect:road-artifact -- <manifest.json> <model.onnx> [runtime-proof.json operator-inventory.json]');
}
if (Boolean(runtimeProofArg) !== Boolean(operatorInventoryArg)) throw new Error('Runtime proof và operator inventory phải được cung cấp cùng nhau');

const manifestPath = resolve(manifestArg);
const artifactPath = resolve(artifactArg);
const manifest = parseRoadArtifactManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
const runtimeProof = runtimeProofArg
  ? parseRoadRuntimeProof(JSON.parse(await readFile(resolve(runtimeProofArg), 'utf8')) as unknown)
  : undefined;
const operatorInventoryBytes = operatorInventoryArg ? await readFile(resolve(operatorInventoryArg)) : undefined;
const operatorInventory = operatorInventoryBytes ? JSON.parse(operatorInventoryBytes.toString('utf8')) as { artifactSha256?: unknown } : undefined;
if (basename(artifactPath) !== manifest.export.file) throw new Error('Tên artifact không khớp manifest.export.file');
const bytes = await readFile(artifactPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const artifactExact = bytes.length === manifest.export.bytes && sha256 === manifest.export.sha256;
const operatorInventoryExact = !runtimeProof || Boolean(
  operatorInventoryBytes
  && createHash('sha256').update(operatorInventoryBytes).digest('hex') === runtimeProof.operatorInventorySha256
  && operatorInventory?.artifactSha256 === manifest.export.sha256
);
const assessment = assessRoadArtifact(manifest, undefined, undefined, runtimeProof);
const result = {
  artifactId: manifest.artifactId,
  candidateId: manifest.candidateId,
  purpose: manifest.purpose,
  artifactExact,
  operatorInventoryExact,
  observed: { file: basename(artifactPath), bytes: bytes.length, sha256 },
  declared: { file: manifest.export.file, bytes: manifest.export.bytes, sha256: manifest.export.sha256 },
  ...assessment,
  allowedForDeclaredPurpose: artifactExact && operatorInventoryExact && assessment.allowedForDeclaredPurpose,
  blockers: [
    ...assessment.blockers,
    ...(artifactExact ? [] : ['artifact bytes/hash không khớp manifest']),
    ...(operatorInventoryExact ? [] : ['operator inventory hash/artifact không khớp runtime proof']),
  ],
};
console.log(JSON.stringify(result, null, 2));
if (!result.allowedForDeclaredPurpose) process.exitCode = 2;
