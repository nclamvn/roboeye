"""Canonicalize ONNX node order so repeated exports have byte-stable provenance."""

from __future__ import annotations

import heapq
import pathlib
import sys

import onnx


def node_key(node: onnx.NodeProto) -> tuple[str, str, str]:
    return (node.name, node.op_type, "\0".join(node.output))


def canonicalize(path: pathlib.Path) -> None:
    model = onnx.load(path)
    nodes = list(model.graph.node)
    producer: dict[str, int] = {}
    for index, node in enumerate(nodes):
        for output in node.output:
            if output in producer:
                raise RuntimeError(f"duplicate tensor producer: {output}")
            producer[output] = index
    dependencies: list[set[int]] = []
    consumers: list[set[int]] = [set() for _ in nodes]
    for index, node in enumerate(nodes):
        required = {producer[name] for name in node.input if name in producer}
        dependencies.append(required)
        for dependency in required:
            consumers[dependency].add(index)
    ready: list[tuple[tuple[str, str, str], int]] = [
        (node_key(nodes[index]), index) for index, required in enumerate(dependencies) if not required
    ]
    heapq.heapify(ready)
    ordered: list[onnx.NodeProto] = []
    while ready:
        _, index = heapq.heappop(ready)
        ordered.append(nodes[index])
        for consumer in consumers[index]:
            dependencies[consumer].discard(index)
            if not dependencies[consumer]:
                heapq.heappush(ready, (node_key(nodes[consumer]), consumer))
    if len(ordered) != len(nodes):
        raise RuntimeError("ONNX graph contains a dependency cycle")
    del model.graph.node[:]
    model.graph.node.extend(ordered)
    initializers = sorted(model.graph.initializer, key=lambda item: item.name)
    del model.graph.initializer[:]
    model.graph.initializer.extend(initializers)
    value_info = sorted(model.graph.value_info, key=lambda item: item.name)
    del model.graph.value_info[:]
    model.graph.value_info.extend(value_info)
    onnx.checker.check_model(model)
    path.write_bytes(model.SerializeToString(deterministic=True))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: canonicalize-road-onnx.py model.onnx")
    canonicalize(pathlib.Path(sys.argv[1]).resolve())
