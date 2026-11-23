import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Camera, CheckCircle2, Info, ShieldAlert, VideoOff } from 'lucide-react';

interface SimulatedLiveness3DProps {
  studentName: string;
  hasPhotoConsent: boolean;
  onDemoComplete: (challengeLabel: string) => void;
  onChooseManualFallback: () => void;
}

const CHALLENGE_STEPS = [
  { id: 'gaze', label: 'Center Gaze Alignment', instruction: 'Hold steady within the 3D depth frame' },
  { id: 'turn', label: 'Head Yaw Check (Left)', instruction: 'Simulate slight head turn left (15°)' },
  { id: 'blink', label: 'Liveness Blink Confirmation', instruction: 'Confirm natural blink / motion check' },
];

export function SimulatedLiveness3D({
  studentName,
  hasPhotoConsent,
  onDemoComplete,
  onChooseManualFallback,
}: SimulatedLiveness3DProps) {
  const meshHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<'idle' | 'active' | 'unavailable'>('idle');
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [completed, setCompleted] = useState<boolean>(false);
  const [webglFallback, setWebglFallback] = useState<boolean>(false);
  const targetRotationRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Update 3D head mesh rotation target based on challenge step
  useEffect(() => {
    if (stepIndex === 0) {
      targetRotationRef.current = { x: 0, y: 0 };
    } else if (stepIndex === 1) {
      targetRotationRef.current = { x: 0.04, y: -0.45 };
    } else {
      targetRotationRef.current = { x: 0.12, y: 0.1 };
    }
  }, [stepIndex]);

  // Mount Three.js 3D Facial Depth Wireframe Mesh
  useEffect(() => {
    const host = meshHostRef.current;
    if (!host) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setWebglFallback(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setWebglFallback(true);
      return;
    }

    const w = host.clientWidth || 320;
    const h = host.clientHeight || 220;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.innerHTML = '';
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0x94a3b8, 0.8));

    // Stylized 3D biometric depth mesh (icosahedron + facial landmark ring)
    const headGroup = new THREE.Group();
    const headGeo = new THREE.IcosahedronGeometry(1.15, 2);
    headGeo.scale(0.84, 1.08, 0.9);
    const wireGeo = new THREE.WireframeGeometry(headGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: completed ? 0x22c55e : 0x38bdf8,
      transparent: true,
      opacity: 0.72,
    });
    const headMesh = new THREE.LineSegments(wireGeo, wireMat);
    headGroup.add(headMesh);

    // Eye & nose anchor landmark nodes
    const nodeGeo = new THREE.SphereGeometry(0.045, 10, 10);
    const nodeMat = new THREE.MeshBasicMaterial({ color: completed ? 0x4ade80 : 0x7dd3fc });
    const landmarks: [number, number, number][] = [
      [-0.32, 0.18, 0.88],
      [0.32, 0.18, 0.88],
      [0, -0.04, 1.02],
      [-0.22, -0.38, 0.86],
      [0.22, -0.38, 0.86],
    ];
    landmarks.forEach(([x, y, z]) => {
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.set(x, y, z);
      headGroup.add(node);
    });

    scene.add(headGroup);

    const handleResize = () => {
      if (!host) return;
      const nw = host.clientWidth || 320;
      const nh = host.clientHeight || 220;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(host);

    let animId = 0;
    const animate = (t: number) => {
      animId = window.requestAnimationFrame(animate);
      const target = targetRotationRef.current;
      headGroup.rotation.y += (target.y + Math.sin(t * 0.0012) * 0.08 - headGroup.rotation.y) * 0.08;
      headGroup.rotation.x += (target.x - headGroup.rotation.x) * 0.08;
      renderer.render(scene, camera);
    };
    animId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.dispose();
    };
  }, [completed]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleStartCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraState('active');
    } catch {
      setCameraState('unavailable');
    }
  };

  const handleAdvanceStep = () => {
    if (stepIndex < CHALLENGE_STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      setCompleted(true);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      onDemoComplete('Center gaze + left yaw + blink check (Simulated Demo)');
    }
  };

  if (!hasPhotoConsent) {
    return (
      <div className="border border-amber-300 bg-amber-50/70 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-slate-900">
              Biometric Demo Disabled — Explicit Consent Not Granted
            </h4>
            <p className="text-xs text-slate-700 mt-1 leading-relaxed">
              {studentName} has opted out of photo and simulated liveness verification in Privacy Controls.
              Use the professor-approved Manual Alternative below to submit attendance without camera processing.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onChooseManualFallback}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
        >
          Use Manual Alternative Check-In
        </button>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      {/* Clear simulation disclosure banner */}
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-950 leading-snug">
          <span className="font-semibold">Simulated Liveness Demo (No Real Biometric Matching):</span>{' '}
          This interactive 3D depth mesh demonstrates the check-in UX. No facial embeddings are extracted, matched, or stored.
        </p>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        {/* 3D Depth Mesh + Optional Live Camera Viewport */}
        <div className="relative h-56 rounded-lg overflow-hidden bg-slate-950 border border-slate-800">
          {cameraState === 'active' && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover opacity-50 scale-x-[-1]"
            />
          )}

          {webglFallback ? (
            <div className="w-full h-full flex items-center justify-center text-sky-300 text-xs">
              3D Depth Frame Ready (Reduced Motion Mode)
            </div>
          ) : (
            <div ref={meshHostRef} className="relative z-10 w-full h-full" />
          )}

          <div className="absolute bottom-2.5 inset-x-2.5 z-20 flex items-center justify-between gap-2 text-[11px]">
            <span className="px-2 py-1 rounded bg-slate-950/80 text-slate-200 border border-white/10">
              {cameraState === 'active'
                ? 'Webcam + 3D Overlay'
                : cameraState === 'unavailable'
                  ? 'Camera Unavailable (3D Mesh Mode)'
                  : '3D Mesh Demo Preview'}
            </span>
            {cameraState === 'idle' && (
              <button
                type="button"
                onClick={handleStartCamera}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium transition-colors"
              >
                <Camera className="w-3 h-3" />
                Enable Camera
              </button>
            )}
            {cameraState === 'unavailable' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900/90 text-slate-300">
                <VideoOff className="w-3 h-3" />
                Simulated Feed
              </span>
            )}
          </div>
        </div>

        {/* Interactive Challenge Stepper */}
        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              Challenge Step {Math.min(stepIndex + 1, CHALLENGE_STEPS.length)} of {CHALLENGE_STEPS.length}
            </div>
            <h4 className="text-sm font-semibold text-slate-900 mt-0.5">
              {completed ? 'Liveness Demo Complete' : CHALLENGE_STEPS[stepIndex].label}
            </h4>
            <p className="text-xs text-slate-600 mt-1">
              {completed
                ? 'Simulated depth & motion prompt verified for this prototype check-in.'
                : CHALLENGE_STEPS[stepIndex].instruction}
            </p>
          </div>

          <div className="space-y-1.5">
            {CHALLENGE_STEPS.map((step, idx) => {
              const isDone = completed || idx < stepIndex;
              const isCurrent = !completed && idx === stepIndex;
              return (
                <div
                  key={step.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border ${
                    isDone
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : isCurrent
                        ? 'bg-sky-50 border-sky-200 text-sky-950 font-medium'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  <span>{step.label}</span>
                  <span>{isDone ? 'Passed' : isCurrent ? 'Active' : 'Queued'}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!completed ? (
              <button
                type="button"
                onClick={handleAdvanceStep}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 transition-colors whitespace-nowrap"
              >
                {stepIndex < CHALLENGE_STEPS.length - 1
                  ? 'Simulate Next Prompt'
                  : 'Complete Liveness Demo'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                Liveness Demo Verified
              </span>
            )}

            <button
              type="button"
              onClick={onChooseManualFallback}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Manual Alternative
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
