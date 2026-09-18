"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerspectiveCamera, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { captureSources, legalTargets, owner, same } from "../lib/rules";
import type { Move, Position, PublicGame } from "../lib/types";

type Props = { game: PublicGame; player: number; onMove: (move: Move) => void; disabled: boolean };

/** The lamp hangs here; the beam, the bulb and the dust in it all key off this height. */
const LAMP_HEIGHT = 5.9;
const SHADE_HEIGHT = 0.84;
const CEILING = 9;
const SHAFT_STRENGTH = 0.14;
const SLIDE_SECONDS = 0.42;
/**
 * Where a piece rests: the squares' top face is at 0.045 and the piece is 0.18
 * tall about its own centre, so this is what sets it down on the board rather
 * than a fifth of a square above it.
 */
const PIECE_REST = 0.135;
/**
 * Roughly where taken pieces pile up beside their captor; the other seat
 * mirrors it. Spread along the table's edge rather than clustered: the left of
 * the frame is foreshortened hard, and anchors a unit apart there land ~50px
 * apart on screen, near enough for one pile to hide behind another.
 */
const PILES: [number, number][] = [[-5.45, 2.45], [-5.65, 1.2], [-5.8, -0.1]];
/** Four to six a pile, so three of them always take a full dozen. */
const PILE_RANGE = 3;
const PILE_MIN = 4;

/** FNV-1a: turns the game's id into something a generator can start from. */
function seedFrom(id: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32. Small, seedable, and good enough to scatter a few draughts. */
function pseudorandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Pile = {
  at: [number, number];
  holds: number;
  discs: { nudge: [number, number]; spin: number; tilt: [number, number] }[];
};

/**
 * How one player's piles fall: where they sit, how many each takes and how
 * squarely each disc lands. Seeded from the game's id, so it is settled for a
 * table and different between them without the server storing any of it — and
 * stable across re-renders and reconnects, which a live Math.random would not
 * be. Jitter is kept inside the margin the anchors were checked against, so a
 * pile cannot wander off frame or into its neighbour.
 */
function pileLayout(seed: string): Pile[] {
  const next = pseudorandom(seedFrom(seed));
  return PILES.map(([x, z]) => ({
    at: [x + (next() - 0.5) * 0.28, z + (next() - 0.5) * 0.32],
    holds: PILE_MIN + Math.floor(next() * PILE_RANGE),
    discs: Array.from({ length: PILE_MIN + PILE_RANGE }, () => ({
      nudge: [(next() - 0.5) * 0.1, (next() - 0.5) * 0.1] as [number, number],
      spin: next() * Math.PI * 2,
      tilt: [(next() - 0.5) * 0.055, (next() - 0.5) * 0.055] as [number, number],
    })),
  }));
}
/** The shared 0..1 breath every "this can move" cue rides on, so they agree. */
const breathe = (time: number, calm: boolean) => (calm ? 0.55 : 0.5 + 0.5 * Math.sin(time * 3.4));
const cueLift = (time: number, calm: boolean) => 0.26 + 0.58 * breathe(time, calm);
/** Where the overhead view settles: shy of the pole, where roll is still defined. */
const OVERHEAD = 0.02;
/** How wide the lamplight is at a given height: widest at the table, pinched at the bulb. */
const beamRadius = (height: number) => 0.42 + Math.max(0, LAMP_HEIGHT - height) * 0.6;
/**
 * A draughts piece in profile, to be revolved: flat base, rounded shoulders,
 * slightly proud top. A bare cylinder has a hard rim no moulded piece has, and
 * that rim is exactly where the lamp catches it.
 */
const PIECE_PROFILE = (() => {
  const radius = 0.42;
  const half = 0.09;
  const bevel = 0.042;
  const points = [new THREE.Vector2(0, -half), new THREE.Vector2(radius - bevel, -half)];
  const shoulder = (centreY: number, from: number, to: number) => {
    for (let step = 1; step <= 4; step++) {
      const angle = from + (to - from) * (step / 4);
      points.push(new THREE.Vector2(radius - bevel + Math.cos(angle) * bevel, centreY + Math.sin(angle) * bevel));
    }
  };
  shoulder(-half + bevel, -Math.PI / 2, 0);
  points.push(new THREE.Vector2(radius, half - bevel - 0.012));
  shoulder(half - bevel, 0, Math.PI / 2);
  points.push(new THREE.Vector2(0, half));
  return points;
})();

/** The same map on all 64 squares reads as printed, so each takes one of a few tones. */
const DARK_SQUARES = ["#54361f", "#583a23", "#5d3e27", "#563823", "#5a3c25"];
const LIGHT_SQUARES = ["#d4b88c", "#d8bd91", "#dcc196", "#d6ba8e", "#dabf93"];
/** The cloth turns from baize green toward blue while the move is not yours. */
const CLOTH_GREEN = new THREE.Color("#17693b");
const CLOTH_BLUE = new THREE.Color("#12586e");
const SHEEN_GREEN = new THREE.Color("#4f9c6a");
const SHEEN_BLUE = new THREE.Color("#4d87a0");

/** Where the red player's drink stands; the black player's sits at the negation. */
const DRINK = { x: 5.85, y: -0.355, z: 2.8 };
/** Sat in the whiskey, which pools at y 0.43 inside the glass. */
const ICE: { at: [number, number, number]; turn: [number, number, number]; size: number }[] = [
  { at: [0.1, 0.29, -0.06], turn: [0.35, 0.62, 0.14], size: 0.22 },
  { at: [-0.12, 0.25, 0.09], turn: [-0.22, 0.95, 0.38], size: 0.2 },
];

/**
 * The wood grain is a build-time download, not a checked-in asset, so the board
 * has to look right without it. A missing file just leaves the flat colours.
 */
function useWoodGrain(url: string, repeat = 2) {
  const [texture, setTexture] = useState<THREE.Texture>();
  useEffect(() => {
    let live = true;
    new THREE.TextureLoader().load(url, (loaded) => {
      if (!live) return void loaded.dispose();
      loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
      loaded.repeat.set(repeat, repeat);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = 8;
      setTexture(loaded);
    }, undefined, () => {});
    return () => { live = false; };
  }, [url, repeat]);
  return texture;
}

/**
 * A soft round puff, shared by the haze, the dust motes and the bulb glow.
 * Drawing it beats shipping another texture, and it is the same handful of
 * bytes for every effect that needs a falloff.
 */
let softSprite: THREE.CanvasTexture | undefined;
function softSpriteTexture() {
  if (softSprite) return softSprite;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.26)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  softSprite = new THREE.CanvasTexture(canvas);
  return softSprite;
}

