import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseRoadAnnotationSet,
  parseRoadAnnotationTask,
  roadAnnotationsToTruthFrames,
  validateRoadAnnotationsAgainstTask,
} from '../src/drive/road-annotations';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const taskDirIndex = process.argv.indexOf('--task-dir');
if (taskDirIndex < 0 || !process.argv[taskDirIndex + 1]) {
  console.error('Cách dùng: npm run inspect:road-annotations -- --task-dir /local/task');
  process.exitCode = 2;
} else {
  try {
    const taskDir = resolve(process.argv[taskDirIndex + 1]);
    const taskBytes = await readFile(resolve(taskDir, 'task.json'));
    const taskSha256 = sha256(taskBytes);
    const task = parseRoadAnnotationTask(JSON.parse(taskBytes.toString('utf8')));
    const annotations = parseRoadAnnotationSet(JSON.parse(await readFile(resolve(taskDir, 'annotations.json'), 'utf8')));
    validateRoadAnnotationsAgainstTask(task, taskSha256, annotations);
    const images = [];
    for (const frame of task.frames) {
      const imagePath = resolve(taskDir, frame.imageFile);
      if (!imagePath.startsWith(`${taskDir}/`)) throw Error('Ảnh nằm ngoài task directory');
      const imageStat = await stat(imagePath);
      const actualSha256 = sha256(await readFile(imagePath));
      images.push({ file: frame.imageFile, bytes: imageStat.size, sha256: actualSha256, valid: actualSha256 === frame.imageSha256 });
    }
    if (images.some(image => !image.valid)) throw Error('Có ảnh thô sai SHA-256');
    const truthFrames = annotations.status === 'reviewed' ? roadAnnotationsToTruthFrames(annotations) : [];
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      taskId: task.taskId,
      taskSha256,
      clipId: task.clipId,
      sourceSha256: task.sourceSha256,
      predictionBlind: task.predictionBlind,
      annotationStatus: annotations.status,
      benchmarkReady: annotations.status === 'reviewed',
      frames: task.frames.length,
      truthFrames: truthFrames.length,
      images,
      blockers: annotations.status === 'reviewed' ? [] : ['Cần gán nhãn và review vòng hai trước khi benchmark'],
    }, null, 2)}\n`);
  } catch (error) {
    console.error(`Road annotations không hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
