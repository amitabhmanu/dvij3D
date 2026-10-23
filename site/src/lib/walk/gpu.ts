// Which graphics chip the walk runs on: Ultra is the default on one of its own (Walk.tsx). Apart from ultra.ts so
// the page needn't load the effects to ask.

/** The GPU this runs on, by WebGL's own report of it, if it will tell. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** A graphics card of its own (not one sharing the processor's memory): Ultra can be the default there. */
export function discreteGpu(name: string): boolean {
  const n = name.toLowerCase();
  if (/intel|uhd|iris|mali|adreno|powervr|apple m\d(?! (pro|max|ultra))|swiftshader|llvmpipe|microsoft basic/.test(n)) return false;
  if (/radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|680m|780m|890m/.test(n)) return false; // (AMD's built into its processors)
  return /nvidia|geforce|rtx|gtx|quadro|radeon|apple m\d (pro|max|ultra)|arc a\d/.test(n);
}