/**
 * A torn, wispy puff for the smoke. The clean falloff of a single gradient
 * reads as a dust ball; stacking off-centre blobs and masking the edge gives
 * something with a shape to it, and a fixed seed keeps it stable across loads.
 */
let smokeSprite: THREE.CanvasTexture | undefined;
function smokeTexture() {
  if (smokeSprite) return smokeSprite;
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  let seed = 1337;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let blob = 0; blob < 22; blob++) {
    const radius = size * (0.1 + random() * 0.22);
    const x = size / 2 + (random() - 0.5) * size * 0.44;
    const y = size / 2 + (random() - 0.5) * size * 0.44;
    const blobGradient = context.createRadialGradient(x, y, 0, x, y, radius);
    blobGradient.addColorStop(0, `rgba(255,255,255,${(0.1 + random() * 0.12).toFixed(3)})`);
    blobGradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = blobGradient;
    context.fillRect(0, 0, size, size);
  }
  context.globalCompositeOperation = "destination-in";
  const mask = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  mask.addColorStop(0, "rgba(255,255,255,1)");
  mask.addColorStop(0.55, "rgba(255,255,255,0.8)");
  mask.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = mask;
  context.fillRect(0, 0, size, size);
  smokeSprite = new THREE.CanvasTexture(canvas);
  return smokeSprite;
}

/**
 * Baize speckle. A flat plane this size reads as plastic under a single lamp,
 * and the wood grain obviously cannot come along, so the weave is generated.
 */
let feltSprite: THREE.CanvasTexture | undefined;
function feltTexture() {
  if (feltSprite) return feltSprite;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const weave = context.createImageData(size, size);
  let seed = 90210;
  for (let pixel = 0; pixel < weave.data.length; pixel += 4) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const shade = 226 + (seed / 4294967296) * 29;
    weave.data[pixel] = weave.data[pixel + 1] = weave.data[pixel + 2] = shade;
    weave.data[pixel + 3] = 255;
  }
  context.putImageData(weave, 0, 0);
  feltSprite = new THREE.CanvasTexture(canvas);
  feltSprite.wrapS = feltSprite.wrapT = THREE.RepeatWrapping;
  feltSprite.repeat.set(34, 34);
  feltSprite.anisotropy = 4;
  return feltSprite;
}

/**
 * The soft dark pool the board sits in. This was a per-frame contact-shadow
 * pass, which is what blanked the canvas; nothing under here ever moves, so a
 * drawn-once decal buys the same weight — and the same falloff across the
 * cloth, which was carrying more of the mood than it looked like.
 */
let contactSprite: THREE.CanvasTexture | undefined;
function contactTexture() {
  if (contactSprite) return contactSprite;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const inset = size * 0.19;
  context.shadowColor = "rgba(0,0,0,0.85)";
  context.shadowBlur = size * 0.11;
  context.fillStyle = "rgba(0,0,0,0.92)";
  context.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  contactSprite = new THREE.CanvasTexture(canvas);
  return contactSprite;
}

