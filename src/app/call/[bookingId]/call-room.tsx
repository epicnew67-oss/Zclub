"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Chat,
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
  type LocalUserChoices,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Room, Track } from "livekit-client";
import { ArrowLeftIcon, MessageCircleIcon, VideoIcon, XIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { PreJoin } from "./pre-join";
import { reconcileCallPresenceAction } from "./actions";

type Role = "buyer" | "seller";

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function CallRoom({
  token,
  url,
  role,
  endsAt,
  bookingId,
}: {
  token: string;
  url: string;
  roomName: string;
  role: Role;
  endsAt: string;
  bookingId: string;
}) {
  // Pre-join holds the camera/mic preview + device picker before the
  // LiveKit room is connected. Once the user clicks "Join", we hand
  // off to LiveKitRoom with the cached audio/video enable state.
  const [preJoinChoices, setPreJoinChoices] = useState<LocalUserChoices | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [leftCall, setLeftCall] = useState(false);
  const [connected, setConnected] = useState(false);

  const handlePreJoinSubmit = useCallback((choices: LocalUserChoices) => {
    setCallError(null);
    setLeftCall(false);
    setPreJoinChoices(choices);
  }, []);

  const handlePreJoinError = useCallback((err: Error) => {
    setCallError("Camera or microphone unavailable. Check browser permissions or join with them turned off.");
    console.error("pre-join failed", err);
  }, []);

  const room = useMemo(() => {
    return new Room({
      adaptiveStream: true,
      dynacast: true,
    });
  }, []);

  const reportPresence = useCallback(async (event: "joined" | "left") => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 700 * attempt));
      const result = await reconcileCallPresenceAction(bookingId, event);
      if (result.ok || result.code === "wrong_state") return;
    }
    if (event === "joined") setCallError("The video connected, but we could not verify the booking state. Please return to your order if this persists.");
  }, [bookingId]);

  const liveKitRoom = leftCall ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading text-xl text-gold">You left the call</h1>
      <Button asChild><Link href={`/orders/${bookingId}`}>Back to order</Link></Button>
    </div>
  ) : preJoinChoices ? (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect={true}
      audio={preJoinChoices.audioEnabled ? { deviceId: preJoinChoices.audioDeviceId } : false}
      video={preJoinChoices.videoEnabled ? { deviceId: preJoinChoices.videoDeviceId } : false}
      onConnected={() => { setConnected(true); void room.localParticipant.setName(preJoinChoices.username).catch(() => {}); void reportPresence("joined"); }}
      onDisconnected={() => { setConnected(false); setLeftCall(true); void reportPresence("left"); }}
      onError={() => setCallError("Could not connect to the call. Check your connection and return to the order to try again.")}
      room={room}
      data-lk-theme="default"
      style={{ height: "100%", width: "100%" }}
    >
      <InCall role={role} endsAt={endsAt} bookingId={bookingId} />
    </LiveKitRoom>
  ) : (
    <PreJoin
      onSubmit={handlePreJoinSubmit}
      onError={handlePreJoinError}
      defaults={{
        username: role === "buyer" ? "Buyer" : "Seller",
        videoEnabled: true,
        audioEnabled: true,
      }}
    />
  );

  return (
    <div
      data-testid="call-page"
      data-call-state={leftCall ? "disconnected" : preJoinChoices ? "in-call" : "pre-join"}
      data-call-connected={connected ? "true" : "false"}
      className="fixed inset-0 z-50 isolate flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Header bar — Logo mark in the corner per brand spec. */}
      {!preJoinChoices || leftCall ? <div className="pointer-events-none absolute top-4 left-4 z-30 flex items-center gap-3">
        <Link
          href={`/orders/${bookingId}`}
          aria-label="Back to order"
          className="pointer-events-auto grid size-9 place-items-center rounded-md border border-gold/30 bg-black/40 text-gold backdrop-blur hover:bg-black/60"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <div className="pointer-events-auto">
          <Logo variant="mark" className="text-gold" />
        </div>
      </div> : null}

      {/* Subtle burgundy corner glow — matches the brand spec. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 z-0 h-[36rem] w-[36rem] rounded-full bg-burgundy/20 blur-3xl"
      />

      {callError ? <p role="alert" className="relative z-40 mx-auto mt-16 max-w-md rounded-lg border border-destructive/40 bg-background p-4 text-sm">{callError}</p> : null}
      {liveKitRoom}
    </div>
  );
}

function InCall({
  role,
  endsAt,
  bookingId,
}: {
  role: Role;
  endsAt: string;
  bookingId: string;
}) {
  const endsAtMs = useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = useState(() => Date.now());
  const [disconnected, setDisconnected] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const room = useRoomContext();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  // Auto-disconnect when the slot end time has passed. LiveKit's room
  // service also enforces the token TTL we minted server-side; this
  // belt-and-braces UI timer kicks the user out at the exact end-of-call
  // moment even if their token hasn't expired yet (e.g. tab was open
  // in the background and the system clock drifted).
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAtMs && !disconnected) {
        setDisconnected(true);
        room.disconnect();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [endsAtMs, room, disconnected]);

  const remainingMs = Math.max(0, endsAtMs - now);
  const remainingStr = fmt(Math.ceil(remainingMs / 1000));
  const warning = remainingMs > 0 && remainingMs <= 2 * 60_000;

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0A0506]">
      {/* Time-left bar across the top. */}
      <div
        className={`flex min-h-14 items-center justify-between gap-3 border-b px-4 py-2 text-xs tracking-wider uppercase ${
          warning
            ? "border-burgundy/60 bg-burgundy/15 text-[#F3ECE4]"
            : "border-gold/15 bg-black/40 text-muted-foreground"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/orders/${bookingId}`} aria-label="Back to order" className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/30 text-gold hover:bg-gold/10">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <VideoIcon className="hidden size-3.5 text-gold sm:block" />
          <span className="truncate">{role === "buyer" ? "Buying" : "Selling"} · Call open</span>
        </span>
        <span
          data-testid="time-left"
          data-warning={warning ? "true" : "false"}
          className="font-mono text-sm"
        >
          {disconnected ? "00:00" : remainingStr}
          {warning ? " · wrapping up" : ""}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 items-stretch overflow-hidden">
        <div data-testid="call-video-stage" className={`min-w-0 flex-1 ${chatOpen ? "md:pr-[360px]" : ""}`}>
          <GridLayout tracks={tracks} className="h-full w-full gap-2 p-2">
            <ParticipantTile />
          </GridLayout>
        </div>
        <RoomAudioRenderer />
        {chatOpen ? (
          <div role="dialog" aria-modal="false" aria-label="Call chat" className="absolute inset-x-3 bottom-3 z-20 h-[min(62dvh,30rem)] overflow-hidden rounded-2xl border border-gold/25 bg-[#170e10] shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:h-auto md:w-[360px] md:rounded-none md:border-y-0 md:border-r-0">
            <div className="flex h-12 items-center justify-between border-b border-gold/20 px-4">
              <div><p className="text-sm font-semibold text-foreground">Call chat</p><p className="text-[11px] text-muted-foreground">Messages in this call are temporary.</p></div>
              <button type="button" aria-label="Close call chat" onClick={() => setChatOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/10 hover:text-foreground"><XIcon className="size-4" /></button>
            </div>
            <Chat messageFormatter={chatFormatter} className="zclub-call-chat" />
          </div>
        ) : null}
      </div>

      <div className="relative z-30 flex min-h-16 items-center justify-center gap-2 border-t border-gold/15 bg-[#120a0c] px-2 pb-[env(safe-area-inset-bottom)]">
        <ControlBar variation="minimal" controls={{ microphone: true, camera: true, chat: false, screenShare: false, leave: true, settings: false }} className="min-w-0 !border-0 !p-0 [&_.lk-button]:!px-3" />
        <button type="button" aria-label={chatOpen ? "Close call chat" : "Open call chat"} aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm ${chatOpen ? "border-gold bg-gold/15 text-gold" : "border-gold/30 text-foreground hover:bg-white/10"}`}>
          <MessageCircleIcon className="size-4" /><span className="hidden sm:inline">Chat</span>
        </button>
      </div>

      {disconnected ? (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-gold/30 bg-[#0A0506] p-8 text-center">
            <p className="font-heading text-lg text-gold">Call ended</p>
            <p className="text-sm text-muted-foreground">
              The scheduled window has passed.
            </p>
            <Button asChild className="bg-burgundy text-foreground">
              <Link href={`/orders/${bookingId}`}>Back to order</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function chatFormatter(text: string) {
  return text.replace(/\n/g, " ");
}
