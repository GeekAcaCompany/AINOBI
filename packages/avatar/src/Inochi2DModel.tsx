// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useAvatarTranslate } from "./host.ts";
import { stripCoursewareAssetSignatureFromUrl } from "@ainobi/courseware-core";
import { VtuberModelLoadingPlaceholder } from "./VtuberModelLoadingPlaceholder.tsx";
import { disposeInochiObject3D } from "./inochi-model-dispose.ts";
import {
  borrowInochiModelInstance,
  registerInochiActiveLease,
  returnInochiModelInstance,
} from "./inochi-model-instance-cache.ts";
import {
  resetInochiBodyDrivers,
  resetInochiMouthDrivers,
  resolveLegacyMouthOverlayOpacity,
  resolveMouthFrameOpacity,
  setInochiObjectOpacity,
  type InochiBodyDriver,
  type InochiMouthDriver,
} from "./inochi-puppet-drivers.ts";
import { isInochiVtuberModelWarmInCache } from "./vtuber-model-cache.ts";
import {
  isInochi2DLoadCancelledError,
  loadInochiModelSerially,
  recycleInochiPuppet,
} from "./inochi-model-load-queue.ts";
import { logger } from "./host.ts";

let inochiComponentLoadGeneration = 0;

/** Minimal shape of Inochi2D node tree (not exported from the library). */
interface InochiNodeLike {
  create(): void;
  update(): void;
  children: InochiNodeLike[];
  threeObj: THREE.Object3D;
  name?: string;
}

function mountInochi2DNode(node: InochiNodeLike, parent: THREE.Object3D): THREE.Object3D {
  node.create();
  node.update();
  parent.add(node.threeObj);
  for (const child of node.children) {
    mountInochi2DNode(child, node.threeObj);
  }
  return node.threeObj;
}

/** Put a cached puppet back into the scene (avoids calling `create()` twice). */
function reattachInochiPuppetToScene(
  rootNode: InochiNodeLike,
  scene: THREE.Scene,
): THREE.Object3D {
  rootNode.update();
  const rootObject = rootNode.threeObj;
  if (rootObject.parent) rootObject.parent.remove(rootObject);
  scene.add(rootObject);
  return rootObject;
}

function fitOrthographicCameraToObject(
  camera: THREE.OrthographicCamera,
  object: THREE.Object3D,
  viewWidthPx: number,
  viewHeightPx: number,
  margin = 1.08,
): { contentAspect: number } | null {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const contentW = Math.max(size.x, 1e-4) * margin;
  const contentH = Math.max(size.y, 1e-4) * margin;
  const contentAspect = contentW / contentH;
  const viewAspect = viewWidthPx / Math.max(viewHeightPx, 1);

  let halfW: number;
  let halfH: number;
  // Fit both dimensions: whichever side is more restrictive determines camera frustum.
  if (contentAspect > viewAspect) {
    halfW = contentW / 2;
    halfH = halfW / Math.max(viewAspect, 1e-4);
  } else {
    halfH = contentH / 2;
    halfW = halfH * viewAspect;
  }

  camera.left = center.x - halfW;
  camera.right = center.x + halfW;
  camera.top = center.y + halfH;
  camera.bottom = center.y - halfH;
  camera.position.set(center.x, center.y, 400);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return { contentAspect };
}

function recenterObjectX(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.x -= center.x;
}

function collectLikelyMouthNodes(rootNode: InochiNodeLike): InochiMouthDriver[] {
  const result: InochiMouthDriver[] = [];
  const keywords = ["mouth", "lip", "jaw", "口", "嘴", "唇", "あご"];

  const visit = (node: InochiNodeLike) => {
    const nodeName = String(node.name ?? "").toLowerCase();
    const objName = String(node.threeObj?.name ?? "").toLowerCase();
    const isMouth = keywords.some((k) => nodeName.includes(k) || objName.includes(k));
    if (isMouth && node.threeObj) {
      const frameMatch = nodeName.match(/^mouth_frame_(\d+)$/);
      result.push({
        object: node.threeObj,
        basePositionY: node.threeObj.position.y,
        baseScaleX: node.threeObj.scale.x || 1,
        baseScaleY: node.threeObj.scale.y || 1,
        opacityDriven:
          nodeName === "mouth_open" ||
          nodeName.includes("mouth::open") ||
          frameMatch !== null,
        frameIndex: frameMatch ? Number(frameMatch[1]) : null,
      });
    }
    for (const child of node.children) visit(child);
  };

  visit(rootNode);
  return result;
}

