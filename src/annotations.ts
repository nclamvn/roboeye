import type { DetBox, RelativeBox3D } from './detection-types';

export interface ImageSize {
  width: number;
  height: number;
}

export interface YoloExport {
  classes: string[];
  labelsText: string;
  classesText: string;
}

function classNames(boxes: DetBox[]): string[] {
  return [...new Set(boxes.map((box) => box.label))];
}

export function createYoloExport(boxes: DetBox[]): YoloExport {
  const classes = classNames(boxes);
  const lines = boxes.map((box) => {
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const width = box.x1 - box.x0;
    const height = box.y1 - box.y0;
    return `${classes.indexOf(box.label)} ${cx.toFixed(6)} ${cy.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
  });
  return {
    classes,
    labelsText: lines.length ? `${lines.join('\n')}\n` : '',
    classesText: classes.length ? `${classes.join('\n')}\n` : ''
  };
}

export function createCocoExport(boxes: DetBox[], image: ImageSize) {
  const classes = classNames(boxes);
  return {
    images: [{ id: 1, width: image.width, height: image.height, file_name: 'frame.jpg' }],
    categories: classes.map((name, index) => ({ id: index + 1, name })),
    annotations: boxes.map((box, index) => ({
      id: index + 1,
      image_id: 1,
      category_id: classes.indexOf(box.label) + 1,
      bbox: [
        box.x0 * image.width,
        box.y0 * image.height,
        (box.x1 - box.x0) * image.width,
        (box.y1 - box.y0) * image.height
      ].map((value) => +value.toFixed(1)),
      area: +((box.x1 - box.x0) * image.width * (box.y1 - box.y0) * image.height).toFixed(1),
      score: +box.score.toFixed(3),
      iscrowd: 0
    }))
  };
}

export function createRelative3dExport(boxes: DetBox[], image: ImageSize, boxes3d: Array<RelativeBox3D | null>) {
  return {
    note: 'RoboEye 3D annotations. box3d ở không gian view và dùng tỷ lệ tương đối, không phải mét thật.',
    scale: 'relative' as const,
    image,
    objects: boxes.map((box, index) => {
      const box3d = boxes3d[index];
      return {
        label: box.label,
        score: +box.score.toFixed(3),
        box2d: {
          x0: +box.x0.toFixed(4),
          y0: +box.y0.toFixed(4),
          x1: +box.x1.toFixed(4),
          y1: +box.y1.toFixed(4)
        },
        box3d: box3d
          ? {
              center: [+box3d.cx.toFixed(3), +box3d.cy.toFixed(3), +box3d.cz.toFixed(3)],
              half_extents: [+box3d.hx.toFixed(3), +box3d.hy.toFixed(3), +box3d.hz.toFixed(3)]
            }
          : null
      };
    })
  };
}
