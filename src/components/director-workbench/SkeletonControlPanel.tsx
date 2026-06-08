import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BONE_GROUP_ORDER, getBoneGroup, getBoneLabel } from '../../lib/director/boneLabels';
import { useDirectorSceneStore, type Vec3Tuple } from '../../store/useDirectorSceneStore';

const RAD_MIN = -Math.PI;
const RAD_MAX = Math.PI;
const RAD_STEP = 0.02;

function radToDeg(rad: number) {
  return Math.round((rad * 180) / Math.PI);
}

function AxisSlider({
  label,
  hint,
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-body text-[11px] text-on-surface">{label}</span>
        <span className="font-mono text-[10px] text-primary tabular-nums">{radToDeg(value)}°</span>
      </div>
      <p className="font-body text-[9px] text-on-surface/40">{hint}</p>
      <input
        type="range"
        min={RAD_MIN}
        max={RAD_MAX}
        step={RAD_STEP}
        value={value}
        onPointerDown={onGestureStart}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        className="w-full h-1.5 accent-primary cursor-pointer"
      />
    </label>
  );
}

export function SkeletonControlPanel() {
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const skeletonBoneNames = useDirectorSceneStore((s) => s.skeletonBoneNames);
  const defaultBonePose = useDirectorSceneStore((s) => s.defaultBonePose);
  const objects = useDirectorSceneStore((s) => s.objects);
  const setBoneRotation = useDirectorSceneStore((s) => s.setBoneRotation);
  const beginHistoryGesture = useDirectorSceneStore((s) => s.beginHistoryGesture);
  const commitHistoryGesture = useDirectorSceneStore((s) => s.commitHistoryGesture);
  const resetAllBoneRotations = useDirectorSceneStore((s) => s.resetAllBoneRotations);

  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;
  const active = Boolean(selectedObject && selectedObject.type === 'character');

  const [activeBone, setActiveBone] = useState('');
  const [showAllBones, setShowAllBones] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    躯干: true,
    头颈: true,
  });

  useEffect(() => {
    if (!active || skeletonBoneNames.length === 0) {
      setActiveBone('');
      return;
    }
    if (!activeBone || !skeletonBoneNames.includes(activeBone)) {
      const hips = skeletonBoneNames.find((n) => n.includes('Hips'));
      setActiveBone(hips ?? skeletonBoneNames[0]!);
    }
  }, [active, skeletonBoneNames, activeBone]);

  const groupedBones = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const name of skeletonBoneNames) {
      const g = getBoneGroup(name);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(name);
    }
    return BONE_GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, bones: map.get(g)! }));
  }, [skeletonBoneNames]);

  const rotation: Vec3Tuple = activeBone
    ? (selectedObject?.boneRotations[activeBone] ?? [0, 0, 0])
    : [0, 0, 0];

  const resetBone = () => {
    if (!selectedId || !activeBone) return;
    const rest = defaultBonePose[activeBone] ?? [0, 0, 0];
    setBoneRotation(selectedId, activeBone, 0, rest[0]);
    setBoneRotation(selectedId, activeBone, 1, rest[1]);
    setBoneRotation(selectedId, activeBone, 2, rest[2]);
  };

  if (!active) {
    return (
      <p className="font-body text-[11px] text-on-surface/50 leading-relaxed px-1 py-4">
        请先在「场景」标签中选中一个人偶，再在此调节骨骼摆 Pose。
      </p>
    );
  }

  if (skeletonBoneNames.length === 0) {
    return <p className="font-body text-[11px] text-on-surface/50 py-4">正在加载骨骼列表…</p>;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => selectedId && resetAllBoneRotations(selectedId)}
        className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[11px] font-label
          bg-white/8 text-on-surface hover:bg-white/12 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        重置全部关节
      </button>
      <div className="space-y-2">
        <label className="font-label text-[9px] uppercase tracking-[0.18em] text-on-surface/45 block">
          当前调节骨骼
        </label>
        <select
          value={activeBone}
          onChange={(e) => setActiveBone(e.target.value)}
          className="w-full rounded-xl bg-surface-container-high px-3 py-2.5 text-[12px] font-body text-on-surface
            focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
        >
          {skeletonBoneNames.map((name) => (
            <option key={name} value={name}>
              {getBoneLabel(name)}
            </option>
          ))}
        </select>
        <p className="font-mono text-[9px] text-on-surface/35 truncate" title={activeBone}>
          技术名：{activeBone}
        </p>
      </div>

      <div className="rounded-2xl bg-surface-container-high/80 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-body text-[12px] text-on-surface font-medium">旋转角度</span>
          <button
            type="button"
            onClick={resetBone}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-label text-on-surface/60
              hover:bg-white/8 hover:text-on-surface transition-colors"
            title="恢复该骨骼为模型初始姿势"
          >
            <RotateCcw className="w-3 h-3" />
            重置此骨骼
          </button>
        </div>
        <AxisSlider
          label="绕 X 轴旋转（俯仰）"
          hint="前后倾斜"
          value={rotation[0]}
          onGestureStart={beginHistoryGesture}
          onGestureEnd={commitHistoryGesture}
          onChange={(v) => selectedId && setBoneRotation(selectedId, activeBone, 0, v)}
        />
        <AxisSlider
          label="绕 Y 轴旋转（偏航）"
          hint="左右转向"
          value={rotation[1]}
          onGestureStart={beginHistoryGesture}
          onGestureEnd={commitHistoryGesture}
          onChange={(v) => selectedId && setBoneRotation(selectedId, activeBone, 1, v)}
        />
        <AxisSlider
          label="绕 Z 轴旋转（翻滚）"
          hint="侧向扭转"
          value={rotation[2]}
          onGestureStart={beginHistoryGesture}
          onGestureEnd={commitHistoryGesture}
          onChange={(v) => selectedId && setBoneRotation(selectedId, activeBone, 2, v)}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAllBones((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl px-3 py-2 bg-white/5 text-[10px] font-label text-on-surface/70 hover:bg-white/8"
      >
        {showAllBones ? '收起骨骼列表' : '展开全部骨骼（按部位分组）'}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAllBones && 'rotate-180')} />
      </button>

      {showAllBones && (
        <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
          {groupedBones.map(({ group, bones }) => {
            const open = openGroups[group] ?? false;
            return (
              <div key={group} className="rounded-xl bg-surface-container-high/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenGroups((s) => ({ ...s, [group]: !open }))}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-body text-on-surface/80 hover:bg-white/5"
                >
                  {group}
                  <span className="text-on-surface/40 text-[9px]">{bones.length} 根</span>
                </button>
                {open && (
                  <ul className="pb-1 px-2 space-y-0.5">
                    {bones.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => setActiveBone(name)}
                          className={cn(
                            'w-full text-left rounded-lg px-2 py-1.5 text-[10px] font-body transition-colors',
                            activeBone === name
                              ? 'bg-primary/15 text-primary'
                              : 'text-on-surface/65 hover:bg-white/5',
                          )}
                        >
                          {getBoneLabel(name)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