function collectLikelyBodyNodes(rootNode: InochiNodeLike): InochiBodyDriver[] {
  const result: InochiBodyDriver[] = [];
  const bodyKeywords = ["body", "torso", "chest", "spine", "肩", "몸", "躯干", "上半身"];
  const headKeywords = ["head", "neck", "face", "头", "顔", "목"];

  const visit = (node: InochiNodeLike) => {
    const nodeName = String(node.name ?? "").toLowerCase();
    const objName = String(node.threeObj?.name ?? "").toLowerCase();
    const isBodyLike = [...bodyKeywords, ...headKeywords].some(
      (k) => nodeName.includes(k) || objName.includes(k),
    );
    if (isBodyLike && node.threeObj) {
      result.push({
        object: node.threeObj,
        baseRotZ: node.threeObj.rotation.z,
        basePosY: node.threeObj.position.y,
      });
    }
    for (const child of node.children) visit(child);
  };

  visit(rootNode);
  return result;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** Texture filtering: mipmaps + anisotropy for POT textures, reducing moiré and hard edges when scaled down. */
function softenPuppetTextures(textures: THREE.Texture[], maxAnisotropy = 1): void {
  const aniso = Math.max(1, Math.min(8, Math.floor(maxAnisotropy)));
  for (const tx of textures) {
    const img = tx.image as { width?: number; height?: number } | undefined;
    const tw = img?.width ?? 0;
    const th = img?.height ?? 0;
    const canMip = tw > 0 && th > 0 && isPowerOfTwo(tw) && isPowerOfTwo(th);
    if (canMip) {
      tx.generateMipmaps = true;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
    } else {
      tx.generateMipmaps = false;
      tx.minFilter = THREE.LinearFilter;
    }
    tx.magFilter = THREE.LinearFilter;
    tx.anisotropy = aniso;
    tx.needsUpdate = true;
  }
}

type SupersampleViewportOptions = {
  minRenderShortEdge: number;
  maxSuperSample: number;
  /** Hard cap on the offscreen shorter side, so the buffer doesn't get too large when enlarged. */
  maxRenderShortEdge?: number;
  /** Cap on total offscreen pixels (width × height), mainly affecting the GPU cost per frame. */
  maxRenderPixels?: number;
  /** External CSS/Framer scale (&lt;1 raises the offscreen factor). */
  visualScale?: number;
};

function clampRenderBufferSize(
  renderW: number,
  renderH: number,
  options: Pick<SupersampleViewportOptions, "maxRenderShortEdge" | "maxRenderPixels">,
): { renderW: number; renderH: number } {
  let rw = Math.max(1, renderW);
  let rh = Math.max(1, renderH);
  const maxShort = options.maxRenderShortEdge;
  if (maxShort && maxShort > 0) {
    const short = Math.min(rw, rh);
    if (short > maxShort) {
      const scale = maxShort / short;
      rw = Math.max(1, Math.round(rw * scale));
      rh = Math.max(1, Math.round(rh * scale));
    }
  }
  const maxPixels = options.maxRenderPixels;
  if (maxPixels && maxPixels > 0 && rw * rh > maxPixels) {
    const scale = Math.sqrt(maxPixels / (rw * rh));
    rw = Math.max(1, Math.round(rw * scale));
    rh = Math.max(1, Math.round(rh * scale));
  }
  return { renderW: rw, renderH: rh };
}

/** When displayed very small, raise the offscreen buffer and let CSS scale it down — effectively supersampling to soften edges. */
function resolveSupersampleViewport(
  displayW: number,
  displayH: number,
  options: SupersampleViewportOptions,
): { displayW: number; displayH: number; renderW: number; renderH: number } {
  const dw = Math.max(1, Math.round(displayW));
  const dh = Math.max(1, Math.round(displayH));
  const short = Math.min(dw, dh);
  const minEdge = Math.max(64, options.minRenderShortEdge);
  const maxFactor = Math.max(1, options.maxSuperSample);
  let factor = short < minEdge ? Math.min(maxFactor, minEdge / short) : 1;
  const visual = Math.max(0.1, options.visualScale ?? 1);
  if (visual < 0.999) {
    factor = Math.min(maxFactor, factor / visual);
  }
  const rawW = Math.max(1, Math.round(dw * factor));
  const rawH = Math.max(1, Math.round(dh * factor));
  const { renderW, renderH } = clampRenderBufferSize(rawW, rawH, options);
  return { displayW: dw, displayH: dh, renderW, renderH };
}

/** The canvas fills the container; when scaled down the browser shrinks the bitmap, avoiding setSize every frame. */
function applyCanvasFillStyles(
  canvas: HTMLCanvasElement,
  displayH: number,
  renderH: number,
  softBlurBelowDisplayHeight: number,
): void {
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  const downscale = renderH / Math.max(displayH, 1);
  if (softBlurBelowDisplayHeight > 0 && displayH < softBlurBelowDisplayHeight) {
    const t = 1 - displayH / softBlurBelowDisplayHeight;
    const blurPx = (0.25 + t * 0.9) * Math.min(downscale / 2, 1);
    canvas.style.filter = blurPx > 0.12 ? `blur(${blurPx.toFixed(2)}px)` : "";
  } else {
    canvas.style.filter = "";
  }
}

export interface Inochi2DModelProps {
  /** URL to an Inochi2D `.inx` (INP) file. */
  modelUrl: string;
  /** Target height in CSS pixels (matches Live2DModel layout intent). */
  maxHeight?: number;
  /** Target width hint when the container has not laid out yet (editor stage slot). */
  maxWidth?: number;
  className?: string;
  onModelLoaded?: (api: Inochi2DModelApi) => void;
  onLoadingChange?: (loading: boolean) => void;
  onError?: (error: Error) => void;
  onCanvasSnapshot?: (dataUrl: string) => void;
  autoResize?: boolean;
  quality?: "low" | "medium" | "high";
  /** Cap render loop; values below 60 throttle updates. */
  fps?: number;
  /** Add a subtle fallback idle motion for static puppets. */
  enableIdleMotion?: boolean;
  /** Extra mouth closing strength when lipsync is 0 (0-0.6 recommended). */
  mouthClosedBias?: number;
  /** Force horizontal centering each frame. */
  autoCenterX?: boolean;
  /** When false, parent renders its own loading chrome. */
  showLoadingPlaceholder?: boolean;
  /** Override the default MSAA (off by default for low quality). The editor can turn it off explicitly to avoid halos on transparent edges. */
  antialias?: boolean;
  /** Override the renderer pixel ratio (varies with quality by default). */
  pixelRatio?: number;
  /** Enable offscreen supersampling when the shorter display side is below this value (px); 256 by default. */
  minRenderShortEdge?: number;
  /** Headless rendering: the idle animation phase follows the scene time (ms) instead of the wall-clock dt. */
  sceneTimeMs?: number;
  /** Headless pre-mount: wall-clock phase disabled; without sceneTimeMs it freezes at 0 and doesn't advance with RAF. */
  headlessSceneDrive?: boolean;
  /** Upper limit of the supersampling factor; 2 by default. */
  maxSuperSample?: number;
  /** Hard cap on the offscreen shorter side (px), limiting the GPU cost after enlarging; 640 by default. */
  maxRenderShortEdge?: number;
  /** Cap on offscreen width × height pixels; about 480k by default (≈960×500). */
  maxRenderPixels?: number;
  /** Below this display height (px), add a slight CSS blur; 0 turns it off. */
  softBlurBelowDisplayHeight?: number;
  /** External Framer/CSS scale (&lt;1 raises the offscreen resolution). */
  visualScale?: number;
  /** Use the container's actual size as the viewport (the Player's narrow area). */
  fitContainer?: boolean;
}

export type Inochi2DModelApi = {
  /** Loaded puppet data and Three.js root (if still mounted). */
  puppet: unknown;
  rootObject: THREE.Object3D | null;
  /** Inochi2D web runtime does not expose Live2D-style motions; these are compatibility stubs. */
  playMotion: (group: string, index?: number) => void;
  playExpression: (name: string) => void;
  playPresetAction: (preset: string) => void;
  playRandomMotion: () => void;
  playRandomExpression: () => void;
  setLipSyncValue: (value: number) => void;
  resetLipSync: () => void;
};

export function Inochi2DModelComponent({
  modelUrl,
  maxHeight = 800,
  maxWidth,
  className = "",
  onModelLoaded,
  onLoadingChange,
  onError,
  onCanvasSnapshot,
  autoResize = true,
  quality = "medium",
  fps = 60,
  enableIdleMotion = true,
  mouthClosedBias = 1,
  autoCenterX = true,
  showLoadingPlaceholder = true,
  antialias: antialiasProp,
  pixelRatio: pixelRatioProp,
  minRenderShortEdge = 256,
  maxSuperSample = 2,
  maxRenderShortEdge = 640,
  maxRenderPixels = 480_000,
  softBlurBelowDisplayHeight = 0,
  visualScale = 1,
  fitContainer = false,
  sceneTimeMs,
  headlessSceneDrive = false,
}: Inochi2DModelProps) {
  const t = useAvatarTranslate();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const puppetRef = useRef<unknown>(null);
  const texturesRef = useRef<THREE.Texture[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const lipSyncTargetRef = useRef<number>(0);
  const lipSyncCurrentRef = useRef<number>(0);
  const mouthDriverNodesRef = useRef<InochiMouthDriver[]>([]);
  const bodyDriverNodesRef = useRef<InochiBodyDriver[]>([]);
  const contentAspectRef = useRef<number>(0.56);
  const bodyPresetRef = useRef<"idle" | "listening" | "thinking" | "speaking" | "happy" | "explaining">("idle");
  const bodyPresetUntilRef = useRef<number>(0);
  const sceneTimeMsRef = useRef(sceneTimeMs ?? 0);
  sceneTimeMsRef.current = sceneTimeMs ?? 0;
  const headlessSceneDriveRef = useRef(headlessSceneDrive);
  headlessSceneDriveRef.current = headlessSceneDrive;
  const motionStateRef = useRef<{ yAmp: number; ySpeed: number; rotAmp: number; rotSpeed: number }>({
    yAmp: 0.022,
    ySpeed: 1.9,
    rotAmp: 0.008,
    rotSpeed: 1.55,
  });
  const snapshotCapturedRef = useRef(false);
  const lastViewportRef = useRef({ w: 0, h: 0, renderW: 0, renderH: 0 });
  const resizeRafRef = useRef(0);
  const maxHeightRef = useRef(maxHeight);
  const maxWidthRef = useRef(maxWidth);
  const minRenderShortEdgeRef = useRef(minRenderShortEdge);
  const maxSuperSampleRef = useRef(maxSuperSample);
  const maxRenderShortEdgeRef = useRef(maxRenderShortEdge);
  const maxRenderPixelsRef = useRef(maxRenderPixels);
  const softBlurBelowDisplayHeightRef = useRef(softBlurBelowDisplayHeight);
  const visualScaleRef = useRef(visualScale);
  const fitContainerRef = useRef(fitContainer);
  maxHeightRef.current = maxHeight;
  maxWidthRef.current = maxWidth;
  minRenderShortEdgeRef.current = minRenderShortEdge;
  maxSuperSampleRef.current = maxSuperSample;
  maxRenderShortEdgeRef.current = maxRenderShortEdge;
  maxRenderPixelsRef.current = maxRenderPixels;
  softBlurBelowDisplayHeightRef.current = softBlurBelowDisplayHeight;
  visualScaleRef.current = visualScale;
  fitContainerRef.current = fitContainer;

  const supersampleOptions = useCallback(
    (): SupersampleViewportOptions => ({
      minRenderShortEdge: minRenderShortEdgeRef.current,
      maxSuperSample: maxSuperSampleRef.current,
      maxRenderShortEdge: maxRenderShortEdgeRef.current,
      maxRenderPixels: maxRenderPixelsRef.current,
      visualScale: visualScaleRef.current,
    }),
    [],
  );

  const modelReloadKey = useMemo(
    () => stripCoursewareAssetSignatureFromUrl((modelUrl ?? "").trim()),
    [modelUrl],
  );

  const [isLoading, setIsLoading] = useState(
    () => Boolean(modelUrl) && !isInochiVtuberModelWarmInCache(modelReloadKey || modelUrl),
  );
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  const applyViewportSize = useCallback((w: number, h: number) => {
    const vp = resolveSupersampleViewport(w, h, supersampleOptions());
    const last = lastViewportRef.current;
    const displayChanged = vp.displayW !== last.w || vp.displayH !== last.h;
    // When scaling down only the CSS 100% display changes, not the offscreen buffer, avoiding repeated setSize flicker during wheel zoom.
    const needsGrow =
      vp.renderW > last.renderW * 1.04 || vp.renderH > last.renderH * 1.04 || last.renderW === 0;
    const renderW = needsGrow ? Math.max(last.renderW, vp.renderW) : last.renderW;
    const renderH = needsGrow ? Math.max(last.renderH, vp.renderH) : last.renderH;
    const renderChanged = renderW !== last.renderW || renderH !== last.renderH;

    if (!displayChanged && !renderChanged) return;

    const r = rendererRef.current;
    const cam = cameraRef.current;
    const root = rootRef.current;
    if (!r || !cam || !root) return;

    applyCanvasFillStyles(
      r.domElement,
      vp.displayH,
      renderH || vp.renderH,
      softBlurBelowDisplayHeightRef.current,
    );

    if (renderChanged) {
      r.setPixelRatio(1);
      r.setSize(renderW, renderH, false);
      const fitResult = fitOrthographicCameraToObject(cam, root, renderW, renderH);
      if (fitResult) contentAspectRef.current = fitResult.contentAspect;
    }

    lastViewportRef.current = {
      w: vp.displayW,
      h: vp.displayH,
      renderW,
      renderH,
    };
  }, [supersampleOptions]);

  const flushViewportResize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const fallbackWidth = Math.max(1, Math.round(maxHeightRef.current * contentAspectRef.current));
    const widthHint = maxWidthRef.current;
    let w = Math.max(
      1,
      Math.round(
        container.clientWidth || (widthHint && widthHint > 0 ? widthHint : 0) || fallbackWidth,
      ),
    );
    let h = Math.max(1, Math.round(container.clientHeight || maxHeightRef.current));
    if (fitContainerRef.current) {
      if (widthHint && widthHint > 0) w = Math.min(w, Math.round(widthHint));
      h = Math.min(h, Math.round(maxHeightRef.current));
    }
    applyViewportSize(w, h);
  }, [applyViewportSize]);

  const scheduleViewportResize = useCallback(() => {
    if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = 0;
      flushViewportResize();
    });
  }, [flushViewportResize]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !containerRef.current || !modelUrl) return;

    const container = containerRef.current;
    const loadGeneration = ++inochiComponentLoadGeneration;
    let cancelled = false;
    let returnedPuppetToCache = false;
    const modelCacheKey = modelReloadKey || modelUrl;
    const isStaleGeneration = (): boolean =>
      cancelled || loadGeneration !== inochiComponentLoadGeneration;
    snapshotCapturedRef.current = false;
    lastViewportRef.current = { w: 0, h: 0, renderW: 0, renderH: 0 };

    const returnPuppetToCache = (): void => {
      if (returnedPuppetToCache) return;
      const puppet = puppetRef.current;
      if (!puppet || !modelCacheKey) return;
      if (rootRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(rootRef.current);
        } catch {
          /* noop */
        }
      }
      const mouthDrivers = mouthDriverNodesRef.current;
      const bodyDrivers = bodyDriverNodesRef.current;
      resetInochiMouthDrivers(mouthDrivers);
      resetInochiBodyDrivers(bodyDrivers);
      rootRef.current = null;
      puppetRef.current = null;
      mouthDriverNodesRef.current = [];
      bodyDriverNodesRef.current = [];
      returnInochiModelInstance(modelCacheKey, {
        puppet,
        textures: texturesRef.current,
        contentAspect: contentAspectRef.current,
        mouthDrivers,
        bodyDrivers,
      });
      texturesRef.current = [];
      returnedPuppetToCache = true;
    };

    const getPixelRatio = () => {
      if (typeof pixelRatioProp === "number" && pixelRatioProp > 0) {
        return pixelRatioProp;
      }
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      switch (quality) {
        case "low":
          return 1;
        case "high":
          // Fixed supersampling ratio; see Live2DModel.tsx for the rationale.
          return 3;
        default:
          return Math.min(dpr, 1.5);
      }
    };

    const useAntialias = antialiasProp ?? quality !== "low";

    const frameInterval = fps >= 60 ? 0 : 1000 / fps;

    const run = async () => {
      try {
        // Zero-size container guard: when the editor canvas mounts before the layout settles, the THREE renderer created at 0 size
        // fails → onError → the component unmounts → the character never renders (present in the sidebar snapshot, missing on the canvas).
        // Wait up to 12s for the layout; if the component unmounts during the wait, exit silently.
        for (let i = 0; i < 120; i++) {
          const el = containerRef.current;
          if (el && el.clientWidth > 0 && el.clientHeight > 0) break;
          if (isStaleGeneration()) return;
          await new Promise((r2) => setTimeout(r2, 100));
        }
        if (isStaleGeneration()) return;
        const warmCacheAtStart = isInochiVtuberModelWarmInCache(modelCacheKey);
        if (!warmCacheAtStart) {
          setIsLoading(true);
        }
        setError(null);
        if (warmCacheAtStart) {
          onLoadingChange?.(false);
        }

        const viewW = Math.max(1, container.clientWidth || Math.round(maxHeight * 0.56));
        const viewH = Math.max(1, maxHeight);

        const cached = borrowInochiModelInstance(modelCacheKey);
        let puppet: unknown;
        if (cached) {
          puppet = cached.puppet;
          texturesRef.current = cached.textures;
          contentAspectRef.current = cached.contentAspect;
        } else {
          const Inochi2D = await import("inochi2d");
          if (isStaleGeneration()) return;

          logger.debug("[Inochi2D] Loading model:", modelUrl);
          try {
            puppet = await loadInochiModelSerially(
              modelCacheKey,
              () => Inochi2D.INP.inImportFromURL(modelUrl),
              () => !isStaleGeneration(),
              { modelUrl },
            );
          } catch (loadError) {
            if (isInochi2DLoadCancelledError(loadError)) return;
            throw loadError;
          }
          if (isStaleGeneration()) {
            const textures = (puppet as { textures?: THREE.Texture[] }).textures ?? [];
            recycleInochiPuppet(modelCacheKey, {
              puppet,
              textures,
              contentAspect: contentAspectRef.current,
              mouthDrivers: [],
              bodyDrivers: [],
            });
            return;
          }
          texturesRef.current = (puppet as { textures?: THREE.Texture[] }).textures ?? [];
        }

        puppetRef.current = puppet;
        if (isStaleGeneration()) {
          returnPuppetToCache();
          return;
        }

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
        const renderer = new THREE.WebGLRenderer({
          antialias: useAntialias,
          alpha: true,
          premultipliedAlpha: true,
          powerPreference: quality === "low" ? "low-power" : "high-performance",
        });
        renderer.setPixelRatio(getPixelRatio());
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);
        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;

        if (!cached && texturesRef.current.length > 0) {
          softenPuppetTextures(
            texturesRef.current,
            renderer.capabilities.getMaxAnisotropy(),
          );
        }

        const rootNode = (puppet as { rootNode: InochiNodeLike }).rootNode;
        const rootObject =
          cached && cached.mouthDrivers.length > 0
            ? reattachInochiPuppetToScene(rootNode, scene)
            : mountInochi2DNode(rootNode, scene);
        rootRef.current = rootObject;
        if (cached && cached.mouthDrivers.length > 0) {
          mouthDriverNodesRef.current = cached.mouthDrivers;
          bodyDriverNodesRef.current = cached.bodyDrivers;
        } else {
          rootNode.update();
          mouthDriverNodesRef.current = collectLikelyMouthNodes(rootNode);
          bodyDriverNodesRef.current = collectLikelyBodyNodes(rootNode);
        }
        resetInochiMouthDrivers(mouthDriverNodesRef.current);
        const mouthFrameCount = mouthDriverNodesRef.current.reduce(
          (count, node) =>
            node.frameIndex === null ? count : Math.max(count, node.frameIndex + 1),
          0,
        );
        logger.debug("[Inochi2D] Mouth driver nodes:", mouthDriverNodesRef.current.length, {
          fromCache: Boolean(cached && cached.mouthDrivers.length > 0),
          mouthFrameCount,
        });
        logger.debug("[Inochi2D] Body driver nodes:", bodyDriverNodesRef.current.length);
        const idleBaseY = rootObject.position.y;
        const idleBaseRotZ = rootObject.rotation.z;
        const idleBaseScaleX = rootObject.scale.x || 1;
        const idleBaseScaleY = rootObject.scale.y || 1;
        const closeBias = Math.max(0, Math.min(0.6, mouthClosedBias));

        if (autoCenterX) {
          recenterObjectX(rootObject);
        }
        const initialVp = resolveSupersampleViewport(viewW, viewH, {
          minRenderShortEdge: minRenderShortEdgeRef.current,
          maxSuperSample: maxSuperSampleRef.current,
          maxRenderShortEdge: maxRenderShortEdgeRef.current,
          maxRenderPixels: maxRenderPixelsRef.current,
        });
        renderer.setPixelRatio(1);
        renderer.setSize(initialVp.renderW, initialVp.renderH, false);
        applyCanvasFillStyles(
          renderer.domElement,
          initialVp.displayH,
          initialVp.renderH,
          softBlurBelowDisplayHeightRef.current,
        );
        const fitResult = fitOrthographicCameraToObject(
          camera,
          rootObject,
          initialVp.renderW,
          initialVp.renderH,
        );
        if (fitResult) contentAspectRef.current = fitResult.contentAspect;
        lastViewportRef.current = {
          w: initialVp.displayW,
          h: initialVp.displayH,
          renderW: initialVp.renderW,
          renderH: initialVp.renderH,
        };

        // Inochi2D textures/meshes become ready asynchronously: at mount time Box3 may be empty or inaccurate → the first fit fails
        // → the canvas display size and camera are all wrong (with an unchanged container size the re-fit in the resize loop never fires)
        // → the character shrinks to a pinpoint or doesn't render. A delayed re-fit is the fallback (same as the manage side's AI teacher preview, d88bd9c):
        // first reset the viewport to the container (CSS + render size), then force the camera to refit to the ready bounding box.
        for (const delay of [600, 1800, 4000]) {
          refitTimers.push(
            window.setTimeout(() => {
              if (isStaleGeneration()) return;
              try {
                flushViewportResize();
                const cam = cameraRef.current;
                const root = rootRef.current;
                if (!cam || !root) return;
                const vp = lastViewportRef.current;
                const fit = fitOrthographicCameraToObject(
                  cam,
                  root,
                  vp?.renderW || initialVp.renderW,
                  vp?.renderH || initialVp.renderH,
                );
                if (fit) contentAspectRef.current = fit.contentAspect;
              } catch {
                /* ignore */
              }
            }, delay),
          );
        }

        if (!cached) {
          registerInochiActiveLease(modelCacheKey, {
            puppet,
            textures: texturesRef.current,
            contentAspect: contentAspectRef.current,
            mouthDrivers: mouthDriverNodesRef.current,
            bodyDrivers: bodyDriverNodesRef.current,
          });
        }

        const stubWarn = (name: string) =>
          logger.debug(`[Inochi2D] ${name} is not mapped for Inochi2D models (stub).`);

        const api: Inochi2DModelApi = {
          puppet,
          rootObject,
          playMotion: (group: string) => {
            const g = group.toLowerCase();
            if (g.includes("talk") || g.includes("speak")) bodyPresetRef.current = "speaking";
            else if (g.includes("joy") || g.includes("happy")) {
              bodyPresetRef.current = "happy";
              bodyPresetUntilRef.current = performance.now() + 1200;
            } else if (g.includes("idle")) bodyPresetRef.current = "idle";
            else stubWarn(`playMotion(${group})`);
          },
          playExpression: (name: string) => {
            const n = name.toLowerCase();
            if (n.includes("think")) bodyPresetRef.current = "thinking";
            else if (n.includes("happy")) {
              bodyPresetRef.current = "happy";
              bodyPresetUntilRef.current = performance.now() + 1200;
            } else if (n.includes("normal")) bodyPresetRef.current = "idle";
            else stubWarn(`playExpression(${name})`);
          },
          playPresetAction: (preset: string) => {
            const p = preset.toLowerCase();
            if (
              p === "listening" ||
              p === "thinking" ||
              p === "speaking" ||
              p === "happy" ||
              p === "explaining"
            ) {
              bodyPresetRef.current = p;
              if (p === "happy") bodyPresetUntilRef.current = performance.now() + 1500;
              return;
            }
            if (p === "celebrating" || p === "greeting") {
              bodyPresetRef.current = "happy";
              bodyPresetUntilRef.current = performance.now() + 1500;
              return;
            }
            stubWarn(`playPresetAction(${preset})`);
          },
          playRandomMotion: () => {
            const opts: Array<"idle" | "speaking" | "thinking" | "explaining"> = [
              "idle",
              "speaking",
              "thinking",
              "explaining",
            ];
            bodyPresetRef.current = opts[Math.floor(Math.random() * opts.length)];
          },
          playRandomExpression: () => {
            const opts: Array<"idle" | "thinking" | "happy"> = ["idle", "thinking", "happy"];
            bodyPresetRef.current = opts[Math.floor(Math.random() * opts.length)];
            if (bodyPresetRef.current === "happy") {
              bodyPresetUntilRef.current = performance.now() + 1200;
            }
          },
          setLipSyncValue: (value: number) => {
            lipSyncTargetRef.current = Math.max(0, Math.min(1, value));
            if (lipSyncTargetRef.current > 0.08) bodyPresetRef.current = "speaking";
          },
          resetLipSync: () => {
            lipSyncTargetRef.current = 0;
            lipSyncCurrentRef.current = 0;
            if (bodyPresetRef.current === "speaking") {
              bodyPresetRef.current = "idle";
            }
          },
        };

        setIsLoading(false);
        onModelLoaded?.(api);
        logger.debug("[Inochi2D] Model ready:", {
          modelUrl,
          fromCache: Boolean(cached),
        });

        // Phase accumulators for idle-motion sine waves. Accumulating
        // `dt * speed` (instead of `time * speed`) keeps sin() continuous
        // when the motion config's speed blends across preset transitions
        // (e.g. idle → listening on mic click). Multiplying a shared
        // timestamp by a changing speed produces a discontinuous argument
        // and the characteristic "wobble until blend settles" jitter.
        let yPhase = 0;
        let rotPhase = 0;
        let yPhaseBody = 0;
        let rotPhaseBody = 0;
        let prevLoopTime = 0;

        const loop = (t: number) => {
          if (isStaleGeneration()) return;
          if (frameInterval > 0 && t - lastFrameRef.current < frameInterval) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }
          lastFrameRef.current = t;
          // Keep node transforms updated every frame.
          rootNode.update();
          // NOTE: recenterObjectX() is intentionally not called per-frame.
          // Recomputing Box3 every frame + mutating rootObject.position.x
          // produces a sub-pixel horizontal drift whenever mesh bounds shift
          // (e.g. mouth deforming during lip-sync), which compounds with the
          // fallback body-scale below to look like whole-body jitter. Init +
          // ResizeObserver handle centering; per-frame is unnecessary.
          lipSyncCurrentRef.current += (lipSyncTargetRef.current - lipSyncCurrentRef.current) * 0.35;
          const mouth = lipSyncCurrentRef.current;
          // Fallback idle animation for models without parameter-driving integration.
          if (enableIdleMotion) {
            const now = performance.now();
            if (bodyPresetRef.current === "happy" && bodyPresetUntilRef.current > 0 && now > bodyPresetUntilRef.current) {
              bodyPresetRef.current = "idle";
              bodyPresetUntilRef.current = 0;
            }
            const preset = bodyPresetRef.current;
            const cfg =
              preset === "listening"
                ? { yAmp: 0.018, ySpeed: 1.25, rotAmp: 0.012, rotSpeed: 1.15 }
                : preset === "thinking"
                  ? { yAmp: 0.014, ySpeed: 0.95, rotAmp: 0.02, rotSpeed: 0.75 }
                  : preset === "speaking"
                    // Keep speaking body motion fully in sync with idle to avoid twitching.
                    ? { yAmp: 0.022, ySpeed: 1.9, rotAmp: 0.008, rotSpeed: 1.55 }
                    : preset === "explaining"
                      ? { yAmp: 0.026, ySpeed: 1.75, rotAmp: 0.028, rotSpeed: 1.45 }
                      : preset === "happy"
                        ? { yAmp: 0.04, ySpeed: 3.1, rotAmp: 0.038, rotSpeed: 2.7 }
                        : { yAmp: 0.022, ySpeed: 1.9, rotAmp: 0.008, rotSpeed: 1.55 };
            // Smooth preset transitions to avoid visible jumps on idle->speaking.
            const blend = 0.12;
            const m = motionStateRef.current;
            m.yAmp += (cfg.yAmp - m.yAmp) * blend;
            m.ySpeed += (cfg.ySpeed - m.ySpeed) * blend;
            m.rotAmp += (cfg.rotAmp - m.rotAmp) * blend;
            m.rotSpeed += (cfg.rotSpeed - m.rotSpeed) * blend;

            const sceneDriven =
              headlessSceneDriveRef.current || sceneTimeMs !== undefined;
            if (sceneDriven) {
              const sceneMs =
                sceneTimeMs !== undefined ? sceneTimeMsRef.current : 0;
              const sceneSec = sceneMs / 1000;
              yPhase = sceneSec * m.ySpeed;
              rotPhase = sceneSec * m.rotSpeed;
              yPhaseBody = sceneSec * (m.ySpeed + 0.25);
              rotPhaseBody = sceneSec * (m.rotSpeed + 0.35);
            } else {
              // Advance phase by dt × current speed. Continuous across speed
              // changes, so the sin() argument never jumps when preset flips.
              // Clamp dt to avoid a big phase leap when the tab was backgrounded.
              const dtSec = prevLoopTime ? Math.min((t - prevLoopTime) / 1000, 0.1) : 0;
              prevLoopTime = t;
              yPhase += dtSec * m.ySpeed;
              rotPhase += dtSec * m.rotSpeed;
              yPhaseBody += dtSec * (m.ySpeed + 0.25);
              rotPhaseBody += dtSec * (m.rotSpeed + 0.35);
            }

            rootObject.position.y = idleBaseY + Math.sin(yPhase) * m.yAmp;
            rootObject.rotation.z = idleBaseRotZ + Math.sin(rotPhase) * m.rotAmp;
            if (bodyDriverNodesRef.current.length > 0) {
              for (const node of bodyDriverNodesRef.current) {
                node.object.rotation.z = node.baseRotZ + Math.sin(rotPhaseBody) * (m.rotAmp * 0.85);
                node.object.position.y = node.basePosY + Math.sin(yPhaseBody) * (m.yAmp * 0.65);
              }
            }
          }
          if (mouthDriverNodesRef.current.length > 0) {
            for (const node of mouthDriverNodesRef.current) {
              if (node.opacityDriven) {
                node.object.scale.x = node.baseScaleX;
                node.object.scale.y = node.baseScaleY;
                node.object.position.y = node.basePositionY;
                const opacity =
                  mouthFrameCount > 1 && node.frameIndex !== null
                    ? resolveMouthFrameOpacity(mouth, node.frameIndex, mouthFrameCount)
                    : resolveLegacyMouthOverlayOpacity(mouth);
                setInochiObjectOpacity(node.object, opacity);
                continue;
              }
              // At mouth=0, apply a "closed-mouth" bias so default pose isn't open.
              const closeScaleY = 1 - closeBias * 1.05;
              // Narrow the mouth at rest to avoid a long flat line.
              const closeScaleX = 1 - closeBias * 0.3;
              const closeOffsetY = closeBias * 0.026;
              // Increase speaking amplitude while keeping closed default smaller.
              const openScaleY = 0.32 + closeBias * 0.42;
              const openScaleX = 0.08 + closeBias * 0.06;
              const openOffsetY = 0.022 + closeBias * 0.01;
              // Prefer local mouth region deformation when candidate nodes are present.
              node.object.scale.y = node.baseScaleY * (closeScaleY + mouth * openScaleY);
              node.object.scale.x = node.baseScaleX * (closeScaleX - mouth * openScaleX);
              node.object.position.y = node.basePositionY + closeOffsetY - mouth * openOffsetY;
            }
            // Keep body scale stable when mouth nodes are available.
            rootObject.scale.y = idleBaseScaleY;
            rootObject.scale.x = idleBaseScaleX;
          } else {
            // No mouth nodes matched — leave the root untouched. Scaling the
            // whole puppet to fake lip-sync visibly jitters the body every
            // frame (mouth value oscillates at 60 FPS). Better to show no
            // lip-sync than a shaking character.
            rootObject.scale.y = idleBaseScaleY;
            rootObject.scale.x = idleBaseScaleX;
          }
          renderer.render(scene, camera);
          if (!snapshotCapturedRef.current && onCanvasSnapshot) {
            try {
              const dataUrl = renderer.domElement.toDataURL("image/png");
              if (dataUrl) {
                snapshotCapturedRef.current = true;
                onCanvasSnapshot(dataUrl);
              }
            } catch (error) {
              logger.warn("[Inochi2D] Failed to capture canvas snapshot:", error);
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (isStaleGeneration() || isInochi2DLoadCancelledError(err)) return;
        const e = err instanceof Error ? err : new Error(String(err));
        logger.error("[Inochi2D] Failed to load or render:", e);
        setError(e.message);
        setIsLoading(false);
        onError?.(e);
      }
    };

    // The delayed re-fit timer (see the Inochi2D async-ready fallback in run()), cleared on unmount.
    const refitTimers: number[] = [];
    void run();

    return () => {
      cancelled = true;
      for (const t of refitTimers) clearTimeout(t);
      cancelAnimationFrame(rafRef.current);
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = 0;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      lastViewportRef.current = { w: 0, h: 0, renderW: 0, renderH: 0 };

      if (puppetRef.current && modelCacheKey) {
        returnPuppetToCache();
      } else {
        if (rootRef.current) {
          try {
            disposeInochiObject3D(rootRef.current);
          } catch {
            /* ignore */
          }
        }
        texturesRef.current.forEach((tx) => {
          try {
            tx.dispose();
          } catch {
            /* noop */
          }
        });
        texturesRef.current = [];
        puppetRef.current = null;
        rootRef.current = null;
        mouthDriverNodesRef.current = [];
        bodyDriverNodesRef.current = [];
      }

      if (rendererRef.current) {
        try {
          if (rendererRef.current.domElement.parentNode === container) {
            container.removeChild(rendererRef.current.domElement);
          }
        } catch {
          /* ignore */
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [
    isClient,
    modelReloadKey,
    quality,
    fps,
    enableIdleMotion,
    mouthClosedBias,
    autoCenterX,
    onCanvasSnapshot,
    antialiasProp,
    pixelRatioProp,
  ]);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    if (!autoResize || !isClient || !containerRef.current) return;
    const container = containerRef.current;
    const ro = new ResizeObserver(() => scheduleViewportResize());
    ro.observe(container);
    resizeObsRef.current = ro;
    return () => ro.disconnect();
  }, [autoResize, isClient, scheduleViewportResize]);

  // Editor canvas zoom etc.: driven by maxHeight/maxWidth, with rAF merging several updates within one frame.
  useEffect(() => {
    if (!isClient) return;
    scheduleViewportResize();
  }, [
    isClient,
    maxHeight,
    maxWidth,
    visualScale,
    fitContainer,
    minRenderShortEdge,
    maxSuperSample,
    maxRenderShortEdge,
    maxRenderPixels,
    softBlurBelowDisplayHeight,
    scheduleViewportResize,
  ]);

  if (!isClient) {
    return (
      <div
        className={`relative ${className}`}
        style={{ width: "100%", height: maxHeight }}
      ></div>
    );
  }

  if (!modelUrl) {
    return (
      <div
        className={`relative ${className}`}
        style={{ width: "100%", height: maxHeight }}
      >
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-amber-50/90 text-sm text-amber-900">
          {t("inochi2d.missingUrl")}
        </div>
      </div>
    );
  }

  if (error) {
    return null;
  }

  const fillsParent = fitContainer || className.includes("h-full");
  return (
    <div
      className={`relative z-0 ${className}`}
      style={
        fillsParent
          ? { width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%" }
          : { width: "100%", height: maxHeight }
      }
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        style={{ width: "100%", height: "100%" }}
      />

      {showLoadingPlaceholder && isLoading ? (
        <VtuberModelLoadingPlaceholder showBorder={false} label={t("inochi2d.loadingModel")} />
      ) : null}
    </div>
  );
}

export default Inochi2DModelComponent;
