import { clampScale, useSettings } from "../../stores/settingsStore";
import { useProgress } from "../../stores/progressStore";

function Toggle({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
      <div>
        <div className="text-sm text-ink-200">{label}</div>
        {desc && <div className="mt-0.5 text-[11px] text-ink-400">{desc}</div>}
      </div>
      <button
        onClick={onChange}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? "bg-verm-500" : "bg-ink-600"}`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            value ? "left-5.5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

const SCALES = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

export default function SettingsPage() {
  const { sound, autoNext, uiScale, toggleSound, toggleAutoNext, setScale } = useSettings();
  const byTiku = useProgress((s) => s.byTiku);
  const resetAll = useProgress((s) => s.resetTiku);

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="space-y-2.5">
        <Toggle
          label="音效"
          desc="走子、吃子、将军与胜负提示音"
          value={sound}
          onChange={toggleSound}
        />
        <Toggle
          label="答对后自动下一题"
          desc="练习模式中解题成功后自动跳到下一题"
          value={autoNext}
          onChange={toggleAutoNext}
        />
      </div>

      <h3 className="mt-5 text-xs font-medium text-ink-400">界面缩放</h3>
      <div className="mt-2 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
        <div className="text-[11px] leading-4 text-ink-400">
          窗口内按住 <b>Ctrl + 滚轮</b> 随时缩放，上班摸鱼时调小更隐蔽
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {SCALES.map((v) => (
            <button
              key={v}
              onClick={() => setScale(v)}
              className={`flex-1 rounded-lg px-1 py-1.5 text-xs transition-colors ${
                Math.abs(uiScale - v) < 0.001
                  ? "bg-verm-600 text-white"
                  : "bg-ink-700 text-ink-300 hover:bg-ink-600"
              }`}
            >
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
        <div className="mt-2 text-right text-[11px] text-ink-400">当前 {Math.round(uiScale * 100)}%</div>
      </div>

      <h3 className="mt-5 text-xs font-medium text-ink-400">数据管理</h3>
      <div className="mt-2 rounded-xl border border-ink-700 bg-ink-900 p-4">
        <div className="text-[11px] leading-4 text-ink-400">
          练习进度、错题本与测试成绩保存在本机，卸载应用会丢失记录。
          已有记录的题库：{Object.keys(byTiku).length} 个。
        </div>
        <button
          onClick={() => {
            if (!confirm("确认清空全部练习进度与错题本？此操作不可恢复。")) return;
            if (!confirm("再次确认：全部进度将被删除。")) return;
            for (const name of Object.keys(byTiku)) {
              resetAll(name);
            }
            useProgress.setState({ testHistory: [], drillsTotal: 0, winsTotal: 0 });
          }}
          className="mt-3 rounded-lg border border-verm-500 px-4 py-1.5 text-xs text-verm-600 hover:bg-verm-600/10"
        >
          清空全部进度
        </button>
      </div>

      <h3 className="mt-5 text-xs font-medium text-ink-400">关于</h3>
      <div className="mt-2 rounded-xl border border-ink-700 bg-ink-900 p-4 text-[11px] leading-5 text-ink-400">
        杀法练习 v0.1.0 · 竖屏摸鱼版残局刷题
        <br />
        内置 Pikafish（皮卡鱼）引擎作为对手，题库兼容「一二残局」格式。引擎以 GPL-3.0 独立进程运行。
        <br />
        当前缩放 {Math.round(clampScale(uiScale) * 100)}%
      </div>
    </div>
  );
}
