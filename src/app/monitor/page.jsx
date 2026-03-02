"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const VIDEO_BUFFER_SECONDS = 15;
const AUDIO_BUFFER_SECONDS = 5;
const DETECTION_INTERVAL_MS = 1200;
const DETECTION_THRESHOLD = 0.7;

function chooseMimeType(candidates) {
  if (typeof window === "undefined" || !window.MediaRecorder) {
    return "";
  }
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function MonitorPage() {
  const router = useRouter();
  const source = useMemo(() => {
    if (typeof window === "undefined") return "manual";
    const params = new URLSearchParams(window.location.search);
    return params.get("source") || "manual";
  }, []);

  const [status, setStatus] = useState("Initializing camera and microphone...");
  const [error, setError] = useState("");
  const [monitoring, setMonitoring] = useState(false);
  const [violenceProbability, setViolenceProbability] = useState(0);
  const [dispatchState, setDispatchState] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const videoRecorderRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const detectionTimerRef = useRef(null);
  const detectionLockRef = useRef(false);
  const videoChunksRef = useRef([]);
  const audioChunksRef = useRef([]);

  const stopEverything = () => {
    if (detectionTimerRef.current) {
      clearInterval(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }

    if (videoRecorderRef.current && videoRecorderRef.current.state !== "inactive") {
      videoRecorderRef.current.stop();
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") {
      audioRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startMonitoring = async () => {
    setError("");
    setDispatchState("");
    setStatus("Requesting camera and microphone permissions...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 360 } },
        audio: true,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const nowSeconds = () => Date.now() / 1000;
      const videoMimeType = chooseMimeType(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
      const audioMimeType = chooseMimeType(["audio/webm;codecs=opus", "audio/webm"]);

      const videoRecorder = new MediaRecorder(stream, videoMimeType ? { mimeType: videoMimeType } : undefined);
      videoRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        videoChunksRef.current.push({ t: nowSeconds(), chunk: event.data });
        const cutoff = nowSeconds() - VIDEO_BUFFER_SECONDS;
        videoChunksRef.current = videoChunksRef.current.filter((entry) => entry.t >= cutoff);
      };
      videoRecorder.start(1000);
      videoRecorderRef.current = videoRecorder;

      const audioStream = new MediaStream(stream.getAudioTracks());
      const audioRecorder = new MediaRecorder(audioStream, audioMimeType ? { mimeType: audioMimeType } : undefined);
      audioRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        audioChunksRef.current.push({ t: nowSeconds(), chunk: event.data });
        const cutoff = nowSeconds() - AUDIO_BUFFER_SECONDS;
        audioChunksRef.current = audioChunksRef.current.filter((entry) => entry.t >= cutoff);
      };
      audioRecorder.start(1000);
      audioRecorderRef.current = audioRecorder;

      setMonitoring(true);
      setStatus("Monitoring for violence...");

      detectionTimerRef.current = setInterval(async () => {
        if (detectionLockRef.current || !videoRef.current) return;
        detectionLockRef.current = true;
        try {
          const frameCanvas = document.createElement("canvas");
          frameCanvas.width = videoRef.current.videoWidth || 640;
          frameCanvas.height = videoRef.current.videoHeight || 360;
          const ctx = frameCanvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(videoRef.current, 0, 0, frameCanvas.width, frameCanvas.height);

          const frameBlob = await new Promise((resolve) =>
            frameCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7)
          );
          if (!frameBlob) return;

          const frameDataUrl = await blobToDataUrl(frameBlob);
          const result = await fetch("/api/violence-detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ frameDataUrl }),
          });

          if (!result.ok) return;
          const detection = await result.json();
          const confidence = Number(detection.confidence || 0);
          setViolenceProbability(confidence);

          if (detection.violenceDetected && confidence >= DETECTION_THRESHOLD) {
            setStatus("Violence detected. Preparing emergency evidence package...");
            setMonitoring(false);
            clearInterval(detectionTimerRef.current);
            detectionTimerRef.current = null;

            const videoBlob = new Blob(videoChunksRef.current.map((entry) => entry.chunk), {
              type: videoChunksRef.current[0]?.chunk?.type || "video/webm",
            });
            const audioBlob = new Blob(audioChunksRef.current.map((entry) => entry.chunk), {
              type: audioChunksRef.current[0]?.chunk?.type || "audio/webm",
            });

            const formData = new FormData();
            formData.append("video", videoBlob, "incident-15s.webm");
            formData.append("audio", audioBlob, "incident-audio.webm");
            formData.append("detectedConfidence", String(confidence));
            formData.append("source", source);
            formData.append("timestamp", new Date().toISOString());

            setDispatchState("Sending incident evidence to emergency contacts...");
            const dispatchResponse = await fetch("/api/emergency-dispatch", {
              method: "POST",
              body: formData,
            });

            const dispatchResult = await dispatchResponse.json();
            if (!dispatchResponse.ok) {
              throw new Error(dispatchResult.error || "Failed to dispatch emergency evidence.");
            }

            setDispatchState("Evidence sent successfully to emergency channel.");
            setStatus("Monitoring paused after dispatch.");
          }
        } catch (scanError) {
          console.error(scanError);
        } finally {
          detectionLockRef.current = false;
        }
      }, DETECTION_INTERVAL_MS);
    } catch (err) {
      setError(err.message || "Unable to access camera/microphone.");
      setStatus("Monitoring not started.");
    }
  };

  useEffect(() => {
    startMonitoring();
    return () => stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#0B1F3A] md:flex md:items-center md:justify-center md:p-4">
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#0B1F3A] md:h-[844px] md:w-[390px] md:max-w-none md:rounded-[28px] md:border md:border-white/30 md:shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/20 bg-[#102A43] px-4 py-3 text-white">
          <button onClick={() => router.push("/")} className="text-sm font-medium text-white/90">
            Back
          </button>
          <h1 className="text-sm font-semibold tracking-wide">SOS Live Monitor</h1>
          <span className={`text-xs ${monitoring ? "text-[#FF7A00]" : "text-white/80"}`}>
            {monitoring ? "LIVE" : "IDLE"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-white">
          <div className="rounded-2xl border border-white/20 bg-black/30 p-2 shadow-lg">
            <video ref={videoRef} muted playsInline className="h-[260px] w-full rounded-xl bg-black object-cover" />
          </div>

          <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4">
            <p className="text-sm text-white/90">{status}</p>
            <p className="mt-2 text-sm text-white/80">
              Violence probability: <span className="font-semibold text-white">{Math.round(violenceProbability * 100)}%</span>
            </p>
            <p className="mt-1 text-xs text-white/70">
              Source: <span className="font-medium text-white/90">{source}</span>
            </p>
            {dispatchState && <p className="mt-3 text-sm font-medium text-[#FF7A00]">{dispatchState}</p>}
            {error && <p className="mt-3 text-sm font-medium text-[#FFB3B8]">{error}</p>}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={startMonitoring}
              className="rounded-xl bg-[#FF7A00] px-4 py-3 text-sm font-semibold text-white"
            >
              Restart Monitoring
            </button>
            <button
              onClick={stopEverything}
              className="rounded-xl bg-[#C1121F] px-4 py-3 text-sm font-semibold text-white"
            >
              Stop Camera
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
