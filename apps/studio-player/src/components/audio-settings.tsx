/**
 * @description Audio / narration settings panel for Studio Player.
 * Allows choosing TTS provider, voice, speed, language, and realtime playback.
 */
import { useState, useEffect } from "react";
import { Volume2, X } from "lucide-react";
import type { AudioSettings } from "../stores/player-store";

const PROVIDERS = [
  { value: "", label: "Auto (best available)" },
  { value: "google", label: "Google Cloud TTS" },
  { value: "openai", label: "OpenAI" },
  { value: "system", label: "System (macOS / Windows)" },
  { value: "piper", label: "Piper (free, offline)" },
] as const;

interface Props {
  settings: AudioSettings;
  detectedProvider: string;
  onUpdate: (settings: AudioSettings) => void;
}

export function AudioSettingsPanel({ settings, detectedProvider, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<AudioSettings>(settings);

  useEffect(() => { setLocal(settings); }, [settings]);

  const apply = (patch: Partial<AudioSettings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onUpdate(next);
  };

  const providerLabel = PROVIDERS.find((p) => p.value === (detectedProvider || ""))?.label ?? detectedProvider;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-lg transition-colors ${open ? "bg-zinc-700 text-zinc-200" : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
        title="Audio settings"
        data-testid="audio-settings-toggle"
      >
        <Volume2 size={14} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
            <span className="text-xs font-semibold text-zinc-300">Audio Settings</span>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          </div>

          <div className="p-3 space-y-3 text-xs">
            {/* Provider */}
            <Field label="TTS Provider">
              <select
                value={local.provider ?? ""}
                onChange={(e) => apply({ provider: e.target.value || undefined })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-300"
                data-testid="audio-provider"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <span className="text-[10px] text-zinc-500 mt-0.5 block">
                Active: {providerLabel}
              </span>
            </Field>

            {/* Voice */}
            <Field label="Voice">
              <input
                type="text"
                value={local.voice ?? ""}
                onChange={(e) => apply({ voice: e.target.value || undefined })}
                placeholder="auto (provider default)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
                data-testid="audio-voice"
              />
            </Field>

            {/* Speed */}
            <Field label={`Speed: ${local.speed ?? 1.0}x`}>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={local.speed ?? 1.0}
                onChange={(e) => apply({ speed: parseFloat(e.target.value) })}
                className="w-full accent-blue-500"
                data-testid="audio-speed"
              />
            </Field>

            {/* Language */}
            <Field label="Language">
              <input
                type="text"
                value={local.language ?? ""}
                onChange={(e) => apply({ language: e.target.value || undefined })}
                placeholder="none (original text)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
                data-testid="audio-language"
              />
            </Field>

            {/* Model (OpenAI only) */}
            <Field label="Model (OpenAI)">
              <select
                value={local.model ?? ""}
                onChange={(e) => apply({ model: e.target.value || undefined })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-300"
                data-testid="audio-model"
              >
                <option value="">auto (tts-1-hd)</option>
                <option value="tts-1">tts-1 (fast)</option>
                <option value="tts-1-hd">tts-1-hd (high quality)</option>
                <option value="gpt-4o-mini-tts">gpt-4o-mini-tts</option>
              </select>
            </Field>

            {/* Realtime */}
            <Field label="Realtime playback">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={local.realtime ?? false}
                  onChange={(e) => apply({ realtime: e.target.checked })}
                  className="accent-blue-500"
                  data-testid="audio-realtime"
                />
                <span className="text-zinc-400">Play audio through speakers</span>
              </label>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-zinc-400 mb-0.5 font-medium">{label}</label>
      {children}
    </div>
  );
}
