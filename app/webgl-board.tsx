"use client";

import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { captureSources, legalTargets, owner, same } from "../lib/rules";
import type { Move, Position, PublicGame } from "../lib/types";

type Props = { game: PublicGame; player: number; onMove: (move: Move) => void; disabled: boolean };

/**
 * The wood grain is a build-time download, not a checked-in asset, so the board
 * has to look right without it. A missing file just leaves the flat colours.
 */
function useWoodGrain(url: string) {
  const [texture, setTexture] = useState<THREE.Texture>();
  useEffect(() => {
    let live = true;
    new THREE.TextureLoader().load(url, (loaded) => {
      if (!live) return void loaded.dispose();
      loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
      loaded.repeat.set(2, 2);
      loaded.colorSpace = THREE.SRGBColorSpace;
      setTexture(loaded);
    }, undefined, () => {});
    return () => { live = false; };
  }, [url]);
  return texture;
}

function CameraRig() {
  const { size } = useThree();
  const compact = size.width < 720;
  const camera = useRef<THREE.PerspectiveCamera>(null);
  useEffect(() => { camera.current?.lookAt(0, 0, 0); }, [compact]);
  return <PerspectiveCamera ref={camera} makeDefault position={[compact ? 1.1 : 1.5, compact ? 11 : 9.6, compact ? 12.5 : 11.6]} fov={compact ? 47 : 43} />;
}

function TableControls() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
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
    camera.zoom = 0.9 / extent;
    camera.updateProjectionMatrix();
  }, [camera]);
  useLayoutEffect(frameBoard, [frameBoard, size.width, size.height]);
  function snapOverhead() {
    const control = controls.current;
    if (!control || control.getPolarAngle() > 0.28) return;
    const distance = camera.position.distanceTo(control.target);
    camera.position.set(control.target.x, control.target.y + distance, control.target.z + 0.0001);
    camera.lookAt(control.target);
    control.update();
    frameBoard();
  }
  return <OrbitControls ref={controls} makeDefault enablePan={false} enableZoom={false} minPolarAngle={0} maxPolarAngle={1.05} minAzimuthAngle={-0.25} maxAzimuthAngle={0.25} onChange={frameBoard} onEnd={snapOverhead} mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }} />;
}

function Piece({ piece, position, selected, required, canSelect, flipped, onSelect, onDrop }: {
  piece: number; position: Position; selected: boolean; required: boolean; canSelect: boolean;
  flipped: boolean; onSelect: (p: Position) => void; onDrop: (from: Position, to: Position) => void;
}) {
  const [drag, setDrag] = useState<THREE.Vector3>();
  const boardPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.34), []);
  const base = new THREE.Vector3(position.col - 3.5, 0.35, position.row - 3.5);
  function point(event: ThreeEvent<PointerEvent>) {
    const hit = new THREE.Vector3();
    if (!event.ray.intersectPlane(boardPlane, hit)) return undefined;
    return flipped ? hit.set(-hit.x, hit.y, -hit.z) : hit;
  }
  function down(event: ThreeEvent<PointerEvent>) {
    if (!canSelect) return;
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
  const king = piece >= 3;
  return <group position={drag ?? base} scale={selected ? 1.08 : 1} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.39, 0.42, 0.18, 48, 2]} />
      <meshStandardMaterial color={owner(piece) === 0 ? "#ae392d" : "#202222"} roughness={0.3} metalness={0.08} />
    </mesh>
    <mesh position={[0, 0.095, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.24, 0.31, 40]} />
      <meshStandardMaterial color={owner(piece) === 0 ? "#d66a55" : "#4c504e"} roughness={0.4} />
    </mesh>
    {king && <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.08, 0.18, 6]} />
      <meshStandardMaterial color="#d9ae60" metalness={0.65} roughness={0.22} />
    </mesh>}
    {required && <mesh position={[0, 0.125, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.34, 0.39, 40]} />
      <meshBasicMaterial color="#fff0bd" transparent opacity={0.95} />
    </mesh>}
  </group>;
}

function Table({ game, player, onMove, disabled }: Props) {
  const wood = useWoodGrain("/textures/wood-table-001.jpg");
  const [selected, setSelected] = useState<Position | undefined>(game.forced);
  const requiredSources = game.turn === player ? captureSources(game, player) : [];
  useEffect(() => {
    if (game.forced) setSelected(game.forced);
    else if (game.turn === player && requiredSources.length === 1) setSelected(requiredSources[0]);
    else setSelected(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requiredSources is derived from these
  }, [game.revision, game.turn, player]);
  const legal = selected ? legalTargets(game, player, selected) : [];
  function chooseSquare(to: Position) {
    if (selected && legal.some((p) => same(p, to))) { onMove({ from: selected, to }); setSelected(undefined); }
    else if (owner(game.board[to.row][to.col]) === player) setSelected(to);
  }
  function drop(from: Position, to: Position) {
    if (legalTargets(game, player, from).some((p) => same(p, to))) { onMove({ from, to }); setSelected(undefined); }
  }
  return <group rotation={[0, player === 1 ? Math.PI : 0, 0]}>
    <mesh position={[0, -0.18, 0]} receiveShadow castShadow>
      <boxGeometry args={[9.25, 0.35, 9.25]} />
      <meshStandardMaterial map={wood} color="#93613c" roughness={0.5} />
    </mesh>
    {game.board.flatMap((row, r) => row.map((piece, c) => {
      const dark = (r + c) % 2 === 1;
      const position = { row: r, col: c };
      const target = legal.some((p) => same(p, position));
      const mustMoveThisPiece = requiredSources.some((source) => same(source, position));
      const canSelect = !disabled && game.turn === player && owner(piece) === player && (!requiredSources.length || mustMoveThisPiece);
      return <group key={`${r}-${c}`}>
        <mesh position={[c - 3.5, 0.015, r - 3.5]} receiveShadow onClick={(event) => { event.stopPropagation(); chooseSquare(position); }}>
          <boxGeometry args={[0.99, 0.06, 0.99]} />
          <meshStandardMaterial color={target ? "#d2a84e" : dark ? "#60402d" : "#d8bd91"} roughness={0.67} map={dark ? wood : undefined} />
        </mesh>
        {target && <mesh position={[c - 3.5, 0.075, r - 3.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.22, 0.29, 32]} /><meshBasicMaterial color="#ffe09b" transparent opacity={0.9} />
        </mesh>}
        {piece > 0 && <Piece piece={piece} position={position} selected={same(selected, position)} required={mustMoveThisPiece} canSelect={canSelect} flipped={player === 1} onSelect={setSelected} onDrop={drop} />}
      </group>;
    }))}
  </group>;
}

export default function WebGLBoard(props: Props) {
  return <div className="board-canvas" onContextMenu={(event) => event.preventDefault()}>
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
      <CameraRig />
      <TableControls />
      <ambientLight intensity={0.85} />
      <directionalLight castShadow position={[-4, 10, 7]} intensity={2.3} shadow-mapSize={[1024, 1024]} />
      <Table {...props} />
      <ContactShadows position={[0, -0.38, 0]} opacity={0.4} scale={13} blur={2.5} far={6} />
    </Canvas>
  </div>;
}
