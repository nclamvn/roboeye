// Pinned ORT 1.22's exports map omits its `types` condition under bundler resolution.
// Load the publisher's complete declarations rather than declaring an untyped module.
/// <reference path="../node_modules/onnxruntime-web/types.d.ts" />