/** Reduced-motion players still get the bar lit and hazy, just nothing that drifts or buzzes. */
function useCalm() {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setCalm(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return calm;
}

/**
 * Who opens looking straight down. A tablet is held rather than sat in front
 * of, and the angled view spends a third of its height on the room instead of
 * the board — the wrong trade on a small screen. A fine pointer means a desk
 * and a wide window, where the room is the point, so desktop keeps the angle.
 */
const TOP_DOWN = "(pointer: coarse), (max-width: 1024px)";
/** How far the camera sits out; the fit handles framing, so this only sets how much perspective there is. */
const EYE_DISTANCE = 16.7;

/**
 * Settled once, on mount. Re-deciding it on resize — or on a phone's rotate,
 * which changes both of those conditions at once — would swing the camera out
 * from under a player who had already turned the table to suit themselves.
 */
function useTopDownStart() {
  const [topDown] = useState(() => window.matchMedia(TOP_DOWN).matches);
  return topDown;
}

function CameraRig() {
  const { size } = useThree();
  const compact = size.width < 720;
  const topDown = useTopDownStart();
  const camera = useRef<THREE.PerspectiveCamera>(null);
  useEffect(() => { camera.current?.lookAt(0, 0, 0); }, [compact]);
  // Opening at OVERHEAD rather than dead down, for the same reason the snap
  // stops short of it: the pole has no defined roll, and the controls clamp
  // there anyway, so starting past it would just be dragged back.
  const position: [number, number, number] = topDown
    ? [0, Math.cos(OVERHEAD) * EYE_DISTANCE, Math.sin(OVERHEAD) * EYE_DISTANCE]
    : [compact ? 1.1 : 1.5, compact ? 11 : 9.6, compact ? 12.5 : 11.6];
  return <PerspectiveCamera ref={camera} makeDefault position={position} fov={compact ? 47 : 43} />;
}

function TableControls() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, gl, size } = useThree();
  /** Wheel zoom, on top of the fit. 1 is the whole board; above that, closer in. */
  const closeness = useRef(1);
  const frameBoard = useCallback(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let extent = 0;
    for (const x of [-4.75, 4.75]) for (const y of [-0.4, 0.9]) for (const z of [-4.75, 4.75]) {
      const corner = new THREE.Vector3(x, y, z).project(camera);
      extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
    }
    camera.zoom = (0.9 / extent) * closeness.current;
    camera.updateProjectionMatrix();
  }, [camera]);
  useLayoutEffect(frameBoard, [frameBoard, size.width, size.height]);

  // Dollying would be undone by the fit on the next frame, so the wheel scales
  // the fit itself. Non-passive, or the browser claims the gesture first.
  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      closeness.current = THREE.MathUtils.clamp(closeness.current * Math.pow(0.999, event.deltaY), 0.8, 2.75);
      frameBoard();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [frameBoard, gl]);

  function snapOverhead() {
    const control = controls.current;
    if (!control || control.getPolarAngle() > 0.28) return;
    // Dead overhead is a gimbal pole: the view runs along the up vector, so the
    // roll is whatever the look-at math lands on and the azimuth stops meaning
    // anything. A degree short of it keeps up meaningful, looks identical, and
    // leaves the board square to the screen. With damping off both land exactly.
    control.setAzimuthalAngle(0);
    control.setPolarAngle(OVERHEAD);
    control.update();
    frameBoard();
  }
  return <OrbitControls ref={controls} makeDefault enableDamping={false} enablePan={false} enableZoom={false} minPolarAngle={OVERHEAD} maxPolarAngle={1.05} minAzimuthAngle={-0.25} maxAzimuthAngle={0.25} onChange={frameBoard} onEnd={snapOverhead} mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }} />;
}

/**
 * The visible cone of lamplight. Brightest at the bulb and along the
 * silhouette, where a viewer looks through the most air, and faded to nothing
 * before it reaches the table so it never draws a seam across the board.
 */
function useShaftMaterial() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color("#ffc98a") }, strength: { value: SHAFT_STRENGTH } },
    vertexShader: `
      varying vec2 grain;
      varying vec3 face;
      varying vec3 toEye;
      void main() {
        grain = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        face = normalize(mat3(modelMatrix) * normal);
        toEye = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying vec2 grain;
      varying vec3 face;
      varying vec3 toEye;
      void main() {
        float along = pow(clamp(grain.y, 0.0, 1.0), 1.8);
        float rim = pow(1.0 - abs(dot(face, toEye)), 1.5);
        gl_FragColor = vec4(color, strength * along * (0.35 + 0.9 * rim));
      }`,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/**
 * Dust rising on the heat of the bulb. Each mote keeps a fractional radius and
 * an angle rather than a fixed point, so recomputing it against the beam width
 * at its current height means the column always keeps the shape of the light.
 */
function DustMotes({ calm }: { calm: boolean }) {
  const motes = useMemo(() => Array.from({ length: 260 }, () => ({
    spread: Math.sqrt(Math.random()),
    angle: Math.random() * Math.PI * 2,
    rise: 0.055 + Math.random() * 0.13,
    swirl: (Math.random() - 0.5) * 0.11,
    height: 0.18 + Math.random() * (LAMP_HEIGHT - 0.6),
  })), []);
  const geometry = useMemo(() => {
    const positions = new Float32Array(motes.length * 3);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return buffer;
  }, [motes]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const place = useCallback((time: number, delta: number) => {
    const attribute = geometry.attributes.position as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    motes.forEach((mote, index) => {
      mote.height += mote.rise * delta;
      if (mote.height > LAMP_HEIGHT - 0.35) mote.height = 0.18;
      const radius = mote.spread * beamRadius(mote.height);
      const turn = mote.angle + time * mote.swirl;
      positions.set([Math.cos(turn) * radius, mote.height, Math.sin(turn) * radius], index * 3);
    });
    attribute.needsUpdate = true;
  }, [geometry, motes]);
  useLayoutEffect(() => place(0, 0), [place]);
  useFrame(({ clock }, delta) => { if (!calm) place(clock.elapsedTime, delta); });
  return <points geometry={geometry}>
    <pointsMaterial map={softSpriteTexture()} color="#ffd39a" size={0.075} sizeAttenuation transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
  </points>;
}

/**
 * Cigarette smoke climbing through the beam. Every puff rises on its own
 * clock, swelling and fanning out as it goes, turning slowly and thinning to
 * nothing at the top, which is what separates smoke from a cloud of dust.
 */
function Smoke({ calm }: { calm: boolean }) {
  const column = useRef<THREE.Group>(null);
  const puffs = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    // The golden ratio spaces the puffs through the cycle without them pairing up.
    phase: (i * 0.618) % 1,
    lane: i * 2.39,
    orbit: 0.3 + ((i * 3) % 5) * 0.3,
    size: 1.7 + ((i * 7) % 4) * 0.6,
    life: 16 + ((i * 5) % 6) * 2.6,
    spin: (i % 2 ? 1 : -1) * (0.04 + ((i * 11) % 4) * 0.018),
    peak: 0.075 + ((i * 13) % 3) * 0.018,
  })), []);
  useFrame(({ clock }) => {
    if (!column.current) return;
    // A fixed sample leaves a settled, non-symmetric drift when motion is off.
    const time = calm ? 23 : clock.elapsedTime;
    column.current.children.forEach((puff, index) => {
      const { phase, lane, orbit, size, life, spin, peak } = puffs[index];
      const cycle = (time / life + phase) % 1;
      const wander = lane + cycle * 3.4;
      const spread = orbit + cycle * 1.45;
      puff.position.set(Math.cos(wander) * spread, 0.32 + cycle * (LAMP_HEIGHT - 0.9), Math.sin(wander * 0.85) * spread);
      puff.scale.setScalar(size * (0.5 + cycle * 1.3));
      const material = (puff as THREE.Sprite).material;
      material.opacity = peak * Math.sin(Math.PI * cycle) ** 1.3;
      material.rotation = lane + time * spin;
    });
  });
  return <group ref={column}>{puffs.map((_, index) => <sprite key={index}>
    <spriteMaterial map={smokeTexture()} color="#e8d6b4" transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.05} />
  </sprite>)}</group>;
}

