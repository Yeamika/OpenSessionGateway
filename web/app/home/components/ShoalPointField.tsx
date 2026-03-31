"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minimap } from "./Minimap";
import { ScaleControl } from "./ScaleControl";
import type { CardPosition, ClientItem } from "../types";
import {
  cardKey,
  clamp,
  displayTitle,
  runtimeKey,
  runtimeTarget,
  sessionLampColor,
  sessionStatusLabel,
  shortRuntimeLabel,
  simpleHash,
  statusLabel,
  workspaceGroupKey,
  workspaceKey,
  workspaceLabel,
  workspaceTargetInRuntime,
  worldSize,
} from "../utils";

const VERTEX_SHADER = `
precision highp float;

uniform vec2 u_resolution;

attribute vec2 a_position;
attribute float a_size;
attribute vec3 a_color;

varying vec3 v_color;

void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  gl_PointSize = a_size;
  v_color = a_color;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec3 v_color;

void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

const BUBBLE_VERTEX_SHADER = `
precision highp float;

uniform vec2 u_resolution;

attribute vec2 a_center;
attribute vec2 a_radius;
attribute vec2 a_corner;
attribute vec3 a_color;
attribute float a_seed;
attribute float a_density;

varying vec2 v_local;
varying vec3 v_color;
varying float v_seed;
varying float v_density;

