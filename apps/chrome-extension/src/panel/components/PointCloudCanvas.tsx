import { useEffect, useRef } from "react";

/**
 * Decorative WebGL point-cloud behind the welcome screen.
 *
 * A dense field of tiny violet/indigo/blue points drifts gently and ripples
 * away from the pointer with inertia, then settles. Strictly decorative:
 * the canvas is `pointer-events: none` (see .db-point-cloud in panel.html),
 * sets no cursor anywhere, and renders only inside DevBridge's own panel —
 * never in the inspected website.
 *
 * Cost controls: zero dependencies (raw WebGL1 points), point count derived
 * from panel area and capped, DPR capped at 2, low-power context, no
 * depth/stencil buffers. The loop pauses when the tab is hidden, the window
 * blurs, or the canvas has zero size (e.g. another nav view is active), and
 * resumes on resize/visibility. `prefers-reduced-motion` renders a single
 * static frame with no animation loop. Missing WebGL hides the canvas so the
 * navy gradient backdrop remains.
 */

export const POINT_CLOUD_CLASS = "db-point-cloud";

/** Grid spacing in CSS px between resting points. */
export const POINT_SPACING_PX = 9;
/** Hard cap so large panels cannot explode the vertex count. */
export const MAX_POINTS = 6000;
/** Pointer influence radius in CSS px. */
export const INFLUENCE_RADIUS_PX = 150;

/** How many resting points fit the given panel area (clamped). Pure. */
export function pointCountForArea(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const cols = Math.max(1, Math.floor(width / POINT_SPACING_PX));
  const rows = Math.max(1, Math.floor(height / POINT_SPACING_PX));
  return Math.min(cols * rows, MAX_POINTS);
}

/** One exponential-approach step toward a target (frame-rate independent-ish). Pure. */
export function approachValue(current: number, target: number, factor: number): number {
  if (!(factor > 0)) return current;
  const f = Math.min(1, factor);
  return current + (target - current) * f;
}

/** True when the OS asks for reduced motion. Guarded for non-DOM runtimes. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const VERTEX_SHADER = `
attribute vec2 a_base;
attribute float a_seed;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform vec2 u_mouseVel;
uniform float u_presence;
uniform float u_time;
uniform float u_dpr;
varying vec3 v_color;
varying float v_alpha;
void main() {
  vec2 p = a_base;
  float seedAngle = a_seed * 6.2831;
  // Gentle idle drift so the field feels alive even without input.
  p.x += sin(u_time * 0.6 + seedAngle) * 3.0;
  p.y += cos(u_time * 0.5 + seedAngle * 1.7) * 3.0;
  // Pointer push: smooth radial falloff, stronger with pointer speed.
  vec2 toP = p - u_mouse;
  float dist = length(toP);
  float fall = 1.0 - smoothstep(0.0, ${INFLUENCE_RADIUS_PX.toFixed(1)}, dist);
  fall *= fall;
  vec2 dir = dist > 0.001 ? toP / dist : vec2(0.0, 1.0);
  float speed = length(u_mouseVel);
  float push = (14.0 + min(speed * 1.6, 42.0)) * u_presence;
  // Faint traveling ripple so fast flicks read as a wave, not a shove.
  float ripple = sin(dist * 0.045 - u_time * 3.2) * 0.5 + 0.5;
  p += dir * fall * push * (0.55 + 0.45 * ripple);
  // CSS px (y-down) to clip space.
  vec2 clip = vec2((p.x / u_res.x) * 2.0 - 1.0, 1.0 - (p.y / u_res.y) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  float size = (1.4 + a_seed * 1.4) * u_dpr;
  gl_PointSize = size * (1.0 + fall * 0.8 * u_presence);
  // Restrained indigo -> violet -> cool blue ramp, lifted near the pointer.
  vec3 indigo = vec3(0.42, 0.36, 0.94);
  vec3 violet = vec3(0.62, 0.55, 0.98);
  vec3 blue = vec3(0.38, 0.65, 0.98);
  vec3 col = mix(indigo, violet, smoothstep(0.0, 0.6, a_seed));
  col = mix(col, blue, smoothstep(0.6, 1.0, a_seed));
  v_color = col + fall * vec3(0.10, 0.09, 0.12) * u_presence;
  v_alpha = 0.30 + a_seed * 0.20 + fall * 0.25 * u_presence;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_color;
varying float v_alpha;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float mask = smoothstep(0.5, 0.18, d);
  gl_FragColor = vec4(v_color, v_alpha * mask);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Runs the field on owned, non-null handles. A module function (rather than
 * inline closures) so the non-null parameter types hold inside every
 * callback. Returns the effect cleanup.
 */
