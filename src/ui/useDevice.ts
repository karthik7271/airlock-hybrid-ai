import { useCallback, useEffect, useRef, useState } from "react";
import { probeDevice, probeImageInput, type DeviceState } from "../ai/device";
import { initializeDevice } from "../ai/tasks";
import { isConfigured } from "../firebase/app";

export interface DeviceInfo {
  state: DeviceState;
  images: boolean;
  progress: number | null;
  error?: string;
  /** Must be called from a click/keypress (Chrome requires user activation to download). */
  enable: () => Promise<void>;
  refresh: () => Promise<DeviceState>;
}

export function useDevice(): DeviceInfo {
  const [state, setState] = useState<DeviceState>("checking");
  const [images, setImages] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const timer = useRef<number>(undefined);

  const refresh = useCallback(async () => {
    const s = await probeDevice();
    setState(s);
    if (s === "available") setImages(await probeImageInput());
    return s;
  }, []);

  useEffect(() => {
    void refresh();
    return () => window.clearInterval(timer.current);
  }, [refresh]);

  useEffect(() => {
    window.clearInterval(timer.current);
    if (state === "downloading") timer.current = window.setInterval(() => void refresh(), 4000);
  }, [state, refresh]);

  const enable = useCallback(async () => {
    if (!isConfigured) return;
    setError(undefined);
    try {
      setProgress(0);
      setState((s) => (s === "downloadable" ? "downloading" : s));
      await initializeDevice((p) => setProgress(p), false);
      setProgress(null);
      await refresh();
    } catch (e) {
      setProgress(null);
      setError((e as Error).message);
      await refresh();
    }
  }, [refresh]);

  return { state, images, progress, error, enable, refresh };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
