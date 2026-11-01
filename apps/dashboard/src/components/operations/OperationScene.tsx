import { Canvas } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { stages } from './model.js';
const colors = [
  '#00ff88',
  '#00f3ff',
  '#a855f7',
  '#38bdf8',
  '#f472b6',
  '#ff9900',
];
export default function OperationScene({
  selected,
  select,
  observed,
  example = false,
  onUnavailable,
}: {
  selected: string;
  select: (id: string) => void;
  observed: boolean[];
  example?: boolean;
  onUnavailable: () => void;
}) {
  return (
    <div className="operations-canvas" aria-hidden="true">
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [12, 10, 12], fov: 36, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a1220', 1);
          gl.domElement.addEventListener('webglcontextlost', onUnavailable, {
            once: true,
          });
        }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[4, 10, 4]} intensity={2.2} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
          <planeGeometry args={[22, 22]} />
          <meshStandardMaterial
            color="#101a2c"
            metalness={0.2}
            roughness={0.88}
          />
        </mesh>
        <gridHelper
          args={[22, 44, '#2563eb', '#152238']}
          position={[0, 0, 0]}
        />
        <group position={[0, 0.1, 0]}>
          <RoundedBox args={[14.5, 0.28, 12.5]} radius={0.14} smoothness={4}>
            <meshPhysicalMaterial
              color="#9ecce8"
              metalness={0.05}
              roughness={0.12}
              transmission={0.35}
              thickness={0.5}
              transparent
              opacity={0.72}
            />
          </RoundedBox>
          <RoundedBox
            args={[14.7, 0.06, 12.7]}
            radius={0.12}
            smoothness={3}
            position={[0, -0.12, 0]}
          >
            <meshBasicMaterial color="#00f3ff" transparent opacity={0.3} />
          </RoundedBox>
        </group>
        {[
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 5],
        ].map(([a, b]) => (
          <Line
            key={`${a}-${b}`}
            points={[
              [...stages[a].position] as [number, number, number],
              [...stages[b].position] as [number, number, number],
            ]}
            color={observed[b] ? colors[b] : '#4d6f7b'}
            opacity={observed[b] ? 0.9 : 0.45}
            transparent
            lineWidth={1.5}
            dashed
            dashSize={0.16}
            gapSize={0.12}
          />
        ))}
        {stages.map((stage, i) => (
          <group position={[...stage.position]} key={stage.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0]}>
              <ringGeometry args={[0.58, 0.78, 48]} />
              <meshBasicMaterial
                color={colors[i]}
                transparent
                opacity={selected === stage.id ? 0.8 : 0.35}
              />
            </mesh>
            <mesh position={[0, -0.65, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.68, 0.035, 10, 48]} />
              <meshBasicMaterial color={colors[i]} />
            </mesh>
            <RoundedBox
              args={[1.08, 1.16, 0.74]}
              radius={0.12}
              smoothness={4}
              onClick={(e) => {
                e.stopPropagation();
                select(stage.id);
              }}
            >
              <meshPhysicalMaterial
                color="#142739"
                metalness={0.55}
                roughness={0.2}
                transparent
                opacity={0.92}
                emissive={colors[i]}
                emissiveIntensity={selected === stage.id ? 0.16 : 0.025}
              />
            </RoundedBox>
            <mesh position={[0, 0.04, 0.39]}>
              <planeGeometry args={[0.66, 0.42]} />
              <meshBasicMaterial color={colors[i]} transparent opacity={0.15} />
            </mesh>
            <mesh position={[0, 0.04, 0.405]} rotation={[0, 0, Math.PI / 4]}>
              <ringGeometry args={[0.12, 0.15, 4]} />
              <meshBasicMaterial color={colors[i]} />
            </mesh>
            <Html
              position={[0, 1.25, 0]}
              center
              style={{ pointerEvents: 'none' }}
            >
              <span
                className="scene-node-label"
                style={{ borderColor: colors[i] + '70' }}
              >
                <small style={{ color: colors[i] }}>
                  {stage.type} / {String(i + 1).padStart(2, '0')}
                </small>
                <b>{stage.label}</b>
                <small>
                  {example
                    ? 'UI EXAMPLE'
                    : observed[i]
                      ? 'EVENT OBSERVED'
                      : 'NOT OBSERVED'}
                </small>
              </span>
            </Html>
          </group>
        ))}
        <group position={[5.8, 0.9, -3.6]}>
          <RoundedBox args={[1.25, 0.24, 0.5]} radius={0.06} smoothness={3}>
            <meshStandardMaterial
              color="#2f3334"
              metalness={0.8}
              roughness={0.3}
            />
          </RoundedBox>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.24, 0.13, 0]}>
            <planeGeometry args={[0.38, 0.24]} />
            <meshBasicMaterial color="#b8f000" />
          </mesh>
          <Html position={[0, 0.8, 0]} center style={{ pointerEvents: 'none' }}>
            <span className="scene-node-label">
              <b>Ledger</b>
              <small>OWNER AUTHORITY</small>
            </span>
          </Html>
        </group>
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={10}
          maxDistance={28}
          minPolarAngle={0.5}
          maxPolarAngle={1.35}
          target={[0, 0.6, 0]}
        />
      </Canvas>
      <span className="scene-instructions">
        Drag to orbit · scroll to zoom · select a stage above for details
      </span>
    </div>
  );
}
