# TIP-23 — AirSketch static-clutch grammar

## Problem

The earlier double-flick arm required timing, travel distance and a second gesture before drawing. That made the critical path unreliable, especially when a user needed to draw then pick up and place several objects.

## Contract

- A fist is safe transport: no cursor and no ink.
- An extended index is hover only.
- A thumb–index pinch while pointing starts and continues a stroke; releasing it ends the stroke.
- An open palm held for 350 ms enters manipulation. This dwell rejects a fleeting open hand while drawing.
- In manipulation, thumb–index pinch grabs the nearest object; release drops it. Palm span continues to control bounded scale.

## Non-goals

This TIP changes interaction grammar only. It does not alter the sketch classifier, Vietnamese labels, object scene storage or pointer/touch fallback.

## Evidence required

Unit tests must exercise clutch, dwell reset, fist safety, hysteresis and multiple objects. Browser E2E must produce a real hand-landmark stroke, then enter manipulation, grab and drop that object.