/**
 * Shade, bulb and beam, swinging just enough to feel like a room someone walks
 * through. Looking straight down puts the lamp between the camera and the
 * board, so the fixture and its beam fade out as the view comes overhead —
 * the light itself stays, only the thing in the way goes.
 */
function Pendant({ calm }: { calm: boolean }) {
  const fixture = useRef<THREE.Group>(null);
  const shaft = useShaftMaterial();
  useFrame(({ camera, clock }) => {
    if (!fixture.current) return;
    const polar = Math.acos(THREE.MathUtils.clamp(camera.position.y / camera.position.length(), -1, 1));
    const shown = THREE.MathUtils.smoothstep(polar, 0.12, 0.42);
    fixture.current.visible = shown > 0.01;
    fixture.current.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (!material || Array.isArray(material)) return;
      material.userData.base ??= material.opacity;
      material.transparent = true;
      material.opacity = material.userData.base * shown;
    });
    shaft.uniforms.strength.value = SHAFT_STRENGTH * shown;
    if (calm) return;
    const time = clock.elapsedTime;
    fixture.current.rotation.z = Math.sin(time * 0.31) * 0.013;
    fixture.current.rotation.x = Math.cos(time * 0.22) * 0.01;
  });
  // Hung from the ceiling so the sway pivots up there, where the cord is knotted.
  const cord = CEILING - (LAMP_HEIGHT + SHADE_HEIGHT);
  return <group ref={fixture} position={[0, CEILING, 0]}>
    <mesh position={[0, -cord / 2, 0]}>
      <cylinderGeometry args={[0.035, 0.035, cord, 8]} />
      <meshStandardMaterial color="#14100d" roughness={0.8} />
    </mesh>
    <mesh position={[0, LAMP_HEIGHT + SHADE_HEIGHT / 2 - CEILING, 0]}>
      <cylinderGeometry args={[0.36, 1.18, SHADE_HEIGHT, 40, 1, true]} />
      <meshStandardMaterial color="#7d4c22" roughness={0.31} metalness={0.85} envMapIntensity={1.3} emissive="#d9781f" emissiveIntensity={0.12} />
    </mesh>
    <mesh position={[0, LAMP_HEIGHT + SHADE_HEIGHT / 2 - CEILING, 0]}>
      <cylinderGeometry args={[0.355, 1.175, SHADE_HEIGHT, 40, 1, true]} />
      <meshStandardMaterial color="#2a1a0e" side={THREE.BackSide} emissive="#ffb055" emissiveIntensity={0.72} roughness={0.8} />
    </mesh>
    <mesh position={[0, LAMP_HEIGHT - CEILING + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1.17, 0.035, 8, 44]} />
      <meshBasicMaterial color="#ffc07a" />
    </mesh>
    <mesh position={[0, LAMP_HEIGHT - CEILING, 0]}>
      <sphereGeometry args={[0.2, 20, 16]} />
      <meshBasicMaterial color="#ffd9a0" />
    </mesh>
    <sprite position={[0, LAMP_HEIGHT - CEILING, 0]} scale={1.9}>
      <spriteMaterial map={softSpriteTexture()} color="#ffbe72" transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
    <mesh position={[0, (LAMP_HEIGHT - 0.05) / 2 - CEILING, 0]} material={shaft}>
      <coneGeometry args={[beamRadius(0), LAMP_HEIGHT - 0.05, 44, 1, true]} />
    </mesh>
  </group>;
}

/**
 * Two signs across the room, off camera. The buzz is a stack of sines rather
 * than a random number so the two tubes never flicker in step.
 */
function NeonWash({ calm }: { calm: boolean }) {
  const signs = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(({ clock }) => {
    if (calm) return;
    const time = clock.elapsedTime;
    signs.current.forEach((sign, index) => {
      if (!sign) return;
      const offset = index * 2.7;
      const buzz = Math.sin(time * 21.3 + offset) * 0.5 + Math.sin(time * 8.7 + offset) * 0.3 + Math.sin(time * 3.1 + offset) * 0.2;
      sign.intensity = sign.userData.base * (1 + buzz * 0.07);
    });
  });
  return <>
    <pointLight ref={(light) => { signs.current[0] = light; if (light) light.userData.base = 21; }} position={[-9.5, 2.6, -6.5]} intensity={21} distance={24} decay={2} color="#ff2d7f" />
    <pointLight ref={(light) => { signs.current[1] = light; if (light) light.userData.base = 26; }} position={[9.6, 2.1, -5.2]} intensity={26} distance={24} decay={2} color="#17c8ff" />
  </>;
}