void main() {
  vec2 position = a_center + a_corner * a_radius;
  vec2 clip = (position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_local = a_corner;
  v_color = a_color;
  v_seed = a_seed;
  v_density = a_density;
}
`;

const BUBBLE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_local;
varying vec3 v_color;
varying float v_seed;
varying float v_density;

float blob(vec2 p, vec2 offset, vec2 stretch, float radius) {
  return radius - length((p - offset) * stretch);
}

void main() {
  float seed = v_seed * 0.001;
  float angle = atan(v_local.y, v_local.x);
  float radial = length(v_local);

  vec2 offsetA = vec2(sin(seed * 3.1), cos(seed * 2.7)) * 0.22;
  vec2 offsetB = vec2(cos(seed * 2.3 + 1.2), sin(seed * 3.9 - 0.7)) * 0.18;
  vec2 offsetC = vec2(sin(seed * 5.1 + 0.4), cos(seed * 4.3 + 1.8)) * 0.13;

  float field = blob(v_local, vec2(0.0), vec2(0.92, 1.06), 0.98);
  field = max(field, blob(v_local, offsetA, vec2(1.18, 0.94), 0.62));
  field = max(field, blob(v_local, -offsetB, vec2(0.94, 1.18), 0.56));
  field = max(field, blob(v_local, offsetC, vec2(1.08, 1.0), 0.38));

  float ripple = 0.08 * sin(angle * 4.0 + seed * 11.0)
    + 0.05 * sin(angle * 7.0 - seed * 6.0)
    + 0.04 * cos((v_local.x - v_local.y) * 4.5 + seed * 5.2);
  field += ripple * (1.0 - smoothstep(0.18, 1.16, radial));

  float mask = smoothstep(-0.11, 0.12 + v_density * 0.04, field);
  float core = smoothstep(0.12, 0.46, field);
  float rim = smoothstep(-0.01, 0.08, field) - smoothstep(0.12, 0.22, field);
  float sheen = smoothstep(0.05, 0.28, field) * (0.5 + 0.5 * sin(v_local.y * 4.5 + seed * 8.0));

  vec3 color = mix(vec3(0.03, 0.05, 0.09), v_color * 0.58 + vec3(0.04, 0.06, 0.1), 0.86);
  color += v_color * (0.18 + 0.08 * v_density) * core;
  color += mix(v_color, vec3(0.95, 0.98, 1.0), 0.55) * rim * 0.95;
  color += vec3(0.12, 0.16, 0.24) * sheen * 0.45;

  float alpha = mask * (0.08 + 0.03 * v_density) + core * 0.04 + rim * 0.18;
  if (alpha < 0.012) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

const QUAD_CORNERS = [
  -1, -1,
  1, -1,
  1, 1,
  -1, -1,
  1, 1,
  -1, 1,
];

const GPU_SIM_SHADER = `
struct Fish {
  position: vec2f,
  velocity: vec2f,
  home: vec2f,
  size: f32,
  pad0: f32,
  color: vec4f,
}

struct SimParams {
  worldAndTime: vec4f,
  dragAndCount: vec4f,
  extra: vec4f,
}

@group(0) @binding(0) var<storage, read> srcFish: array<Fish>;
@group(0) @binding(1) var<storage, read_write> dstFish: array<Fish>;
@group(0) @binding(2) var<uniform> params: SimParams;

fn safeNormalize(value: vec2f) -> vec2f {
  let len = length(value);
  if (len < 0.0001) {
    return vec2f(0.0, 0.0);
  }
  return value / len;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let fishCount = u32(params.dragAndCount.z);
  if (i >= fishCount) {
    return;
  }

  var fish = srcFish[i];
  let dragIndex = i32(params.extra.x);
  let dragActive = u32(params.dragAndCount.w);
  let dragPos = params.dragAndCount.xy;
  if (dragActive == 1u && dragIndex >= 0 && i == u32(dragIndex)) {
    fish.position = dragPos;
    fish.velocity = vec2f(0.0, 0.0);
    dstFish[i] = fish;
    return;
  }

  var separation = vec2f(0.0, 0.0);
  var alignment = vec2f(0.0, 0.0);
  var cohesion = vec2f(0.0, 0.0);
  var neighbors = 0.0;

  for (var j: u32 = 0u; j < fishCount; j = j + 1u) {
    if (j == i) {
      continue;
    }
    let other = srcFish[j];
    let delta = fish.position - other.position;
    let distSq = max(dot(delta, delta), 0.0001);
    let dist = sqrt(distSq);

    if (dist < 132.0) {
      neighbors = neighbors + 1.0;
      alignment = alignment + other.velocity;
      cohesion = cohesion + other.position;
      if (dist < 40.0) {
        separation = separation + safeNormalize(delta) * (40.0 - dist) / 40.0;
      }
    }
  }

  var accel = vec2f(0.0, 0.0);
  if (neighbors > 0.0) {
    let alignDir = safeNormalize(alignment / neighbors);
    let cohesionDir = safeNormalize((cohesion / neighbors) - fish.position);
    accel = accel + alignDir * 0.64;
    accel = accel + cohesionDir * 0.46;
  }

  accel = accel + safeNormalize(separation) * 1.95;
  accel = accel + safeNormalize(fish.home - fish.position) * 0.34;

  if (dragActive == 1u) {
    let dragDelta = fish.position - dragPos;
    let dragDist = length(dragDelta);
    if (dragDist < 156.0) {
      accel = accel + safeNormalize(dragDelta) * (1.0 - dragDist / 156.0) * 2.8;
    }
  }

  var velocity = fish.velocity + accel * params.worldAndTime.z * 60.0;
  let speed = length(velocity);
  let minSpeed = 12.0;
  let maxSpeed = 90.0;

  if (speed > maxSpeed) {
    velocity = safeNormalize(velocity) * maxSpeed;
  }
  if (speed < minSpeed && speed > 0.0001) {
    velocity = safeNormalize(velocity) * minSpeed;
  }
  if (speed <= 0.0001) {
    let angle = f32(i) * 0.73 + params.worldAndTime.w * 0.11;
    velocity = vec2f(cos(angle), sin(angle)) * minSpeed;
  }

  var position = fish.position + velocity * params.worldAndTime.z * 18.0;
  let margin = 12.0;
  if (position.x < margin) {
    position.x = margin;
    velocity.x = abs(velocity.x) * 0.7;
  }
  if (position.x > params.worldAndTime.x - margin) {
    position.x = params.worldAndTime.x - margin;
    velocity.x = -abs(velocity.x) * 0.7;
  }
  if (position.y < margin) {
    position.y = margin;
    velocity.y = abs(velocity.y) * 0.7;
  }
  if (position.y > params.worldAndTime.y - margin) {
    position.y = params.worldAndTime.y - margin;
    velocity.y = -abs(velocity.y) * 0.7;
  }

  fish.position = position;
  fish.velocity = velocity;
  dstFish[i] = fish;
}
`;

const GPU_RENDER_SHADER = `
struct Fish {
  position: vec2f,
  velocity: vec2f,
  home: vec2f,
  size: f32,
  pad0: f32,
  color: vec4f,
}

struct RenderParams {
  resolution: vec2f,
  viewOrigin: vec2f,
  scale: f32,
  pixelRatio: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@group(0) @binding(0) var<storage, read> fishData: array<Fish>;
@group(0) @binding(1) var<uniform> params: RenderParams;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let fish = fishData[instanceIndex];
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0),
  );

  let renderScale = params.scale * params.pixelRatio;
  let center = (fish.position - params.viewOrigin) * renderScale;
  let size = max(4.0, round(fish.size * renderScale));
  let position = center + corners[vertexIndex] * size;
  let clip = (position / params.resolution) * 2.0 - vec2f(1.0, 1.0);

  var out: VertexOut;
  out.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
  out.color = fish.color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb, 1.0);
}
`;

type ScenePoint = {
  key: string;
  client: ClientItem;
  label: string;
  meta: string;
  runtimeID: string;
  runtimeIndex: number;
  runtimeCount: number;
  runtimeSeed: number;
  workspace: string;
  workspaceGroup: string;
  workspaceIndex: number;
  workspaceCount: number;
  workspaceSeed: number;
  clientIndex: number;
  clientCount: number;
  seed: number;
  size: number;
  color: readonly [number, number, number];
  phase: number;
  speed: number;
  spin: number;
};

type SceneModel = {
  world: { width: number; height: number };
  runtimeKeys: string[];
  runtimePositions: Record<string, CardPosition>;
  workspaceKeys: string[];
  workspacePositions: Record<string, CardPosition>;
  runtimeMeta: Record<string, RuntimeMeta>;
  workspaceBubbles: WorkspaceBubble[];
};

type LayoutSnapshot = {
  model: SceneModel;
  scale: number;
  viewRect: { x: number; y: number; width: number; height: number };
};

type GlResources = {
  gl: WebGLRenderingContext;
  pointProgram: WebGLProgram;
  pointBuffer: WebGLBuffer;
  pointResolutionLocation: WebGLUniformLocation | null;
  pointPositionLocation: number;
  pointSizeLocation: number;
  pointColorLocation: number;
  bubbleProgram: WebGLProgram;
  bubbleBuffer: WebGLBuffer;
  bubbleResolutionLocation: WebGLUniformLocation | null;
  bubbleCenterLocation: number;
  bubbleRadiusLocation: number;
  bubbleCornerLocation: number;
  bubbleColorLocation: number;
  bubbleSeedLocation: number;
  bubbleDensityLocation: number;
};

type RuntimeMeta = {
  runtimeID: string;
  runtimeIndex: number;
  runtimeCount: number;
  runtimeSeed: number;
};

type WorkspaceBubble = {
  workspaceGroup: string;
  runtimeID: string;
  workspace: string;
  workspaceIndex: number;
  workspaceCount: number;
  workspaceSeed: number;
  clientCount: number;
  color: readonly [number, number, number];
};

type WebGpuBuffer = {
  destroy?: () => void;
  getMappedRange: () => ArrayBuffer;
  mapAsync: (mode: number) => Promise<void>;
  unmap: () => void;
};

type WebGpuComputePass = {
  dispatchWorkgroups: (count: number) => void;
  end: () => void;
  setBindGroup: (index: number, bindGroup: unknown) => void;
  setPipeline: (pipeline: WebGpuComputePipeline) => void;
};

type WebGpuCommandEncoder = {
  beginComputePass: () => WebGpuComputePass;
  beginRenderPass: (descriptor: {
    colorAttachments: Array<{
      clearValue: { r: number; g: number; b: number; a: number };
      loadOp: "clear";
      storeOp: "store";
      view: unknown;
    }>;
  }) => {
    draw: (vertexCount: number, instanceCount?: number) => void;
    end: () => void;
    setBindGroup: (index: number, bindGroup: unknown) => void;
    setPipeline: (pipeline: WebGpuRenderPipeline) => void;
  };
  copyBufferToBuffer: (source: WebGpuBuffer, sourceOffset: number, target: WebGpuBuffer, targetOffset: number, size: number) => void;
  finish: () => unknown;
};

type WebGpuComputePipeline = {
  getBindGroupLayout: (index: number) => unknown;
};

type WebGpuRenderPipeline = {
  getBindGroupLayout: (index: number) => unknown;
};

type WebGpuTexture = {
  createView: () => unknown;
};

type WebGpuCanvasContext = {
  configure: (descriptor: { alphaMode: "premultiplied" | "opaque"; device: WebGpuDevice; format: string }) => void;
  getCurrentTexture: () => WebGpuTexture;
};

type WebGpuDevice = {
  createBindGroup: (descriptor: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: WebGpuBuffer } }> }) => unknown;
  createBuffer: (descriptor: { size: number; usage: number }) => WebGpuBuffer;
  createCommandEncoder: () => WebGpuCommandEncoder;
  createComputePipeline: (descriptor: { layout: "auto"; compute: { module: unknown; entryPoint: string } }) => WebGpuComputePipeline;
  createRenderPipeline: (descriptor: {
    layout: "auto";
    vertex: { buffers?: []; entryPoint: string; module: unknown };
    fragment: { entryPoint: string; module: unknown; targets: Array<{ format: string }> };
    primitive: { topology: "triangle-list" };
  }) => WebGpuRenderPipeline;
  createShaderModule: (descriptor: { code: string }) => unknown;
  queue: {
    submit: (commands: unknown[]) => void;
    writeBuffer: (buffer: WebGpuBuffer, offset: number, data: BufferSource) => void;
  };
};

type WebGpuAdapter = {
  requestDevice: () => Promise<WebGpuDevice>;
};

type WebGpuNavigator = Navigator & {
  gpu?: {
    getPreferredCanvasFormat?: () => string;
    requestAdapter: () => Promise<WebGpuAdapter | null>;
  };
};

const WGPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
};

const WGPU_MAP_MODE_READ = 0x0001;

type RenderedPoint = {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  pointSize: number;
};

type DragState = {
  key: string;
  offsetX: number;
  offsetY: number;
};

const EMPTY_MODEL: SceneModel = {
  world: { width: 1200, height: 800 },
  runtimeKeys: [],
  runtimePositions: {},
  workspaceKeys: [],
  workspacePositions: {},
  runtimeMeta: {},
  workspaceBubbles: [],
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return {
    program,
    resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
    positionLocation: gl.getAttribLocation(program, "a_position"),
    sizeLocation: gl.getAttribLocation(program, "a_size"),
    colorLocation: gl.getAttribLocation(program, "a_color"),
  };
}

function createBubbleProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, BUBBLE_VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, BUBBLE_FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return {
    program,
    resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
    centerLocation: gl.getAttribLocation(program, "a_center"),
    radiusLocation: gl.getAttribLocation(program, "a_radius"),
    cornerLocation: gl.getAttribLocation(program, "a_corner"),
    colorLocation: gl.getAttribLocation(program, "a_color"),
    seedLocation: gl.getAttribLocation(program, "a_seed"),
    densityLocation: gl.getAttribLocation(program, "a_density"),
  };
}

function hslToRgbUnit(h: number, s: number, l: number): readonly [number, number, number] {
  if (s === 0) return [l, l, l] as const;

  const hue2rgb = (p: number, q: number, t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1 / 3),
  ] as const;
}

function bubbleColorFromSeed(seed: number): readonly [number, number, number] {
  const hue = (seed % 360) / 360;
  const saturation = 0.54 + ((seed >> 3) % 18) / 100;
  const lightness = 0.46 + ((seed >> 7) % 12) / 100;
  return hslToRgbUnit(hue, saturation, lightness);
}

function toRgbUnit(hex: string): readonly [number, number, number] {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((part) => `${part}${part}`).join("") : clean;
  const parsed = Number.parseInt(value, 16);
  return [
    ((parsed >> 16) & 0xff) / 255,
    ((parsed >> 8) & 0xff) / 255,
    (parsed & 0xff) / 255,
  ] as const;
}

function buildScenePoints(clients: ClientItem[]): ScenePoint[] {
  const grouped = new Map<string, Map<string, ClientItem[]>>();

  [...clients]
    .sort((a, b) => cardKey(a).localeCompare(cardKey(b)))
    .forEach((client) => {
      const runtimeID = runtimeKey(client);
      const runtime = grouped.get(runtimeID) || new Map<string, ClientItem[]>();
      const workspaceID = workspaceGroupKey(client);
      const workspace = runtime.get(workspaceID) || [];
      workspace.push(client);
      runtime.set(workspaceID, workspace);
      grouped.set(runtimeID, runtime);
    });

  const runtimeEntries = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const runtimeCount = runtimeEntries.length || 1;
  const points: ScenePoint[] = [];

  runtimeEntries.forEach(([runtimeID, workspaces], runtimeIndex) => {
    const workspaceEntries = [...workspaces.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const workspaceCount = workspaceEntries.length || 1;
    const runtimeSeed = simpleHash(runtimeID);

    workspaceEntries.forEach(([workspaceGroup, members], workspaceIndex) => {
      const workspace = workspaceKey(members[0]);
      const workspaceSeed = simpleHash(`${runtimeID}:${workspace}`);
      const clientCount = members.length || 1;

      members.forEach((client, clientIndex) => {
        const key = cardKey(client);
        const seed = simpleHash(key);
        points.push({
          key,
          client,
          label: displayTitle(client),
          meta: `${shortRuntimeLabel(runtimeID)} · ${workspaceLabel(client.workspace)}`,
          runtimeID,
          runtimeIndex,
          runtimeCount,
          runtimeSeed,
          workspace,
          workspaceGroup,
          workspaceIndex,
          workspaceCount,
          workspaceSeed,
          clientIndex,
          clientCount,
          seed,
          size: client.displayID ? (client.synthetic ? 8 : 10) : (client.synthetic ? 5 : 7),
          color: toRgbUnit(sessionLampColor(client.sessionStatus, client.status)),
          phase: (seed % 360) * (Math.PI / 180),
          speed: 0.38 + (seed % 11) * 0.03,
          spin: seed % 2 === 0 ? 1 : -1,
        });
      });
    });
  });

  return points;
}

function buildSceneModel(scene: ScenePoint[], width: number, height: number): SceneModel {
  const runtimeCount = Math.max(1, Math.max(0, ...scene.map((point) => point.runtimeCount)));
  const workspaceCount = Math.max(1, Math.max(0, ...scene.map((point) => point.workspaceCount)));
  const baseWorld = worldSize(width || 1200, height || 800, runtimeCount, workspaceCount);
  const world = {
    width: Math.round(baseWorld.width * 1.2),
    height: Math.round(baseWorld.height * 1.18),
  };

  const runtimeSeen = new Map<string, ScenePoint>();
  const workspaceSeen = new Map<string, ScenePoint>();
  const runtimeMeta: Record<string, RuntimeMeta> = {};
  scene.forEach((point) => {
    if (!runtimeSeen.has(point.runtimeID)) {
      runtimeSeen.set(point.runtimeID, point);
      runtimeMeta[point.runtimeID] = {
        runtimeID: point.runtimeID,
        runtimeIndex: point.runtimeIndex,
        runtimeCount: point.runtimeCount,
        runtimeSeed: point.runtimeSeed,
      };
    }
    if (!workspaceSeen.has(point.workspaceGroup)) workspaceSeen.set(point.workspaceGroup, point);
  });

  const runtimeKeys = [...runtimeSeen.keys()].sort((a, b) => a.localeCompare(b));
  const runtimePositions: Record<string, CardPosition> = {};
  runtimeKeys.forEach((runtimeID) => {
    const point = runtimeSeen.get(runtimeID);
    if (!point) return;
    runtimePositions[runtimeID] = runtimeTarget(runtimeID, point.runtimeIndex, point.runtimeCount, world.width, world.height);
  });

  const workspaceKeys = [...workspaceSeen.keys()].sort((a, b) => a.localeCompare(b));
  const workspacePositions: Record<string, CardPosition> = {};
  const workspaceBubbles: WorkspaceBubble[] = [];
  workspaceKeys.forEach((workspaceGroup) => {
    const point = workspaceSeen.get(workspaceGroup);
    if (!point) return;
    const runtimeAnchor = runtimePositions[point.runtimeID] || runtimeTarget(point.runtimeID, point.runtimeIndex, point.runtimeCount, world.width, world.height);
    const base = workspaceTargetInRuntime(
      point.workspace,
      point.runtimeID,
      runtimeAnchor,
      point.workspaceIndex,
      point.workspaceCount,
      world.width,
      world.height,
    );
    workspacePositions[workspaceGroup] = {
      x: runtimeAnchor.x + (base.x - runtimeAnchor.x) * 1.35,
      y: runtimeAnchor.y + (base.y - runtimeAnchor.y) * 1.28,
    };
    workspaceBubbles.push({
      workspaceGroup,
      runtimeID: point.runtimeID,
      workspace: point.workspace,
      workspaceIndex: point.workspaceIndex,
      workspaceCount: point.workspaceCount,
      workspaceSeed: point.workspaceSeed,
      clientCount: point.clientCount,
      color: bubbleColorFromSeed(point.workspaceSeed),
    });
  });

  return {
    world,
    runtimeKeys,
    runtimePositions,
    workspaceKeys,
    workspacePositions,
    runtimeMeta,
    workspaceBubbles,
  };
}

function clampViewOrigin(origin: CardPosition, viewWidth: number, viewHeight: number, worldWidth: number, worldHeight: number): CardPosition {
  return {
    x: clamp(origin.x, 0, Math.max(0, worldWidth - viewWidth)),
    y: clamp(origin.y, 0, Math.max(0, worldHeight - viewHeight)),
  };
}

function clampPointWorld(position: CardPosition, worldWidth: number, worldHeight: number) {
  return {
    x: clamp(position.x, 4, Math.max(4, worldWidth - 4)),
    y: clamp(position.y, 4, Math.max(4, worldHeight - 4)),
  };
}

function samePosition(a: CardPosition, b: CardPosition) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

export function ShoalPointField({
  clients,
  dark,
  scale,
  onScaleChange,
}: {
  clients: ClientItem[];
  dark: boolean;
  scale: number;
  onScaleChange: (value: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const sceneRef = useRef<ScenePoint[]>([]);
  const layoutRef = useRef<LayoutSnapshot>({ model: EMPTY_MODEL, scale, viewRect: { x: 0, y: 0, width: 1200, height: 800 } });
  const darkRef = useRef(dark);
  const renderedPointsRef = useRef<Record<string, RenderedPoint>>({});
  const manualPointRef = useRef<Record<string, CardPosition>>({});
  const gpuPositionsRef = useRef<Record<string, CardPosition>>({});
  const gpuEnabledRef = useRef(false);
  const dragWorldRef = useRef<CardPosition | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewOriginRef = useRef<CardPosition>({ x: 0, y: 0 });
  const hoveredKeyRef = useRef("");
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const manualViewRef = useRef(false);

  const [fps, setFps] = useState(0);
  const [unsupported, setUnsupported] = useState(false);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [viewOrigin, setViewOrigin] = useState<CardPosition>({ x: 0, y: 0 });
  const [draggingKey, setDraggingKey] = useState("");
  const [hoveredKey, setHoveredKey] = useState("");

  const scene = useMemo(() => buildScenePoints(clients), [clients]);
  const model = useMemo(() => buildSceneModel(scene, hostSize.width || 1200, hostSize.height || 800), [hostSize.height, hostSize.width, scene]);
  const viewSize = useMemo(() => ({
    width: Math.min(model.world.width, Math.max(1, (hostSize.width || 1200) / scale)),
    height: Math.min(model.world.height, Math.max(1, (hostSize.height || 800) / scale)),
  }), [hostSize.height, hostSize.width, model.world.height, model.world.width, scale]);
  const viewRect = useMemo(() => ({ x: viewOrigin.x, y: viewOrigin.y, width: viewSize.width, height: viewSize.height }), [viewOrigin.x, viewOrigin.y, viewSize.height, viewSize.width]);
  const hoveredPoint = useMemo(
    () => scene.find((point) => point.key === hoveredKey) || null,
    [hoveredKey, scene],
  );

  const updateViewOrigin = useCallback((next: CardPosition, manual = true) => {
    if (manual) manualViewRef.current = true;
    setViewOrigin((current) => {
      const clamped = clampViewOrigin(next, viewSize.width, viewSize.height, model.world.width, model.world.height);
      return samePosition(current, clamped) ? current : clamped;
    });
  }, [model.world.height, model.world.width, viewSize.height, viewSize.width]);

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    const layout = layoutRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const localX = clamp(clientX - rect.left, 0, rect.width);
    const localY = clamp(clientY - rect.top, 0, rect.height);
    return {
      x: layout.viewRect.x + localX / Math.max(layout.scale, 0.0001),
      y: layout.viewRect.y + localY / Math.max(layout.scale, 0.0001),
    };
  }, []);

  const startDragByKey = useCallback((key: string, clientX: number, clientY: number) => {
    const rendered = renderedPointsRef.current[key];
    const world = clientToWorld(clientX, clientY);
    if (!rendered || !world) return false;
    dragRef.current = {
      key,
      offsetX: world.x - rendered.worldX,
      offsetY: world.y - rendered.worldY,
    };
    setDraggingKey(key);
    return true;
  }, [clientToWorld]);

  const pickPointByScreen = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    let bestKey = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    Object.entries(renderedPointsRef.current).forEach(([key, point]) => {
      const dx = localX - point.screenX;
      const dy = localY - point.screenY;
      const distance = Math.hypot(dx, dy);
      const limit = Math.max(12, point.pointSize * 1.5);
      if (distance <= limit && distance < bestDistance) {
        bestKey = key;
        bestDistance = distance;
      }
    });

    return bestKey || null;
  }, []);

  const handleLabelPointerDown = useCallback((key: string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHoveredKey("");
    startDragByKey(key, event.clientX, event.clientY);
  }, [startDragByKey]);

  const handleFieldPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest(".nancy-scale-panel")) return;
    const key = pickPointByScreen(event.clientX, event.clientY);
    if (!key) return;
    event.preventDefault();
    setHoveredKey("");
    startDragByKey(key, event.clientX, event.clientY);
  }, [pickPointByScreen, startDragByKey]);

  const handleFieldPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const key = pickPointByScreen(event.clientX, event.clientY) || "";
    setHoveredKey((current) => (current === key ? current : key));
  }, [pickPointByScreen]);

  const handleFieldPointerLeave = useCallback(() => {
    if (dragRef.current) return;
    setHoveredKey("");
  }, []);

  const handleMinimapPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const minimap = minimapRef.current;
    if (!minimap) return;
    event.preventDefault();

    const rect = minimap.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const viewX = (viewOriginRef.current.x / model.world.width) * rect.width;
    const viewY = (viewOriginRef.current.y / model.world.height) * rect.height;
    const viewW = (viewSize.width / model.world.width) * rect.width;
    const viewH = (viewSize.height / model.world.height) * rect.height;
    const insideView = localX >= viewX && localX <= viewX + viewW && localY >= viewY && localY <= viewY + viewH;
    const offsetX = insideView ? localX - viewX : viewW / 2;
    const offsetY = insideView ? localY - viewY : viewH / 2;

    const apply = (clientX: number, clientY: number) => {
      const nx = clamp(clientX - rect.left - offsetX, 0, rect.width);
      const ny = clamp(clientY - rect.top - offsetY, 0, rect.height);
      updateViewOrigin({
        x: (nx / rect.width) * model.world.width,
        y: (ny / rect.height) * model.world.height,
      });
    };

    apply(event.clientX, event.clientY);

    const onMove = (moveEvent: PointerEvent) => apply(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [model.world.height, model.world.width, updateViewOrigin, viewSize.height, viewSize.width]);

  useEffect(() => {
    sceneRef.current = scene;
    const active = new Set(scene.map((point) => point.key));
    Object.keys(manualPointRef.current).forEach((key) => {
      if (!active.has(key)) delete manualPointRef.current[key];
    });
    Object.keys(gpuPositionsRef.current).forEach((key) => {
      if (!active.has(key)) delete gpuPositionsRef.current[key];
    });
    Object.keys(renderedPointsRef.current).forEach((key) => {
      if (!active.has(key)) delete renderedPointsRef.current[key];
    });
  }, [scene]);

  useEffect(() => {
    darkRef.current = dark;
  }, [dark]);

  useEffect(() => {
    hoveredKeyRef.current = hoveredKey;
  }, [hoveredKey]);

  useEffect(() => {
    viewOriginRef.current = viewOrigin;
  }, [viewOrigin]);

  useEffect(() => {
    layoutRef.current = { model, scale, viewRect };
  }, [model, scale, viewRect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      setHostSize({
        width: Math.max(1, Math.round(host.clientWidth)),
        height: Math.max(1, Math.round(host.clientHeight)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const centered = {
      x: Math.max(0, (model.world.width - viewSize.width) / 2),
      y: Math.max(0, (model.world.height - viewSize.height) / 2),
    };

    setViewOrigin((current) => {
      const next = manualViewRef.current ? current : centered;
      const clamped = clampViewOrigin(next, viewSize.width, viewSize.height, model.world.width, model.world.height);
      return samePosition(current, clamped) ? current : clamped;
    });
  }, [model.world.height, model.world.width, viewSize.height, viewSize.width]);

  useEffect(() => {
    gpuEnabledRef.current = false;
    gpuPositionsRef.current = {};

    let cancelled = false;
    let frame = 0;
    let readbackBusy = false;
    let currentIndex = 0;
    let lastTick = performance.now();
    let lastReadback = 0;

    const start = async () => {
      if (typeof navigator === "undefined" || !("gpu" in navigator)) {
        return;
      }

      const nav = navigator as WebGpuNavigator;
      const gpuCanvas = gpuCanvasRef.current;
      if (!nav.gpu || scene.length === 0 || !gpuCanvas) {
        return;
      }
      const context = gpuCanvas.getContext("webgpu") as unknown as WebGpuCanvasContext | null;
      if (!context) {
        return;
      }

      const adapter = await nav.gpu.requestAdapter();
      if (!adapter || cancelled) {
        return;
      }
      const device = await adapter.requestDevice();
      if (cancelled) {
        return;
      }

      const fishStride = 12;
      const initial = new Float32Array(scene.length * fishStride);
      const keyByIndex: string[] = [];
      const indexByKey = new Map<string, number>();

      scene.forEach((point, index) => {
        const runtimeBase = model.runtimePositions[point.runtimeID] || runtimeTarget(
          point.runtimeID,
          point.runtimeIndex,
          point.runtimeCount,
          model.world.width,
          model.world.height,
        );
        const runtimeAnchor = {
          x: runtimeBase.x + Math.cos(point.runtimeSeed * 0.011) * 20,
          y: runtimeBase.y + Math.sin(point.runtimeSeed * 0.009) * 16,
        };
        const workspaceBase = model.workspacePositions[point.workspaceGroup] || workspaceTargetInRuntime(
          point.workspace,
          point.runtimeID,
          runtimeAnchor,
          point.workspaceIndex,
          point.workspaceCount,
          model.world.width,
          model.world.height,
        );
        const workspaceAnchor = {
          x: workspaceBase.x + Math.cos(point.workspaceSeed * 0.013) * 12,
          y: workspaceBase.y + Math.sin(point.workspaceSeed * 0.01) * 10,
        };
        const orbitRing = Math.floor(point.clientIndex / 6);
        const orbitRadius = 26 + orbitRing * 19 + (point.seed % 7) * 3.2;
        const orbitAngle = point.phase + (point.clientIndex / Math.max(1, point.clientCount)) * Math.PI * 2;
        const base = index * fishStride;
        initial[base] = workspaceAnchor.x + Math.cos(orbitAngle) * orbitRadius;
        initial[base + 1] = workspaceAnchor.y + Math.sin(orbitAngle) * orbitRadius * 0.82;
        initial[base + 2] = Math.cos(point.phase + 0.4) * 18;
        initial[base + 3] = Math.sin(point.phase + 0.9) * 18;
        initial[base + 4] = workspaceAnchor.x;
        initial[base + 5] = workspaceAnchor.y;
        initial[base + 6] = point.size;
        initial[base + 7] = 0;
        initial[base + 8] = point.color[0];
        initial[base + 9] = point.color[1];
        initial[base + 10] = point.color[2];
        initial[base + 11] = 1;
        keyByIndex.push(point.key);
        indexByKey.set(point.key, index);
      });

      const buffers = [0, 1].map(() => device.createBuffer({
        size: initial.byteLength,
        usage: WGPU_BUFFER_USAGE.STORAGE | WGPU_BUFFER_USAGE.COPY_SRC | WGPU_BUFFER_USAGE.COPY_DST,
      }));
      device.queue.writeBuffer(buffers[0], 0, initial);
      device.queue.writeBuffer(buffers[1], 0, initial);

      const paramBuffer = device.createBuffer({
        size: 48,
        usage: WGPU_BUFFER_USAGE.UNIFORM | WGPU_BUFFER_USAGE.COPY_DST,
      });
      const readbackBuffer = device.createBuffer({
        size: initial.byteLength,
        usage: WGPU_BUFFER_USAGE.COPY_DST | WGPU_BUFFER_USAGE.MAP_READ,
      });
      const renderParamBuffer = device.createBuffer({
        size: 32,
        usage: WGPU_BUFFER_USAGE.UNIFORM | WGPU_BUFFER_USAGE.COPY_DST,
      });

      const computeModule = device.createShaderModule({ code: GPU_SIM_SHADER });
      const computePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: computeModule, entryPoint: "main" },
      });
      const bindGroups = [0, 1].map((index) => device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers[index] } },
          { binding: 1, resource: { buffer: buffers[1 - index] } },
          { binding: 2, resource: { buffer: paramBuffer } },
        ],
      }));

      const renderModule = device.createShaderModule({ code: GPU_RENDER_SHADER });
      const canvasFormat = nav.gpu.getPreferredCanvasFormat?.() || "bgra8unorm";
      const renderPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { entryPoint: "vs_main", module: renderModule },
        fragment: { entryPoint: "fs_main", module: renderModule, targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" },
      });
      const renderBindGroups = [0, 1].map((index) => device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers[index] } },
          { binding: 1, resource: { buffer: renderParamBuffer } },
        ],
      }));

      let configuredWidth = 0;
      let configuredHeight = 0;
      const syncGpuCanvas = () => {
        const host = hostRef.current;
        if (!host) return { dpr: 1, height: 1, width: 1 };
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.round(host.clientWidth));
        const height = Math.max(1, Math.round(host.clientHeight));
        const displayWidth = Math.max(1, Math.round(width * dpr));
        const displayHeight = Math.max(1, Math.round(height * dpr));
        if (gpuCanvas.width !== displayWidth || gpuCanvas.height !== displayHeight) {
          gpuCanvas.width = displayWidth;
          gpuCanvas.height = displayHeight;
        }
        if (configuredWidth !== displayWidth || configuredHeight !== displayHeight) {
          context.configure({
            alphaMode: "premultiplied",
            device,
            format: canvasFormat,
          });
          configuredWidth = displayWidth;
          configuredHeight = displayHeight;
        }
        return { width, height, dpr };
      };

      gpuEnabledRef.current = true;

      const readBackPositions = async (source: WebGpuBuffer) => {
        if (readbackBusy || cancelled) return;
        readbackBusy = true;
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(source, 0, readbackBuffer, 0, initial.byteLength);
          device.queue.submit([encoder.finish()]);
          await readbackBuffer.mapAsync(WGPU_MAP_MODE_READ);
          if (cancelled) {
            readbackBuffer.unmap();
            return;
          }
          const raw = readbackBuffer.getMappedRange();
          const copy = new Float32Array(raw.slice(0));
          readbackBuffer.unmap();

          const next: Record<string, CardPosition> = {};
          for (let index = 0; index < keyByIndex.length; index += 1) {
            const base = index * fishStride;
            next[keyByIndex[index]] = { x: copy[base], y: copy[base + 1] };
          }
          gpuPositionsRef.current = next;
        } finally {
          readbackBusy = false;
        }
      };

      const tick = (now: number) => {
        if (cancelled) return;
        const deltaTime = Math.min(0.05, Math.max(0.008, (now - lastTick) / 1000));
        lastTick = now;
        const { dpr } = syncGpuCanvas();
        const drag = dragRef.current;
        const dragKey = drag?.key || "";
        const dragIndex = dragKey ? (indexByKey.get(dragKey) ?? -1) : -1;
        const dragPos = dragIndex >= 0 && dragWorldRef.current ? dragWorldRef.current : null;

        const params = new ArrayBuffer(48);
        const f32 = new Float32Array(params);
        f32[0] = model.world.width;
        f32[1] = model.world.height;
        f32[2] = deltaTime;
        f32[3] = now * 0.001;
        f32[4] = dragPos?.x ?? 0;
        f32[5] = dragPos?.y ?? 0;
        f32[6] = scene.length;
        f32[7] = dragPos ? 1 : 0;
        f32[8] = dragIndex;
        device.queue.writeBuffer(paramBuffer, 0, params);

        const renderParams = new Float32Array(8);
        renderParams[0] = gpuCanvas.width;
        renderParams[1] = gpuCanvas.height;
        renderParams[2] = viewOriginRef.current.x;
        renderParams[3] = viewOriginRef.current.y;
        renderParams[4] = layoutRef.current.scale;
        renderParams[5] = dpr;
        device.queue.writeBuffer(renderParamBuffer, 0, renderParams);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, bindGroups[currentIndex]);
        pass.dispatchWorkgroups(Math.ceil(scene.length / 64));
        pass.end();

        const nextIndex = 1 - currentIndex;
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
              view: context.getCurrentTexture().createView(),
            },
          ],
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroups[nextIndex]);
        renderPass.draw(6, scene.length);
        renderPass.end();
        device.queue.submit([encoder.finish()]);

        currentIndex = nextIndex;
        if (now - lastReadback > 120) {
          lastReadback = now;
          void readBackPositions(buffers[currentIndex]);
        }

        frame = window.requestAnimationFrame(tick);
      };

      void readBackPositions(buffers[currentIndex]);
      frame = window.requestAnimationFrame(tick);
    };

    void start();

    return () => {
      cancelled = true;
      gpuEnabledRef.current = false;
      dragWorldRef.current = null;
      window.cancelAnimationFrame(frame);
    };
  }, [model, scene]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const next = clampPointWorld(
        {
          x: world.x - drag.offsetX,
          y: world.y - drag.offsetY,
        },
        layoutRef.current.model.world.width,
        layoutRef.current.model.world.height,
      );
      if (gpuEnabledRef.current) {
        dragWorldRef.current = next;
      } else {
        manualPointRef.current[drag.key] = next;
      }
    };

    const onUp = () => {
      dragRef.current = null;
      dragWorldRef.current = null;
      setDraggingKey("");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [clientToWorld]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const gl = (canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;

    if (!gl) {
      setUnsupported(true);
      return;
    }

    const pointProgramInfo = createProgram(gl);
    const bubbleProgramInfo = createBubbleProgram(gl);
    const pointBuffer = gl.createBuffer();
    const bubbleBuffer = gl.createBuffer();
    if (!pointProgramInfo || !bubbleProgramInfo || !pointBuffer || !bubbleBuffer) {
      setUnsupported(true);
      if (pointBuffer) gl.deleteBuffer(pointBuffer);
      if (bubbleBuffer) gl.deleteBuffer(bubbleBuffer);
      if (pointProgramInfo) gl.deleteProgram(pointProgramInfo.program);
      if (bubbleProgramInfo) gl.deleteProgram(bubbleProgramInfo.program);
      return;
    }

    const resources: GlResources = {
      gl,
      pointProgram: pointProgramInfo.program,
      pointBuffer,
      pointResolutionLocation: pointProgramInfo.resolutionLocation,
      pointPositionLocation: pointProgramInfo.positionLocation,
      pointSizeLocation: pointProgramInfo.sizeLocation,
      pointColorLocation: pointProgramInfo.colorLocation,
      bubbleProgram: bubbleProgramInfo.program,
      bubbleBuffer,
      bubbleResolutionLocation: bubbleProgramInfo.resolutionLocation,
      bubbleCenterLocation: bubbleProgramInfo.centerLocation,
      bubbleRadiusLocation: bubbleProgramInfo.radiusLocation,
      bubbleCornerLocation: bubbleProgramInfo.cornerLocation,
      bubbleColorLocation: bubbleProgramInfo.colorLocation,
      bubbleSeedLocation: bubbleProgramInfo.seedLocation,
      bubbleDensityLocation: bubbleProgramInfo.densityLocation,
    };

    gl.disable(gl.DITHER);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let disposed = false;
    let frame = 0;
    let fpsClock = performance.now();
    let fpsCount = 0;

    const resizeCanvas = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(host.clientWidth));
      const height = Math.max(1, Math.round(host.clientHeight));
      const displayWidth = Math.max(1, Math.round(width * dpr));
      const displayHeight = Math.max(1, Math.round(height * dpr));

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        gl.viewport(0, 0, displayWidth, displayHeight);
      }

      return { width, height, dpr };
    };

    const render = (now: number) => {
      if (disposed) return;

      const { width, height, dpr } = resizeCanvas();
      const points = sceneRef.current;
      const activeLayout = layoutRef.current;
      const data = new Float32Array(points.length * 6);
      const bubbleData = new Float32Array(activeLayout.model.workspaceBubbles.length * QUAD_CORNERS.length * 11 / 2);
      const nextRendered: Record<string, RenderedPoint> = {};
      const runtimeAnimated: Record<string, CardPosition> = {};
      const workspaceAnimated: Record<string, CardPosition> = {};
      const time = now * 0.001;
      let bubbleVertexCount = 0;

      fpsCount += 1;
      if (now - fpsClock >= 500) {
        setFps(Math.round((fpsCount * 1000) / (now - fpsClock)));
        fpsClock = now;
        fpsCount = 0;
      }

      Object.values(activeLayout.model.runtimeMeta).forEach((runtimeMeta) => {
        const runtimeBase = activeLayout.model.runtimePositions[runtimeMeta.runtimeID] || runtimeTarget(
          runtimeMeta.runtimeID,
          runtimeMeta.runtimeIndex,
          runtimeMeta.runtimeCount,
          activeLayout.model.world.width,
          activeLayout.model.world.height,
        );
        runtimeAnimated[runtimeMeta.runtimeID] = {
          x: runtimeBase.x + Math.cos(time * 0.12 + runtimeMeta.runtimeSeed * 0.011) * 20,
          y: runtimeBase.y + Math.sin(time * 0.09 + runtimeMeta.runtimeSeed * 0.009) * 16,
        };
      });

      activeLayout.model.workspaceBubbles.forEach((bubble) => {
        const runtimeAnchor = runtimeAnimated[bubble.runtimeID]
          || activeLayout.model.runtimePositions[bubble.runtimeID]
          || runtimeTarget(bubble.runtimeID, 0, 1, activeLayout.model.world.width, activeLayout.model.world.height);
        const workspaceBase = activeLayout.model.workspacePositions[bubble.workspaceGroup] || workspaceTargetInRuntime(
          bubble.workspace,
          bubble.runtimeID,
          runtimeAnchor,
          bubble.workspaceIndex,
          bubble.workspaceCount,
          activeLayout.model.world.width,
          activeLayout.model.world.height,
        );
        const workspaceAnchor = {
          x: workspaceBase.x + Math.cos(time * 0.21 + bubble.workspaceSeed * 0.013) * 12,
          y: workspaceBase.y + Math.sin(time * 0.17 + bubble.workspaceSeed * 0.01) * 10,
        };
        workspaceAnimated[bubble.workspaceGroup] = workspaceAnchor;

        const orbitRing = Math.floor(Math.max(0, bubble.clientCount - 1) / 6);
        const radiusWorldX = 88 + orbitRing * 26 + Math.min(68, bubble.clientCount * 5.2);
        const radiusWorldY = 66 + orbitRing * 20 + Math.min(52, bubble.clientCount * 4.3);
        const screenCenterX = (workspaceAnchor.x - activeLayout.viewRect.x) * activeLayout.scale;
        const screenCenterY = (workspaceAnchor.y - activeLayout.viewRect.y) * activeLayout.scale;
        const screenRadiusX = Math.max(56, radiusWorldX * activeLayout.scale * (1 + Math.sin(time * 0.57 + bubble.workspaceSeed * 0.004) * 0.07));
        const screenRadiusY = Math.max(42, radiusWorldY * activeLayout.scale * (1 + Math.cos(time * 0.51 + bubble.workspaceSeed * 0.005) * 0.06));

        if (
          screenCenterX + screenRadiusX < -48
          || screenCenterY + screenRadiusY < -48
          || screenCenterX - screenRadiusX > width + 48
          || screenCenterY - screenRadiusY > height + 48
        ) {
          return;
        }

        const density = clamp(0.24 + bubble.clientCount / 10, 0.24, 1.2);
        const centerXdpr = screenCenterX * dpr;
        const centerYdpr = screenCenterY * dpr;
        const radiusXdpr = screenRadiusX * dpr;
        const radiusYdpr = screenRadiusY * dpr;

        for (let i = 0; i < QUAD_CORNERS.length; i += 2) {
          const offset = bubbleVertexCount * 11;
          bubbleData[offset] = centerXdpr;
          bubbleData[offset + 1] = centerYdpr;
          bubbleData[offset + 2] = radiusXdpr;
          bubbleData[offset + 3] = radiusYdpr;
          bubbleData[offset + 4] = QUAD_CORNERS[i];
          bubbleData[offset + 5] = QUAD_CORNERS[i + 1];
          bubbleData[offset + 6] = bubble.color[0];
          bubbleData[offset + 7] = bubble.color[1];
          bubbleData[offset + 8] = bubble.color[2];
          bubbleData[offset + 9] = bubble.workspaceSeed;
          bubbleData[offset + 10] = density;
          bubbleVertexCount += 1;
        }
      });

      points.forEach((point, index) => {
        const workspaceAnchor = workspaceAnimated[point.workspaceGroup]
          || activeLayout.model.workspacePositions[point.workspaceGroup]
          || { x: activeLayout.model.world.width / 2, y: activeLayout.model.world.height / 2 };

        const orbitRing = Math.floor(point.clientIndex / 6);
        const orbitRadius = 26 + orbitRing * 19 + (point.seed % 7) * 3.2;
        const orbitAngle = point.phase
          + (point.clientIndex / Math.max(1, point.clientCount)) * Math.PI * 2
          + time * point.speed * point.spin;

        const autoWorld = {
          x: workspaceAnchor.x + Math.cos(orbitAngle) * orbitRadius,
          y: workspaceAnchor.y + Math.sin(orbitAngle) * orbitRadius * 0.82,
        };
        const gpuWorld = gpuPositionsRef.current[point.key];
        const manual = gpuEnabledRef.current ? null : manualPointRef.current[point.key];
        const isDraggingPoint = dragRef.current?.key === point.key;
        let worldX = gpuWorld?.x ?? autoWorld.x;
        let worldY = gpuWorld?.y ?? autoWorld.y;

        if (manual) {
          if (isDraggingPoint) {
            worldX = manual.x;
            worldY = manual.y;
          } else {
            const relaxed = {
              x: lerp(manual.x, autoWorld.x, 0.06),
              y: lerp(manual.y, autoWorld.y, 0.06),
            };
            if (samePosition(relaxed, autoWorld)) {
              delete manualPointRef.current[point.key];
              worldX = autoWorld.x;
              worldY = autoWorld.y;
            } else {
              manualPointRef.current[point.key] = relaxed;
              worldX = relaxed.x;
              worldY = relaxed.y;
            }
          }
        }
        const screenX = Math.round((worldX - activeLayout.viewRect.x) * activeLayout.scale * dpr) / dpr;
        const screenY = Math.round((worldY - activeLayout.viewRect.y) * activeLayout.scale * dpr) / dpr;
        const pointSize = Math.max(4, Math.round(point.size * activeLayout.scale));

        const offset = index * 6;
        data[offset] = screenX * dpr;
        data[offset + 1] = screenY * dpr;
        data[offset + 2] = pointSize * dpr;
        data[offset + 3] = point.color[0];
        data[offset + 4] = point.color[1];
        data[offset + 5] = point.color[2];

        nextRendered[point.key] = { worldX, worldY, screenX, screenY, pointSize };

        const label = labelsRef.current[point.key];
        if (label) {
          const visible = screenX >= -52 && screenY >= -34 && screenX <= width + 52 && screenY <= height + 34;
          label.style.opacity = visible ? "1" : "0";
          label.style.transform = visible
            ? `translate3d(${Math.round(screenX + pointSize + 7)}px, ${Math.round(screenY - pointSize)}px, 0)`
            : "translate3d(-200vw, -200vh, 0)";
        }
      });

      renderedPointsRef.current = nextRendered;

      const hoverCard = hoverCardRef.current;
      const activeHoveredKey = hoveredKeyRef.current;
      if (hoverCard && activeHoveredKey && nextRendered[activeHoveredKey]) {
        const hovered = nextRendered[activeHoveredKey];
        hoverCard.style.opacity = "1";
        hoverCard.style.transform = `translate3d(${Math.round(hovered.screenX + hovered.pointSize + 12)}px, ${Math.round(hovered.screenY + hovered.pointSize + 12)}px, 0)`;
      } else if (hoverCard) {
        hoverCard.style.opacity = "0";
        hoverCard.style.transform = "translate3d(-200vw, -200vh, 0)";
      }

      gl.clearColor(
        darkRef.current ? 0.027 : 0.953,
        darkRef.current ? 0.041 : 0.972,
        darkRef.current ? 0.078 : 0.988,
        0,
      );
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (bubbleVertexCount > 0) {
        gl.useProgram(resources.bubbleProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.bubbleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, bubbleData, gl.DYNAMIC_DRAW);
        const bubbleStride = 11 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(resources.bubbleCenterLocation);
        gl.vertexAttribPointer(resources.bubbleCenterLocation, 2, gl.FLOAT, false, bubbleStride, 0);
        gl.enableVertexAttribArray(resources.bubbleRadiusLocation);
        gl.vertexAttribPointer(resources.bubbleRadiusLocation, 2, gl.FLOAT, false, bubbleStride, 2 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(resources.bubbleCornerLocation);
        gl.vertexAttribPointer(resources.bubbleCornerLocation, 2, gl.FLOAT, false, bubbleStride, 4 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(resources.bubbleColorLocation);
        gl.vertexAttribPointer(resources.bubbleColorLocation, 3, gl.FLOAT, false, bubbleStride, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(resources.bubbleSeedLocation);
        gl.vertexAttribPointer(resources.bubbleSeedLocation, 1, gl.FLOAT, false, bubbleStride, 9 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(resources.bubbleDensityLocation);
        gl.vertexAttribPointer(resources.bubbleDensityLocation, 1, gl.FLOAT, false, bubbleStride, 10 * Float32Array.BYTES_PER_ELEMENT);
        if (resources.bubbleResolutionLocation) {
          gl.uniform2f(resources.bubbleResolutionLocation, canvas.width, canvas.height);
        }
        gl.drawArrays(gl.TRIANGLES, 0, bubbleVertexCount);
      }

      if (!gpuEnabledRef.current) {
        gl.useProgram(resources.pointProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.pointBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        const pointStride = 6 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(resources.pointPositionLocation);
        gl.vertexAttribPointer(resources.pointPositionLocation, 2, gl.FLOAT, false, pointStride, 0);
        gl.enableVertexAttribArray(resources.pointSizeLocation);
        gl.vertexAttribPointer(resources.pointSizeLocation, 1, gl.FLOAT, false, pointStride, 2 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(resources.pointColorLocation);
        gl.vertexAttribPointer(resources.pointColorLocation, 3, gl.FLOAT, false, pointStride, 3 * Float32Array.BYTES_PER_ELEMENT);
        if (resources.pointResolutionLocation) {
          gl.uniform2f(resources.pointResolutionLocation, canvas.width, canvas.height);
        }
        gl.drawArrays(gl.POINTS, 0, points.length);
      }

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      gl.deleteBuffer(resources.pointBuffer);
      gl.deleteBuffer(resources.bubbleBuffer);
      gl.deleteProgram(resources.pointProgram);
      gl.deleteProgram(resources.bubbleProgram);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`nancy-point-field ${draggingKey ? "is-dragging-fish" : ""}`}
      onPointerDown={handleFieldPointerDown}
      onPointerMove={handleFieldPointerMove}
      onPointerLeave={handleFieldPointerLeave}
    >
      <canvas ref={canvasRef} className="nancy-point-canvas" />
      <canvas ref={gpuCanvasRef} className="nancy-point-webgpu-canvas" />

      <div className="nancy-point-label-layer">
        {scene.map((point) => (
          <div
            key={point.key}
            data-key={point.key}
            ref={(node) => {
              if (node) {
                labelsRef.current[point.key] = node;
              } else {
                delete labelsRef.current[point.key];
              }
            }}
            onPointerDown={(event) => handleLabelPointerDown(point.key, event)}
            className={`nancy-point-label ${point.client.status === "offline" ? "is-offline" : ""} ${draggingKey === point.key ? "is-dragging" : ""}`}
            style={{ ["--nancy-point-accent" as string]: sessionLampColor(point.client.sessionStatus, point.client.status) }}
          >
            <span className="nancy-point-label-text">{point.label}</span>
          </div>
        ))}
      </div>

      {hoveredPoint && (
        <div
          ref={hoverCardRef}
          className="nancy-point-hover"
          style={{ ["--nancy-point-accent" as string]: sessionLampColor(hoveredPoint.client.sessionStatus, hoveredPoint.client.status) }}
        >
          <div className="nancy-point-hover-head">
            <div className="nancy-point-hover-title">{displayTitle(hoveredPoint.client)}</div>
            <div className="nancy-point-hover-state">{sessionStatusLabel(hoveredPoint.client.sessionStatus)}</div>
          </div>
          <div className="nancy-point-hover-sub">
            {shortRuntimeLabel(hoveredPoint.client.runtimeID)} · {workspaceLabel(hoveredPoint.client.workspace)}
          </div>
          <div className="nancy-point-hover-grid">
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">status</span>
              <span className="nancy-point-hover-value">{statusLabel(hoveredPoint.client.status)}</span>
            </div>
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">display</span>
              <span className="nancy-point-hover-value nancy-point-hover-mono">{hoveredPoint.client.displayID ?? "null"}</span>
            </div>
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">session</span>
              <span className="nancy-point-hover-value nancy-point-hover-mono">{hoveredPoint.client.sessionID ?? "null"}</span>
            </div>
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">runtime</span>
              <span className="nancy-point-hover-value nancy-point-hover-mono">{hoveredPoint.client.runtimeID}</span>
            </div>
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">workspace</span>
              <span className="nancy-point-hover-value nancy-point-hover-mono">{hoveredPoint.client.workspace ?? "null"}</span>
            </div>
            <div className="nancy-point-hover-row">
              <span className="nancy-point-hover-key">host</span>
              <span className="nancy-point-hover-value nancy-point-hover-mono">{hoveredPoint.client.runtimeHost ?? "null"}</span>
            </div>
          </div>
        </div>
      )}

      <ScaleControl
        scale={scale}
        onScaleChange={onScaleChange}
        minimap={(
          <Minimap
            minimapRef={minimapRef}
            runtimeKeys={model.runtimeKeys}
            runtimePositions={model.runtimePositions}
            workspaceKeys={model.workspaceKeys}
            workspacePositions={model.workspacePositions}
            worldWidth={model.world.width}
            worldHeight={model.world.height}
            viewRect={viewRect}
            onPointerDown={handleMinimapPointerDown}
          />
        )}
      />

      {unsupported && (
        <div className="nancy-point-fallback">
          WebGL is unavailable in this browser. The monitor can keep using the text views, but the shoals GPU view needs WebGL.
        </div>
      )}

      {!unsupported && scene.length === 0 && <div className="nancy-point-empty">Waiting for fish to connect…</div>}

      <div className="nancy-fps nancy-point-fps">{fps} fps · {scene.length} fish</div>
    </div>
  );
}
