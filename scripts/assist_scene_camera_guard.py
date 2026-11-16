"""Publication veto for RGB footage with unresolved depth/scale ambiguity."""

from collections import deque
from math import hypot, isfinite, log


# Sustained apparent expansion/contraction is incompatible with asserting a
# nearby target's motion from a single background similarity alone. The gate
# treats zoom and camera translation alike; it does not estimate true pose.
POLICY = {"horizonMs": 640, "minPairs": 2, "minAbsLogScale": .065, "minCoherence": .75}


class CameraScaleGuard:
    def __init__(self):
        self.steps = deque(maxlen=8)

    def update(self, at, scale):
        if (scale is None or not isfinite(scale) or scale <= 0 or not isfinite(at)
                or (self.steps and (at <= self.steps[-1][0] or at-self.steps[-1][0] > 300))):
            self.steps.clear()
            return False
        self.steps.append((at, log(scale)))
        while self.steps and at-self.steps[0][0] > POLICY["horizonMs"]:
            self.steps.popleft()
        net = abs(sum(x[1] for x in self.steps))
        total = sum(abs(x[1]) for x in self.steps)
        return (len(self.steps) >= POLICY["minPairs"] and net >= POLICY["minAbsLogScale"]
                and total > 0 and net/total >= POLICY["minCoherence"])


def affine_scale(matrix):
    return None if matrix is None else hypot(float(matrix[0, 0]), float(matrix[1, 0]))