/**
 * The red player's drink. Both drinks live in board space, diagonally opposite,
 * so the 180 degree flip between seats swaps them: whichever colour you play,
 * your own glass or cup is the one on your side of the table.
 */
function Tumbler({ calm }: { calm: boolean }) {
  const ice = useRef<THREE.Group>(null);
  // Ice sits in liquid, so it turns and rides the surface. Small amplitudes:
  // the cubes nearly fill the glass and must not swim through its wall.
  useFrame(({ clock }) => {
    if (!ice.current) return;
    const time = calm ? 8 : clock.elapsedTime;
    ice.current.children.forEach((cube, index) => {
      const { at, turn } = ICE[index];
      const phase = index * 2.1;
      const bob = Math.sin(time * 0.55 + phase);
      cube.position.set(
        at[0] + Math.sin(time * 0.31 + phase) * 0.017,
        at[1] + bob * 0.014,
        at[2] + Math.cos(time * 0.27 + phase) * 0.017,
      );
      cube.rotation.set(
        turn[0] + bob * 0.05,
        turn[1] + time * (index % 2 ? -0.055 : 0.045),
        turn[2] + Math.cos(time * 0.4 + phase) * 0.06,
      );
    });
  });
  /*
    Alpha rather than transmission, deliberately. A transmissive material makes
    three swap render targets mid-frame to capture its backdrop, which fights
    the effect composer for them and drops frames. It also only ever samples
    *opaque* objects, so it forced the whiskey to be solid to stay visible
    through the wall. Blending keeps both the frame rate and the translucency;
    the ice stays opaque, which is what stopped it sorting against itself.
  */
  const glass = { roughness: 0.04, metalness: 0, transparent: true, opacity: 0.26, color: "#c8dad6", depthWrite: false, envMapIntensity: 1.6, specularIntensity: 1 } as const;
  return <group position={[DRINK.x, DRINK.y, DRINK.z]}>
    <mesh position={[0, 0.02, 0]} receiveShadow>
      <cylinderGeometry args={[0.62, 0.62, 0.04, 32]} />
      <meshStandardMaterial color="#2a201a" roughness={0.92} />
    </mesh>
    <mesh position={[0, 0.07, 0]} renderOrder={1} castShadow>
      <cylinderGeometry args={[0.37, 0.37, 0.1, 30]} />
      <meshPhysicalMaterial {...glass} />
    </mesh>
    {/* Golden and see-through: the clearcoat puts the lamp on the surface,
        which is the part that reads as liquid rather than resin. */}
    <mesh position={[0, 0.23, 0]} renderOrder={2}>
      <cylinderGeometry args={[0.39, 0.368, 0.24, 30]} />
      <meshPhysicalMaterial color="#a8661a" emissive="#7a4205" emissiveIntensity={0.35} roughness={0.05} metalness={0} envMapIntensity={1.3} transparent opacity={0.72} depthWrite={false} clearcoat={0.7} clearcoatRoughness={0.1} />
    </mesh>
    <mesh position={[0, 0.41, 0]} renderOrder={3} castShadow>
      <cylinderGeometry args={[0.42, 0.372, 0.68, 30, 1, true]} />
      <meshPhysicalMaterial {...glass} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 0.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.415, 0.013, 6, 30]} />
      <meshStandardMaterial color="#f0f7f4" roughness={0.1} metalness={0.3} />
    </mesh>
    {/*
      Frosted and opaque. Two see-through cubes inside a see-through glass left
      their blend order to whichever centroid sorted nearer, which is why one
      vanished and the other changed tone as the view moved. Opaque cubes go
      through the depth buffer instead, and the whiskey — drawn after, over
      whatever depth already holds — tints the submerged part by itself.
    */}
    <group ref={ice}>{ICE.map((cube, index) => <mesh key={index} position={cube.at} rotation={cube.turn} castShadow>
      <boxGeometry args={[cube.size, cube.size, cube.size]} />
      <meshPhysicalMaterial color="#eaf6fa" roughness={0.08} metalness={0} envMapIntensity={1.9} clearcoat={1} clearcoatRoughness={0.04} emissive="#9fc4d6" emissiveIntensity={0.08} specularIntensity={1} />
    </mesh>)}</group>
  </group>;
}

/** The black player's espresso, gone cold two moves ago. */
function Espresso({ calm }: { calm: boolean }) {
  const china = { color: "#efe7dc", roughness: 0.22, metalness: 0.04, envMapIntensity: 0.5 } as const;
  const steam = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!steam.current) return;
    const time = calm ? 11 : clock.elapsedTime;
    steam.current.children.forEach((wisp, index) => {
      const cycle = (time / 5.5 + index * 0.37) % 1;
      wisp.position.set(Math.sin(cycle * 4 + index) * 0.11, 0.4 + cycle * 0.72, Math.cos(cycle * 3.2 + index) * 0.11);
      wisp.scale.setScalar(0.4 + cycle * 0.9);
      const material = (wisp as THREE.Sprite).material;
      material.opacity = 0.11 * Math.sin(Math.PI * cycle) ** 1.4;
      material.rotation = index + cycle * 1.6;
    });
  });
  return <group position={[-DRINK.x, DRINK.y, -DRINK.z]}>
    <mesh position={[0, 0.02, 0]} receiveShadow>
      <cylinderGeometry args={[0.66, 0.6, 0.04, 32]} />
      <meshStandardMaterial {...china} />
    </mesh>
    <mesh position={[0, 0.055, 0]}>
      <cylinderGeometry args={[0.33, 0.33, 0.03, 28]} />
      <meshStandardMaterial {...china} />
    </mesh>
    <mesh position={[0, 0.23, 0]} castShadow>
      <cylinderGeometry args={[0.4, 0.33, 0.36, 28, 1, true]} />
      <meshStandardMaterial {...china} side={THREE.DoubleSide} />
    </mesh>
    {/* Glossy, so the lamp lands in the crema the way it does in the whiskey. */}
    <mesh position={[0, 0.175, 0]}>
      <cylinderGeometry args={[0.37, 0.335, 0.2, 28]} />
      <meshStandardMaterial color="#3a2110" roughness={0.16} metalness={0.1} />
    </mesh>
    <mesh position={[0.43, 0.22, 0]} castShadow>
      <torusGeometry args={[0.13, 0.026, 8, 18]} />
      <meshStandardMaterial {...china} />
    </mesh>
    <group ref={steam}>{[0, 1, 2].map((wisp) => <sprite key={wisp}>
      <spriteMaterial map={smokeTexture()} color="#d8d2c4" transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.05} />
    </sprite>)}</group>
  </group>;
}

