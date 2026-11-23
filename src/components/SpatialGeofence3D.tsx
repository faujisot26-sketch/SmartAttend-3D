import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, Layers, RotateCcw } from 'lucide-react';
import type { CourseClass } from '../types/attend';

export interface SpatialPin {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  inside: boolean;
}

interface SpatialGeofence3DProps {
  course: CourseClass;
  pins: SpatialPin[];
  heightClass?: string;
}

type CameraPreset = 'isometric' | 'top' | 'street';

export function SpatialGeofence3D({
  course,
  pins,
  heightClass = 'h-[340px]',
}: SpatialGeofence3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [preset, setPreset] = useState<CameraPreset>('isometric');
  const presetRef = useRef<CameraPreset>('isometric');
  const dragAngleRef = useRef<{ theta: number; phi: number }>({ theta: 0.72, phi: 0.68 });
  const pinsGroupRef = useRef<THREE.Group | null>(null);
  const ringMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    presetRef.current = preset;
    if (preset === 'isometric') {
      dragAngleRef.current = { theta: 0.72, phi: 0.68 };
    } else if (preset === 'top') {
      dragAngleRef.current = { theta: 0.0, phi: 0.14 };
    } else {
      dragAngleRef.current = { theta: 1.15, phi: 1.12 };
    }
  }, [preset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setWebglUnavailable(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 340;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0b1220, 1);

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(canvas);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const handleContextRestored = () => {
      setWebglUnavailable(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1220, 0.014);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 250);

    // Three-point studio lighting
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.35);
    keyLight.position.set(18, 28, 16);
    scene.add(keyLight);

    const fillLight = new THREE.AmbientLight(0x94a3b8, 0.75);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-20, 14, -18);
    scene.add(rimLight);

    // Ground plane & architectural grid
    const gridHelper = new THREE.GridHelper(56, 28, 0x334155, 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    const baseDiskGeo = new THREE.CircleGeometry(28, 64);
    const baseDiskMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.92,
      metalness: 0.05,
    });
    const baseDisk = new THREE.Mesh(baseDiskGeo, baseDiskMat);
    baseDisk.rotation.x = -Math.PI / 2;
    baseDisk.position.y = -0.02;
    scene.add(baseDisk);

    // Central Classroom Building Volume
    const roomGroup = new THREE.Group();
    const roomGeo = new THREE.BoxGeometry(5.6, 2.8, 4.4);
    const roomMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.28,
    });
    const roomMesh = new THREE.Mesh(roomGeo, roomMat);
    roomMesh.position.y = 1.4;
    roomGroup.add(roomMesh);

    const wireGeo = new THREE.EdgesGeometry(roomGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 });
    const wireFrame = new THREE.LineSegments(wireGeo, wireMat);
    wireFrame.position.y = 1.4;
    roomGroup.add(wireFrame);

    // Roof anchor beacon
    const anchorGeo = new THREE.OctahedronGeometry(0.42, 0);
    const anchorMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0369a1,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.5,
    });
    const anchorMesh = new THREE.Mesh(anchorGeo, anchorMat);
    anchorMesh.position.y = 3.55;
    roomGroup.add(anchorMesh);
    scene.add(roomGroup);

    // Dynamic Geofence Boundary Cylinder (1 scene unit = 5 meters)
    const sceneRadius = Math.max(3.5, course.geofenceRadiusMeters / 5);
    const fenceWallGeo = new THREE.CylinderGeometry(sceneRadius, sceneRadius, 1.6, 64, 1, true);
    const fenceWallMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      roughness: 0.3,
    });
    const fenceWall = new THREE.Mesh(fenceWallGeo, fenceWallMat);
    fenceWall.position.y = 0.8;
    scene.add(fenceWall);

    const fenceRingGeo = new THREE.RingGeometry(sceneRadius - 0.12, sceneRadius + 0.12, 64);
    const fenceRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const fenceRing = new THREE.Mesh(fenceRingGeo, fenceRingMat);
    fenceRing.rotation.x = -Math.PI / 2;
    fenceRing.position.y = 0.04;
    ringMeshRef.current = fenceRing;
    scene.add(fenceRing);

    const pinsGroup = new THREE.Group();
    pinsGroupRef.current = pinsGroup;
    scene.add(pinsGroup);

    // Drag to orbit
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      dragAngleRef.current.theta -= dx * 0.008;
      dragAngleRef.current.phi = Math.min(1.38, Math.max(0.12, dragAngleRef.current.phi - dy * 0.006));
    };
    const onPointerUp = () => {
      isDragging = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 340;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let animId = 0;
    const targetCamPos = new THREE.Vector3();
    const orbitDist = Math.max(20, sceneRadius * 2.15);

    const animate = (time: number) => {
      animId = window.requestAnimationFrame(animate);
      anchorMesh.rotation.y = time * 0.0008;

      const { theta, phi } = dragAngleRef.current;
      targetCamPos.set(
        orbitDist * Math.sin(phi) * Math.sin(theta),
        orbitDist * Math.cos(phi) + 1.5,
        orbitDist * Math.sin(phi) * Math.cos(theta)
      );
      camera.position.lerp(targetCamPos, 0.09);
      camera.lookAt(0, 1.1, 0);

      renderer.render(scene, camera);
    };

    // Initial snap
    const { theta, phi } = dragAngleRef.current;
    camera.position.set(
      orbitDist * Math.sin(phi) * Math.sin(theta),
      orbitDist * Math.cos(phi) + 1.5,
      orbitDist * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, 1.1, 0);
    animId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      renderer.dispose();
    };
  }, [course.id, course.geofenceRadiusMeters]);

  // Update 3D student pins whenever pins or course coordinates change
  useEffect(() => {
    const group = pinsGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }

    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos((course.latitude * Math.PI) / 180);

    pins.forEach((pin) => {
      const northM = (pin.latitude - course.latitude) * metersPerDegLat;
      const eastM = (pin.longitude - course.longitude) * metersPerDegLng;

      // Clamp visual distance to 24 scene units (~120m) so distant pins stay visible on perimeter
      let x = eastM / 5;
      let z = -northM / 5;
      const mag = Math.hypot(x, z);
      if (mag > 22) {
        const scale = 22 / mag;
        x *= scale;
        z *= scale;
      }

      const color = pin.inside ? 0x22c55e : 0xef4444;

      // Vertical beacon pole
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 12);
      const poleMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 1.1, z);
      group.add(pole);

      // Beacon head sphere
      const headGeo = new THREE.SphereGeometry(0.36, 18, 18);
      const headMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.25,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(x, 2.35, z);
      group.add(head);

      // Line-of-sight vector to classroom anchor
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.25, 0),
        new THREE.Vector3(x, 0.25, z),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
      });
      const vectorLine = new THREE.Line(lineGeo, lineMat);
      group.add(vectorLine);
    });
  }, [pins, course.latitude, course.longitude]);

  const insideCount = pins.filter((p) => p.inside).length;
  const outsideCount = pins.filter((p) => !p.inside).length;

  return (
    <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-slate-950`}>
      {webglUnavailable ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-100">
          <svg
            viewBox="0 0 280 180"
            className="w-64 h-40 mb-3"
            aria-label="2D Classroom Geofence Fallback Diagram"
          >
            <circle cx="140" cy="90" r="68" fill="rgba(14,165,233,0.12)" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 4" />
            <rect x="122" y="76" width="36" height="28" rx="4" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
            {pins.map((pin, idx) => {
              const angle = (idx * 2.1) % (Math.PI * 2);
              const dist = pin.inside ? 34 : 84;
              const px = 140 + Math.cos(angle) * dist;
              const py = 90 + Math.sin(angle) * (dist * 0.65);
              return (
                <g key={pin.id}>
                  <line x1="140" y1="90" x2={px} y2={py} stroke={pin.inside ? '#22c55e' : '#ef4444'} strokeWidth="1" opacity="0.7" />
                  <circle cx={px} cy={py} r="4.5" fill={pin.inside ? '#22c55e' : '#ef4444'} />
                </g>
              );
            })}
          </svg>
          <p className="text-xs text-slate-300 text-center">
            2D Architectural Geofence View ({course.roomName} · {course.geofenceRadiusMeters} m radius)
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      )}

      {/* Semantic HUD overlay */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <div className="pointer-events-auto bg-slate-950/75 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 text-white">
          <div className="text-xs font-semibold tracking-tight">{course.roomName}</div>
          <div className="text-[11px] text-slate-300 font-mono tabular-nums mt-0.5">
            {course.latitude.toFixed(4)}, {course.longitude.toFixed(4)} · {course.geofenceRadiusMeters} m radius
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1 bg-slate-950/75 backdrop-blur-sm border border-white/10 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setPreset('isometric')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
              preset === 'isometric' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Layers className="w-3 h-3" />
              3D Iso
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPreset('top')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
              preset === 'top' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Compass className="w-3 h-3" />
              Top
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPreset('isometric');
              dragAngleRef.current = { theta: 0.72, phi: 0.68 };
            }}
            aria-label="Reset 3D camera"
            className="px-2 py-1 text-[11px] text-slate-300 hover:text-white rounded transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 text-[11px] text-slate-200">
        <div className="bg-slate-950/75 backdrop-blur-sm border border-white/10 rounded-md px-2.5 py-1 font-mono tabular-nums">
          Inside: {insideCount} · Outside: {outsideCount}
        </div>
        <div className="bg-slate-950/75 backdrop-blur-sm border border-white/10 rounded-md px-2.5 py-1 text-slate-300 hidden sm:block">
          Drag viewport to orbit 3D geofence
        </div>
      </div>
    </div>
  );
}