function runPointCloud(
  canvas: HTMLCanvasElement,
  parent: HTMLElement,
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): () => void {
  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const loc = {
    res: gl.getUniformLocation(program, "u_res"),
    mouse: gl.getUniformLocation(program, "u_mouse"),
    mouseVel: gl.getUniformLocation(program, "u_mouseVel"),
    presence: gl.getUniformLocation(program, "u_presence"),
    time: gl.getUniformLocation(program, "u_time"),
    dpr: gl.getUniformLocation(program, "u_dpr"),
  };
  const baseLoc = gl.getAttribLocation(program, "a_base");
  const seedLoc = gl.getAttribLocation(program, "a_seed");

  const baseBuffer = gl.createBuffer();
  const seedBuffer = gl.createBuffer();
  let pointCount = 0;

  function rebuildGrid(cssWidth: number, cssHeight: number): void {
    const cols = Math.max(1, Math.floor(cssWidth / POINT_SPACING_PX));
    const rows = Math.max(1, Math.floor(cssHeight / POINT_SPACING_PX));
    let count = cols * rows;
    let stepX = POINT_SPACING_PX;
    let stepY = POINT_SPACING_PX;
    if (count > MAX_POINTS) {
      // Preserve full coverage on huge panels by widening the grid.
      const scale = Math.sqrt(count / MAX_POINTS);
      stepX *= scale;
      stepY *= scale;
      count = Math.min(
        MAX_POINTS,
        Math.max(1, Math.floor(cssWidth / stepX)) * Math.max(1, Math.floor(cssHeight / stepY)),
      );
    }
    const bases = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    let i = 0;
    const useCols = Math.max(1, Math.floor(cssWidth / stepX));
    for (let n = 0; n < count; n += 1) {
      const col = n % useCols;
      const row = Math.floor(n / useCols);
      bases[i * 2] = col * stepX + stepX / 2;
      bases[i * 2 + 1] = row * stepY + stepY / 2;
      // Deterministic pseudo-random per point so the still frame is stable.
      seeds[i] = ((n * 2654435761) % 1000) / 1000;
      i += 1;
    }
    pointCount = count;
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, bases, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  }

  function bindAndDraw(): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuffer);
    gl.enableVertexAttribArray(baseLoc);
    gl.vertexAttribPointer(baseLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
    gl.enableVertexAttribArray(seedLoc);
    gl.vertexAttribPointer(seedLoc, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, pointCount);
  }

  function resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    const pxW = Math.max(1, Math.round(w * dpr));
    const pxH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      rebuildGrid(w, h);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.res, w, h);
    gl.uniform1f(loc.dpr, dpr);
    return true;
  }

  function releaseContext(): void {
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }

  function onContextLost(e: Event): void {
    e.preventDefault();
    contextLost = true;
    stop();
  }

  function onContextRestored(): void {
    contextLost = false;
    if (resize()) start();
  }

  if (prefersReducedMotion()) {
    // Single static frame: a calm, readable still field, no loop.
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (pointCount > 0) {
      gl.uniform2f(loc.mouse, -10000, -10000);
      gl.uniform2f(loc.mouseVel, 0, 0);
      gl.uniform1f(loc.presence, 0);
      gl.uniform1f(loc.time, 0);
      bindAndDraw();
    }
    const ro = new ResizeObserver(() => {
      if (disposed || contextLost) return;
      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (pointCount > 0) {
        gl.uniform2f(loc.mouse, -10000, -10000);
        gl.uniform2f(loc.mouseVel, 0, 0);
        gl.uniform1f(loc.presence, 0);
        gl.uniform1f(loc.time, 0);
        bindAndDraw();
      }
    });
    ro.observe(parent);
    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => {
      disposed = true;
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      releaseContext();
    };
  }

  // Pointer state: eased position/velocity/presence give the inertia and
  // natural settle — nothing snaps because the shader only ever sees the
  // smoothed values.
  const target = { x: 0, y: 0, presence: 0 };
  const smooth = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  let presence = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let disposed = false;
  let contextLost = false;

  function drawFrame(now: number): void {
    if (!running || disposed || contextLost) return;
    const dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    time += dt;
    const prevX = smooth.x;
    const prevY = smooth.y;
    smooth.x = approachValue(smooth.x, target.x, 0.14);
    smooth.y = approachValue(smooth.y, target.y, 0.14);
    const rawVX = smooth.x - prevX;
    const rawVY = smooth.y - prevY;
    vel.x = approachValue(vel.x, rawVX, 0.25);
    vel.y = approachValue(vel.y, rawVY, 0.25);
    presence = approachValue(presence, target.presence, 0.06);
    if (!resize()) {
      // Zero-size (e.g. another nav view is shown): pause until resize.
      running = false;
      return;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.mouse, smooth.x, smooth.y);
    gl.uniform2f(loc.mouseVel, vel.x, vel.y);
    gl.uniform1f(loc.presence, presence);
    gl.uniform1f(loc.time, time);
    bindAndDraw();
    raf = requestAnimationFrame(drawFrame);
  }

  function start(): void {
    if (running || disposed || contextLost || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(drawFrame);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  function onPointerMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    target.x = e.clientX - rect.left;
    target.y = e.clientY - rect.top;
    target.presence = 1;
  }

  function onPointerLeave(): void {
    target.presence = 0;
  }

  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  function onBlur(): void {
    stop();
  }

  function onFocus(): void {
    start();
  }

  const ro = new ResizeObserver(() => {
    if (disposed || contextLost) return;
    if (!running && canvas.clientWidth > 0 && canvas.clientHeight > 0) start();
  });
  ro.observe(parent);

  parent.addEventListener("pointermove", onPointerMove);
  parent.addEventListener("pointerleave", onPointerLeave);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  start();

  return () => {
    disposed = true;
    stop();
    ro.disconnect();
    parent.removeEventListener("pointermove", onPointerMove);
    parent.removeEventListener("pointerleave", onPointerLeave);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    releaseContext();
  };
}

export function PointCloudCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      // Graceful fallback: hide the canvas, keep the navy gradient backdrop.
      canvas.style.display = "none";
      return;
    }
    const program = createProgram(gl);
    if (!program) {
      canvas.style.display = "none";
      return;
    }
    return runPointCloud(canvas, parent, gl, program);
  }, []);

  return <canvas ref={canvasRef} className={POINT_CLOUD_CLASS} aria-hidden="true" />;
}