/**
 * The disc itself. Shared by the pieces in play and the piles of taken ones so
 * a captured piece cannot drift out of step with the board's.
 */
function Draught({ side, king, collar }: { side: number; king?: boolean; collar?: React.Ref<THREE.MeshStandardMaterial> }) {
  return <>
    <mesh castShadow receiveShadow>
      <latheGeometry args={[PIECE_PROFILE, 48]} />
      {/* Clearcoat catches the lamp, which is what sells a bakelite draught piece under a bar light. */}
      <meshPhysicalMaterial color={side === 0 ? "#ae392d" : "#202222"} roughness={0.42} metalness={0.06} envMapIntensity={0.45} clearcoat={0.25} clearcoatRoughness={0.5} specularIntensity={0.45} />
    </mesh>
    <mesh position={[0, 0.095, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.24, 0.31, 40]} />
      <meshStandardMaterial ref={collar} color={side === 0 ? "#d66a55" : "#4c504e"} emissive={side === 0 ? "#ff8b66" : "#9fb0a6"} emissiveIntensity={0} roughness={0.4} />
    </mesh>
    {king && <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.08, 0.18, 6]} />
      <meshStandardMaterial color="#d9ae60" metalness={0.65} roughness={0.22} />
    </mesh>}
  </>;
}

/** A pile of pieces someone has taken, sat on the cloth beside them. */
function CapturedPile({ pile, count, side, mirrored }: { pile: Pile; count: number; side: number; mirrored: boolean }) {
  const [x, z] = mirrored ? [-pile.at[0], -pile.at[1]] : pile.at;
  // 0.195 of clearance a disc: enough that a tilted one still rests clear of
  // the one below rather than sinking into it.
  return <>{pile.discs.slice(0, count).map((disc, level) => (
    <group key={level} position={[x + disc.nudge[0], -0.268 + level * 0.195, z + disc.nudge[1]]} rotation={[disc.tilt[0], disc.spin, disc.tilt[1]]}>
      <Draught side={side} />
    </group>
  ))}</>;
}

function Piece({ piece, position, selected, required, canSelect, flipped, calm, slideFrom, onSelect, onDrop }: {
  piece: number; position: Position; selected: boolean; required: boolean; canSelect: boolean;
  flipped: boolean; calm: boolean; slideFrom?: Position; onSelect: (p: Position) => void; onDrop: (from: Position, to: Position) => void;
}) {
  const [drag, setDrag] = useState<THREE.Vector3>();
  const boardPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIECE_REST), []);
  const body = useRef<THREE.Group>(null);
  const collar = useRef<THREE.MeshStandardMaterial>(null);
  const travelled = useRef(1);
  const square = (at: Position) => new THREE.Vector3(at.col - 3.5, PIECE_REST, at.row - 3.5);
  const base = useMemo(() => square(position), [position.col, position.row]);
  const origin = useMemo(() => (slideFrom ? square(slideFrom) : undefined), [slideFrom]);

  // A piece arriving from the other side of the table mounts on its old square
  // and walks over, so the opponent's move is something you watch happen.
  useLayoutEffect(() => {
    travelled.current = origin ? 0 : 1;
    body.current?.position.copy(origin ?? base);
  }, [base, origin]);
  useFrame((state, delta) => {
    const node = body.current;
    if (!node) return;
    // The piece's own ring brightens instead of wearing a white one.
    if (collar.current) collar.current.emissiveIntensity = required ? cueLift(state.clock.elapsedTime, calm) : 0;
    const settle = () => { node.scale.setScalar(selected ? 1.08 : 1); node.rotation.z = 0; };
    if (drag) { node.position.copy(drag); node.scale.setScalar(1.12); node.rotation.z = 0; return; }
    if (!origin || travelled.current >= 1) { node.position.copy(base); settle(); return; }
    travelled.current = Math.min(1, travelled.current + delta / SLIDE_SECONDS);
    const eased = 1 - (1 - travelled.current) ** 3;
    // Picked up, carried over and set down: the arc, the swell and the tilt
    // together are what make it read as a hand moving a piece.
    const arc = Math.sin(Math.PI * eased);
    node.position.lerpVectors(origin, base, eased);
    node.position.y = base.y + arc * (0.32 + origin.distanceTo(base) * 0.13);
    node.scale.setScalar(1 + arc * 0.1);
    node.rotation.z = arc * 0.13;
  });
  function point(event: ThreeEvent<PointerEvent>) {
    const hit = new THREE.Vector3();
    if (!event.ray.intersectPlane(boardPlane, hit)) return undefined;
    return flipped ? hit.set(-hit.x, hit.y, -hit.z) : hit;
  }
  function down(event: ThreeEvent<PointerEvent>) {
    if (!canSelect || event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    onSelect(position);
    setDrag(point(event)?.setY(0.72));
  }
  function move(event: ThreeEvent<PointerEvent>) { if (drag) { event.stopPropagation(); const next = point(event); if (next) setDrag(next.setY(0.72)); } }
  function up(event: ThreeEvent<PointerEvent>) {
    if (!drag) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture(event.pointerId);
    const hit = point(event);
    setDrag(undefined);
    if (hit) onDrop(position, { row: Math.round(hit.z + 3.5), col: Math.round(hit.x + 3.5) });
  }
  return <group ref={body} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
    <Draught side={owner(piece)} king={piece >= 3} collar={collar} />
  </group>;
}

/**
 * Work out what the other player just did by diffing the board against the one
 * it replaced. Exactly one square gains a piece per ply, so the move is
 * recoverable here and the server never has to describe it.
 */
function inferMove(before: number[][], after: number[][], player: number) {
  const vacated: Position[] = [];
  let landed: Position | undefined;
  let landings = 0;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    if (before[row][col] === after[row][col]) continue;
    if (after[row][col] === 0) vacated.push({ row, col });
    else if (before[row][col] === 0) { landed = { row, col }; landings++; }
  }
  // More than one landing means revisions were skipped, and the diff no longer
  // describes a single move; your own move already happened under your hand.
  if (!landed || landings > 1) return undefined;
  const mover = owner(after[landed.row][landed.col]);
  if (mover === player) return undefined;
  const from = vacated.find((square) => owner(before[square.row][square.col]) === mover);
  return from ? { from, to: landed } : undefined;
}

function useOpponentMove(game: PublicGame, player: number) {
  const seen = useRef<{ id: string; revision: number; board: number[][] }>();
  const slide = useRef<{ from: Position; to: Position }>();
  const previous = seen.current;
  if (!previous || previous.id !== game.id || previous.revision !== game.revision) {
    slide.current = previous && previous.id === game.id && game.revision > previous.revision
      ? inferMove(previous.board, game.board, player)
      : undefined;
    seen.current = { id: game.id, revision: game.revision, board: game.board };
  }
  return slide.current;
}

/**
 * Where a piece could go, shown as the shadow it would cast there rather than
 * by lighting the square up: unlit and dark, so it sits under the lamp like
 * every other shadow on the board instead of glowing out of the wood.
 */
function TargetShadow({ at, calm }: { at: Position; calm: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = ring.current;
    if (!mesh) return;
    const breath = breathe(clock.elapsedTime, calm);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.24 + 0.32 * breath;
    mesh.scale.setScalar(0.93 + 0.11 * breath);
  });
  return <mesh ref={ring} position={[at.col - 3.5, 0.049, at.row - 3.5]} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[0.26, 0.39, 44]} />
    <meshBasicMaterial color="#150b03" transparent opacity={0.3} depthWrite={false} />
  </mesh>;
}

function Table({ game, player, onMove, disabled }: Props) {
  const calmMotion = useCalm();
  const wood = useWoodGrain("/textures/wood-table-001.jpg");
  const arriving = useOpponentMove(game, player);
  const [selected, setSelected] = useState<Position | undefined>(game.forced);
  const requiredSources = game.turn === player ? captureSources(game, player) : [];
  useEffect(() => {
    if (game.forced) setSelected(game.forced);
    else if (game.turn === player && requiredSources.length === 1) setSelected(requiredSources[0]);
    else setSelected(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requiredSources is derived from these
  }, [game.revision, game.turn, player]);
  const legal = selected ? legalTargets(game, player, selected) : [];
  // What each side has taken: twelve discs a colour, less those still standing.
  const live = game.board.flat();
  const taken = [12 - live.filter((disc) => disc === 2 || disc === 4).length, 12 - live.filter((disc) => disc === 1 || disc === 3).length];
  // A layout each, so the two sides are not mirror images of one another.
  const piles = useMemo(() => [pileLayout(`${game.id}:red`), pileLayout(`${game.id}:black`)], [game.id]);
  function chooseSquare(to: Position) {
    if (selected && legal.some((p) => same(p, to))) { onMove({ from: selected, to }); setSelected(undefined); }
    else if (owner(game.board[to.row][to.col]) === player) setSelected(to);
  }
  function drop(from: Position, to: Position) {
    if (legalTargets(game, player, from).some((p) => same(p, to))) { onMove({ from, to }); setSelected(undefined); }
  }
  return <group rotation={[0, player === 1 ? Math.PI : 0, 0]}>
    <Tumbler calm={calmMotion} />
    <Espresso calm={calmMotion} />
    <mesh position={[0, -0.18, 0]} receiveShadow castShadow>
      <boxGeometry args={[9.25, 0.35, 9.25]} />
      <meshStandardMaterial map={wood} color="#93613c" roughness={0.5} envMapIntensity={0.12} />
    </mesh>
    {legal.map((at) => <TargetShadow key={`${at.row}-${at.col}`} at={at} calm={calmMotion} />)}
    {[0, 1].flatMap((captor) => {
      // Fill a pile before starting the next, the way a hand would.
      let left = taken[captor];
      return piles[captor].map((pile, index) => {
        const height = Math.min(pile.holds, left);
        left -= height;
        // Red keeps its winnings on its own side of the table; black mirrors it.
        return height > 0
          ? <CapturedPile key={`${captor}-${index}`} pile={pile} count={height} side={1 - captor} mirrored={captor === 1} />
          : null;
      });
    })}
    {game.board.flatMap((row, r) => row.map((piece, c) => {
      const dark = (r + c) % 2 === 1;
      const tone = (dark ? DARK_SQUARES : LIGHT_SQUARES)[(r * 7 + c * 13) % 5];
      const position = { row: r, col: c };
      const mustMoveThisPiece = requiredSources.some((source) => same(source, position));
      const canSelect = !disabled && game.turn === player && owner(piece) === player && (!requiredSources.length || mustMoveThisPiece);
      return <group key={`${r}-${c}`}>
        <mesh position={[c - 3.5, 0.015, r - 3.5]} receiveShadow onClick={(event) => { event.stopPropagation(); chooseSquare(position); }}>
          <boxGeometry args={[0.99, 0.06, 0.99]} />
          <meshStandardMaterial color={tone} roughness={0.62} envMapIntensity={0.12} map={dark ? wood : undefined} />
        </mesh>
        {piece > 0 && <Piece piece={piece} position={position} selected={same(selected, position)} required={mustMoveThisPiece} canSelect={canSelect} flipped={player === 1} calm={calmMotion} slideFrom={arriving && same(arriving.to, position) ? arriving.from : undefined} onSelect={setSelected} onDrop={drop} />}
      </group>;
    }))}
  </group>;
}

/**
 * An asset-free room for the shiny things to mirror. Metal with nothing to
 * reflect renders as flat paint, and glass with nothing behind it renders as
 * tinted plastic; four emissive panels standing in for the lamp, the two signs
 * and the cloth is most of the difference between computed and photographed.
 * Rendered once, since none of the panels move.
 */
function RoomReflections() {
  return <Environment resolution={96} frames={1} environmentIntensity={0.55}>
    <Lightformer form="circle" intensity={1.6} color="#ffcf92" position={[0, 6.2, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[3.4, 3.4, 1]} />
    <Lightformer form="rect" intensity={0.9} color="#ff2d7f" position={[-9, 2.5, -6]} rotation={[0, Math.PI / 2.4, 0]} scale={[8, 3.5, 1]} />
    <Lightformer form="rect" intensity={0.75} color="#17c8ff" position={[9, 2.2, -5]} rotation={[0, -Math.PI / 2.4, 0]} scale={[8, 3.5, 1]} />
    <Lightformer form="rect" intensity={0.22} color="#1d6b3c" position={[0, -1.2, 3]} rotation={[-Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
  </Environment>;
}

/**
 * The room the board sits in. Everything here is world-fixed rather than part
 * of the board group, so the lamp stays overhead and the drink stays on the
 * near side of the table for both seats.
 */
function BarRoom({ calm, theirs }: { calm: boolean; theirs: boolean }) {
  const cloth = useRef<THREE.MeshPhysicalMaterial>(null);
  const tint = useRef(0);
  useFrame((_, delta) => {
    if (!cloth.current) return;
    tint.current = THREE.MathUtils.damp(tint.current, theirs ? 1 : 0, 3.5, delta);
    cloth.current.color.lerpColors(CLOTH_GREEN, CLOTH_BLUE, tint.current);
    cloth.current.sheenColor.lerpColors(SHEEN_GREEN, SHEEN_BLUE, tint.current);
  });
  return <>
    {/* Casino baize: matte, so the lamp and the neon land on it as coloured
        washes instead of highlights, with a cloth sheen at grazing angles. */}
    <mesh position={[0, -0.358, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[90, 90]} />
      <meshPhysicalMaterial ref={cloth} map={feltTexture()} color="#17693b" roughness={0.95} metalness={0} envMapIntensity={0.06} sheen={0.6} sheenColor="#4f9c6a" sheenRoughness={0.75} />
    </mesh>
    <mesh position={[0, -0.3555, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[14, 14]} />
      <meshBasicMaterial map={contactTexture()} color="#000000" transparent opacity={0.62} depthWrite={false} />
    </mesh>
    <Pendant calm={calm} />
    <DustMotes calm={calm} />
    <Smoke calm={calm} />
  </>;
}

export default function WebGLBoard(props: Props) {
  const calm = useCalm();
  const turn = props.game.status !== "playing" ? "idle" : props.game.turn === props.player ? "yours" : "theirs";
  return <div className="board-canvas" onContextMenu={(event) => event.preventDefault()}>
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.04; }}>
      <fog attach="fog" args={["#07100a", 22, 46]} />
      <CameraRig />
      <TableControls />
      {/* One warm lamp does the work; the rest is spill, so the table falls off into the dark. */}
      {/* Contact-hardening shadows: sharp where a piece meets the board, spreading
          with distance. PCSS rather than accumulated samples, because the pieces move. */}
      <SoftShadows size={22} samples={12} focus={0.9} />
      <RoomReflections />
      <ambientLight intensity={0.24} color="#7c8894" />
      <directionalLight position={[-5, 6, 7]} intensity={0.2} color="#9db4c6" />
      <spotLight castShadow position={[0, LAMP_HEIGHT, 0]} angle={0.9} penumbra={0.9} intensity={104} distance={22} decay={2} color="#ffc98a" shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.02} />
      <pointLight position={[2.6, 1.1, 5.2]} intensity={7} distance={13} decay={2} color="#ffb673" />
      <NeonWash calm={calm} />
      <BarRoom calm={calm} theirs={turn === "theirs"} />
      <Table {...props} />
      {/* The bulb, its rim and the sparks in the beam are the only things over
          threshold, so the glow lands where a camera would blow out. */}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.86} luminanceSmoothing={0.22} radius={0.55} />
      </EffectComposer>
    </Canvas>
  </div>;
}
